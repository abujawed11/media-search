// index.js — CommonJS backend

const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
require("dotenv").config();
const { LRUCache } = require("lru-cache");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");



// Import providers
const ProwlarrProvider = require("./providers/prowlarr");
const JackettProvider = require("./providers/jackett");

const app = express();

app.set('trust proxy', 1);

app.use(cors({
  origin: [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://192.168.1.21",
    "http://192.168.1.21:5173",
  ]
}));
app.use(express.json());
app.use(morgan("dev"));

const {
  PROWLARR_URL,
  PROWLARR_API_KEY,
  JACKETT_URL,
  JACKETT_API_KEY,
  QBIT_URL,
  QBIT_USER,
  QBIT_PASS,
  PORT = 4000,
} = process.env;

// Initialize providers
const providers = {
  prowlarr: new ProwlarrProvider(PROWLARR_URL, PROWLARR_API_KEY),
  jackett: new JackettProvider(JACKETT_URL, JACKETT_API_KEY)
};

// simple cache (60s)
const cache = new LRUCache({ max: 500, ttl: 60_000 });

// basic rate limit
const limiter = rateLimit({ windowMs: 60_000, max: 60 });
app.use("/api/", limiter);

// ---- List indexers for a provider ----
app.get("/api/indexers", async (req, res) => {
  const provider = String(req.query.provider || "prowlarr").trim();
  if (!providers[provider]) return res.status(400).json({ error: `Invalid provider: ${provider}` });

  try {
    const indexers = await providers[provider].getIndexers();
    res.json({ indexers });
  } catch (e) {
    console.error(`[API] Failed to fetch indexers for ${provider}:`, e.message);
    res.status(500).json({ error: "Failed to fetch indexers", message: String(e?.message || e) });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ 
    ok: true, 
    providers: {
      prowlarr: !!PROWLARR_URL && !!PROWLARR_API_KEY,
      jackett: !!JACKETT_URL && !!JACKETT_API_KEY
    }
  });
});

// Safety net: rejects after this many ms regardless of what the provider does
const SEARCH_TIMEOUT_MS = 28_000;

app.get("/api/search", async (req, res) => {
  const q = String(req.query.q || "").trim();
  const cat = String(req.query.cat || "").trim();
  const indexers = String(req.query.indexers || "").trim();
  const indexer = String(req.query.indexer || "").trim(); // single indexer id
  const provider = String(req.query.provider || "prowlarr").trim();

  if (!q) return res.status(400).json({ error: "Missing q" });
  if (!providers[provider]) {
    return res.status(400).json({ error: `Invalid provider: ${provider}` });
  }

  const key = `${provider}|${q}|${cat}|${indexer || indexers}`;
  const cached = cache.get(key);
  if (cached) {
    console.log(`[API] Cache hit for "${q}" (${provider})`);
    return res.json(cached);
  }

  const t0 = Date.now();
  console.log(`[API] Search start - provider=${provider} q="${q}" cat="${cat}" indexer="${indexer || 'all'}"`);

  try {
    const selectedProvider = providers[provider];

    // Race: provider search vs hard timeout
    let timeoutHandle;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutHandle = setTimeout(
        () => reject(new Error(`Search timed out after ${SEARCH_TIMEOUT_MS}ms`)),
        SEARCH_TIMEOUT_MS
      );
    });

    let rawResults;
    try {
      const searchPromise = provider === 'prowlarr'
        ? selectedProvider.search(q, cat, indexers, indexer)
        : selectedProvider.search(q, cat, indexer);
      rawResults = await Promise.race([searchPromise, timeoutPromise]);
    } finally {
      clearTimeout(timeoutHandle);
    }

    console.log(`[API] Provider returned ${rawResults.length} results in ${Date.now() - t0}ms, deduping...`);

    // de-dupe by (normalizedTitle + size); keep highest seeders
    const map = new Map();
    for (const r of rawResults) {
      const k = `${r.normTitle}|${r.size}`;
      if (!map.has(k)) map.set(k, r);
      else if ((r.seeders ?? 0) > (map.get(k).seeders ?? 0)) map.set(k, r);
    }
    const deduped = [...map.values()].sort((a, b) => (b.seeders ?? 0) - (a.seeders ?? 0));

    const payload = { query: q, count: deduped.length, results: deduped };
    cache.set(key, payload);

    console.log(`[API] Sending ${deduped.length} results — total ${Date.now() - t0}ms`);
    res.json(payload);
  } catch (e) {
    const elapsed = Date.now() - t0;
    console.error(`[API] Search failed after ${elapsed}ms:`, e.message);
    const status = e.message.includes('timed out') ? 504 : 500;
    res.status(status).json({ error: "Search failed", message: String(e?.message || e) });
  }
});

// ---- Optional: send magnet to qBittorrent ----
app.post("/api/qbit/add", async (req, res) => {
  try {
    const magnet = req.body?.magnet;
    if (!magnet?.startsWith("magnet:")) return res.status(400).json({ error: "Missing magnet" });
    if (!QBIT_URL || !QBIT_USER || !QBIT_PASS) return res.status(400).json({ error: "qBittorrent env not set" });

    // Login (cookie-based)
    const login = await fetch(new URL("/api/v2/auth/login", QBIT_URL), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: QBIT_USER, password: QBIT_PASS }),
      redirect: "manual",
    });
    const cookie = login.headers.get("set-cookie");
    if (!cookie) throw new Error("qBittorrent login failed");

    const add = await fetch(new URL("/api/v2/torrents/add", QBIT_URL), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie },
      body: new URLSearchParams({ urls: magnet }),
    });
    if (!add.ok) throw new Error(`qBittorrent add failed ${add.status}`);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "qBittorrent add failed", message: String(e?.message || e) });
  }
});

// ---- Resolve magnet link via URL redirect ----
app.post("/api/resolve-magnet", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "Missing url" });

    console.log(`[API] Resolving magnet from URL: ${url.substring(0, 100)}...`);

    // Fetch with redirect: "manual" to capture Location header
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    const response = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    clearTimeout(timeoutId);

    console.log(`[API] Response status: ${response.status}`);
    console.log(`[API] Response headers:`, Object.fromEntries(response.headers.entries()));

    // Check for redirect with magnet URL
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('Location');
      if (location && location.startsWith('magnet:')) {
        console.log(`[API] Found magnet redirect: ${location.substring(0, 100)}...`);
        return res.json({ magnet: location });
      }
    }

    // If it's a 200 response, check if it's a torrent file
    if (response.status === 200) {
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/x-bittorrent') || url.toLowerCase().includes('.torrent')) {
        try {
          const torrentBuffer = await response.arrayBuffer();
          const torrentData = Buffer.from(torrentBuffer);
          const magnet = extractMagnetFromTorrent(torrentData);

          if (magnet) {
            console.log(`[API] Extracted magnet from torrent file: ${magnet.substring(0, 100)}...`);
            return res.json({ magnet });
          }
        } catch (torrentError) {
          console.log(`[API] Failed to parse as torrent file: ${torrentError.message}`);
        }
      }
    }

    // No magnet found
    console.log(`[API] No magnet found for URL: ${url.substring(0, 100)}...`);
    res.status(404).json({ error: "No magnet link found" });

  } catch (e) {
    if (e.name === 'AbortError') {
      console.error(`[API] Timeout resolving magnet from: ${req.body.url?.substring(0, 100)}...`);
      res.status(500).json({ error: "Request timeout", message: "URL resolution timed out" });
    } else {
      console.error(`[API] Error resolving magnet:`, e.message);
      res.status(500).json({ error: "Failed to resolve magnet", message: String(e?.message || e) });
    }
  }
});

// ---- Resolve magnet link on-demand (provider-specific) ----
app.post("/api/resolve-magnet-provider", async (req, res) => {
  try {
    const { downloadUrl, provider } = req.body;
    if (!downloadUrl) return res.status(400).json({ error: "Missing downloadUrl" });
    if (!provider) return res.status(400).json({ error: "Missing provider" });
    if (!providers[provider]) return res.status(400).json({ error: `Invalid provider: ${provider}` });

    console.log(`[API] On-demand magnet resolution for: ${downloadUrl.substring(0, 100)}...`);

    const selectedProvider = providers[provider];
    let magnet = null;

    // Try to resolve using the appropriate provider
    if (downloadUrl.startsWith('magnet:')) {
      // Already a magnet link
      magnet = downloadUrl;
    } else if (provider === 'prowlarr') {
      magnet = await selectedProvider.resolveDownloadUrlToMagnet(downloadUrl);
    } else if (provider === 'jackett') {
      magnet = await selectedProvider.resolveDownloadUrlToMagnet(downloadUrl);
    }

    if (magnet) {
      console.log(`[API] Successfully resolved magnet: ${magnet.substring(0, 100)}...`);
      res.json({ magnet });
    } else {
      console.log(`[API] Could not resolve magnet for: ${downloadUrl.substring(0, 100)}...`);
      res.status(404).json({ error: "Could not resolve magnet link" });
    }
  } catch (e) {
    console.error(`[API] Error resolving magnet:`, e.message);
    res.status(500).json({ error: "Failed to resolve magnet", message: String(e?.message || e) });
  }
});

// ---- Extract magnet link from .torrent file ----
app.post("/api/extract-magnet", async (req, res) => {
  try {
    const { torrentUrl } = req.body;
    if (!torrentUrl) return res.status(400).json({ error: "Missing torrentUrl" });

    console.log(`[API] Extracting magnet from: ${torrentUrl.substring(0, 100)}...`);

    // Download the .torrent file with timeout and better error handling
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout

    const response = await fetch(torrentUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    clearTimeout(timeoutId);
    
    console.log(`[API] Torrent download response - Status: ${response.status}, Content-Type: ${response.headers.get('content-type')}`);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const torrentBuffer = await response.arrayBuffer();
    const torrentData = Buffer.from(torrentBuffer);

    // Parse the torrent file to extract info hash
    const magnet = extractMagnetFromTorrent(torrentData);
    
    if (magnet) {
      console.log(`[API] Successfully extracted magnet: ${magnet.substring(0, 100)}...`);
      res.json({ magnet });
    } else {
      res.status(400).json({ error: "Could not parse torrent file or extract info hash" });
    }
  } catch (e) {
    if (e.name === 'AbortError') {
      console.error(`[API] Timeout extracting magnet from: ${torrentUrl.substring(0, 100)}...`);
      res.status(500).json({ error: "Request timeout", message: "Torrent file download timed out" });
    } else {
      console.error(`[API] Error extracting magnet:`, e.message);
      console.error(`[API] Full error:`, e);
      res.status(500).json({ error: "Failed to extract magnet", message: String(e?.message || e) });
    }
  }
});

/**
 * Extract magnet link from torrent file buffer
 */
function extractMagnetFromTorrent(torrentBuffer) {
  try {
    // Simple bencode parser for torrent files
    const torrentString = torrentBuffer.toString('latin1');
    
    // Find the info dictionary
    const infoIndex = torrentString.indexOf('4:info');
    if (infoIndex === -1) {
      console.log('[API] Could not find info dictionary in torrent file');
      return null;
    }

    // Extract the info dictionary (this is a simplified approach)
    // In a real implementation, you'd want to use a proper bencode parser
    let infoStart = infoIndex + 6; // Skip '4:info'
    let braceCount = 0;
    let infoEnd = infoStart;
    let inString = false;
    let stringLength = 0;

    for (let i = infoStart; i < torrentString.length; i++) {
      const char = torrentString[i];
      
      if (inString) {
        if (stringLength > 0) {
          stringLength--;
        } else {
          inString = false;
        }
        continue;
      }
      
      if (char >= '0' && char <= '9') {
        // This might be a string length
        let lengthStr = '';
        let j = i;
        while (j < torrentString.length && torrentString[j] >= '0' && torrentString[j] <= '9') {
          lengthStr += torrentString[j];
          j++;
        }
        if (j < torrentString.length && torrentString[j] === ':') {
          // This is a string
          stringLength = parseInt(lengthStr);
          inString = true;
          i = j; // Skip to the ':'
          continue;
        }
      }
      
      if (char === 'd') braceCount++;
      else if (char === 'e') braceCount--;
      
      if (braceCount === 0 && i > infoStart) {
        infoEnd = i + 1;
        break;
      }
    }

    if (braceCount !== 0) {
      console.log('[API] Could not properly parse info dictionary');
      return null;
    }

    const infoDict = torrentBuffer.slice(infoIndex + 6, infoEnd - 1);
    const infoHash = crypto.createHash('sha1').update(infoDict).digest('hex').toLowerCase();
    
    // Extract name for display
    let name = 'Unknown';
    const nameMatch = torrentString.match(/4:name(\d+):(.*?)(?:\d|e)/);
    if (nameMatch && nameMatch[1] && nameMatch[2]) {
      const nameLength = parseInt(nameMatch[1]);
      name = nameMatch[2].substring(0, nameLength);
    }

    // Build magnet link
    const magnet = `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(name)}`;
    
    console.log(`[API] Extracted info hash: ${infoHash}`);
    console.log(`[API] Extracted name: ${name}`);
    
    return magnet;
    
  } catch (error) {
    console.error('[API] Error parsing torrent file:', error.message);
    return null;
  }
}

// ---- Proxy torrent downloads for frontend ----
app.post("/api/proxy-torrent", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "Missing url" });

    console.log(`[PROXY] Downloading torrent from: ${url.substring(0, 100)}...`);

    // Download the .torrent file with timeout and better error handling
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout

    const response = await fetch(url, {
      signal: controller.signal,
      method: 'GET',
      headers: {
        'Accept': 'application/x-bittorrent, application/octet-stream, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    clearTimeout(timeoutId);

    console.log(`[PROXY] Response - Status: ${response.status}, Content-Type: ${response.headers.get('content-type')}`);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const torrentData = await response.arrayBuffer();
    console.log(`[PROXY] Downloaded ${torrentData.byteLength} bytes`);

    // Return the torrent file data with proper headers
    res.set({
      'Content-Type': 'application/x-bittorrent',
      'Content-Length': torrentData.byteLength,
      'Access-Control-Allow-Origin': '*'
    });
    res.send(Buffer.from(torrentData));

  } catch (error) {
    if (error.name === 'AbortError') {
      console.error(`[PROXY] Timeout downloading from: ${req.body.url?.substring(0, 100)}...`);
      res.status(500).json({ error: "Request timeout", message: "Torrent file download timed out" });
    } else {
      console.error(`[PROXY] Error downloading torrent:`, error.message);
      res.status(500).json({ error: "Failed to download torrent", message: error.message });
    }
  }
});

// app.listen(PORT, () => console.log(`API on http://localhost:${PORT}`));
app.listen(PORT, "0.0.0.0", () => {
  console.log(`API Running on http://0.0.0.0:${PORT}`);
});
