// index.js — CommonJS backend

const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
require("dotenv").config();
const { parseStringPromise } = require("xml2js");
const { LRUCache } = require("lru-cache");
const rateLimit = require("express-rate-limit");

// If your Node < 18, uncomment the next line:
// global.fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

const {
  AGGREGATOR = "prowlarr",
  PROWLARR_URL,
  PROWLARR_API_KEY,
  JACKETT_URL,
  JACKETT_API_KEY,
  QBIT_URL,
  QBIT_USER,
  QBIT_PASS,
  PORT = 4000,
} = process.env;

// simple cache (60s)
const cache = new LRUCache({ max: 500, ttl: 60_000 });
// magnet resolution cache (5 minutes)
const magnetCache = new LRUCache({ max: 1000, ttl: 300_000 });

// basic rate limit
const limiter = rateLimit({ windowMs: 60_000, max: 60 });
app.use("/api/", limiter);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, aggregator: AGGREGATOR });
});

app.get("/api/search", async (req, res) => {
  const q = String(req.query.q || "").trim();
  const cat = String(req.query.cat || "").trim();          // torznab category (e.g., 2000 Movies, 5000 TV)
  const indexers = String(req.query.indexers || "").trim(); // prowlarr: comma-separated names
  if (!q) return res.status(400).json({ error: "Missing q" });

  const key = `${AGGREGATOR}|${q}|${cat}|${indexers}`;
  const cached = cache.get(key);
  if (cached) return res.json(cached);

  try {
    let results = [];

    if (AGGREGATOR === "prowlarr") {
      if (!PROWLARR_URL || !PROWLARR_API_KEY) throw new Error("Missing Prowlarr env");
      const url = new URL("/api/v1/search", PROWLARR_URL);
      url.searchParams.set("apikey", PROWLARR_API_KEY);
      url.searchParams.set("query", q);
      url.searchParams.set("type", "search"); // 'movie'/'tvsearch' if you add specific params
      if (cat) url.searchParams.set("categories", cat);
      if (indexers) url.searchParams.set("indexers", indexers);

      const r = await fetch(url);
      if (!r.ok) throw new Error(`Prowlarr ${r.status}`);
      const data = await r.json(); // JSON already
      
      // Debug: log the first raw result to see the structure
      if (data.length > 0) {
        //console.log('[RAW PROWLARR DATA]', JSON.stringify(data[0], null, 2));
      }
      
      // Process results and resolve magnet links
      results = await Promise.all(data.map(async (x) => {
        let magnet = x.magnetUrl || (x.guid?.startsWith("magnet:") ? x.guid : null);
        
        // Check if we have a Prowlarr download URL in any field
        const downloadUrl = x.link && x.link.includes('download?') ? x.link : 
                           x.magnetUrl && x.magnetUrl.includes('download?') ? x.magnetUrl : null;
        
        if (downloadUrl) {
          //console.log(`[DEBUG] Found Prowlarr download URL, resolving...`);
          const resolvedMagnet = await resolveDownloadUrlToMagnet(downloadUrl);
          if (resolvedMagnet) {
            magnet = resolvedMagnet;
          }
        }
        
        //console.log(`[DEBUG] Title: ${x.title}`);
        //console.log(`[DEBUG] Original MagnetUrl: ${x.magnetUrl ? x.magnetUrl.substring(0, 80) + '...' : 'null'}`);
        //console.log(`[DEBUG] Link: ${x.link ? x.link.substring(0, 80) + '...' : 'null'}`);
        //console.log(`[DEBUG] Download URL: ${downloadUrl ? downloadUrl.substring(0, 80) + '...' : 'null'}`);
        //console.log(`[DEBUG] Final Magnet: ${magnet ? magnet.substring(0, 80) + '...' : 'null'}`);
        //console.log('---');
        
        return normalize({
          title: String(x.title || ""),
          size: Number(x.size || 0),
          seeders: x.seeders ?? null,
          leechers: x.leechers ?? null,
          tracker: String(x.indexer || ""),
          published: String(x.publishDate || ""),
          magnet,
          link: x.link || null,
        });
      }));
    } else {
      if (!JACKETT_URL || !JACKETT_API_KEY) throw new Error("Missing Jackett env");
      // Jackett Torznab XML (all indexers)
      const url = new URL("/api/v2.0/indexers/all/results/torznab/api", JACKETT_URL);
      url.searchParams.set("apikey", JACKETT_API_KEY);
      url.searchParams.set("t", "search");
      url.searchParams.set("q", q);
      if (cat) url.searchParams.set("cat", cat);

      const r = await fetch(url);
      if (!r.ok) throw new Error(`Jackett ${r.status}`);
      const xml = await r.text();
      const parsed = await parseStringPromise(xml, { explicitArray: false, mergeAttrs: true });
      const items = toArray(parsed?.rss?.channel?.item);
      
      // Debug: log the first raw Jackett result
      if (items.length > 0) {
        console.log('[RAW JACKETT DATA]', JSON.stringify(items[0], null, 2));
      }

      // Process results and resolve magnet links
      results = await Promise.all(items.map(async (it) => {
        const attrs = toArray(it["torznab:attr"]).reduce((a, b) => {
          if (b?.name) a[b.name] = b.value;
          return a;
        }, {});
        const encUrl = it?.enclosure?.url;
        const link = typeof it?.link === "string" ? it.link : null;
        let magnet = link?.startsWith("magnet:") ? link : encUrl?.startsWith("magnet:") ? encUrl : null;
        const torrent = encUrl && encUrl.startsWith("http") ? encUrl : null;

        // If no magnet found, try resolving torrent URLs that might redirect to magnets
        if (!magnet && torrent && torrent.includes('jackett_apikey')) {
          console.log(`[DEBUG] No direct magnet found, trying to resolve Jackett URL...`);
          magnet = await resolveDownloadUrlToMagnet(torrent); // Reuse the same function
        }

        // Extract tracker name properly (handle object or string)
        let trackerName = "";
        if (typeof it?.jackettindexer === "object" && it?.jackettindexer?._) {
          trackerName = it.jackettindexer._;
        } else if (typeof it?.jackettindexer === "string") {
          trackerName = it.jackettindexer;
        } else if (it?.indexer) {
          trackerName = String(it.indexer);
        }

        // Get size from multiple possible sources
        let size = Number(attrs.size || it?.size || it?.enclosure?.length || 0);
        
        console.log(`[DEBUG] Title: ${it?.title}`);
        console.log(`[DEBUG] Size sources - attrs.size: ${attrs.size}, it.size: ${it.size}, enclosure.length: ${it?.enclosure?.length}`);
        console.log(`[DEBUG] Final size: ${size}`);
        console.log(`[DEBUG] Tracker: ${trackerName}`);
        console.log(`[DEBUG] Original Magnet: ${link?.startsWith("magnet:") ? link.substring(0, 80) + '...' : 'null'}`);
        console.log(`[DEBUG] Torrent URL: ${torrent ? torrent.substring(0, 80) + '...' : 'null'}`);
        console.log(`[DEBUG] Resolved Magnet: ${magnet ? magnet.substring(0, 80) + '...' : 'null'}`);
        console.log('---');

        return normalize({
          title: String(it?.title || ""),
          size: size,
          seeders: asNum(attrs.seeders),
          leechers: asNum(attrs.peers ?? attrs.leechers),
          tracker: trackerName,
          published: String(it?.pubDate || ""),
          magnet,
          link: torrent,
        });
      }));
    }

    // de-dupe by (normalizedTitle + size); keep highest seeders
    const map = new Map();
    for (const r of results) {
      const k = `${r.normTitle}|${r.size}`;
      if (!map.has(k)) map.set(k, r);
      else if ((r.seeders ?? 0) > (map.get(k).seeders ?? 0)) map.set(k, r);
    }
    const deduped = [...map.values()].sort((a, b) => (b.seeders ?? 0) - (a.seeders ?? 0));

    const payload = { query: q, count: deduped.length, results: deduped };
    
    //console.log(`[API RESPONSE] Sending ${deduped.length} results for query: "${q}"`);
    //console.log(`[API RESPONSE] Sample result:`, JSON.stringify(deduped[0], null, 2));
    
    cache.set(key, payload);
    res.json(payload);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Search failed", message: String(e?.message || e) });
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

app.listen(PORT, () => console.log(`API on http://localhost:${PORT}`));

// helpers
function toArray(x) {
  if (!x) return [];
  return Array.isArray(x) ? x : [x];
}
function asNum(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}
function normalize(x) {
  const normTitle = String(x.title || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\[.*?\]|\(.*?\)/g, "")
    .trim();
  return { ...x, normTitle };
}

async function resolveDownloadUrlToMagnet(downloadUrl) {
  // Check cache first
  const cached = magnetCache.get(downloadUrl);
  if (cached !== undefined) {
    //console.log(`[MAGNET RESOLVE] Using cached result for: ${downloadUrl.substring(0, 100)}...`);
    return cached;
  }

  try {
    //console.log(`[MAGNET RESOLVE] Fetching: ${downloadUrl.substring(0, 100)}...`);
    
    // Add timeout to prevent hanging
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
    
    const response = await fetch(downloadUrl, { 
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    clearTimeout(timeoutId);
    
    // Check if it's a redirect to a magnet link
    const location = response.headers.get('location');
    if (location && location.startsWith('magnet:')) {
      //console.log(`[MAGNET RESOLVE] Found magnet via redirect: ${location.substring(0, 80)}...`);
      magnetCache.set(downloadUrl, location);
      return location;
    }
    
    // If it's a direct response, check the body
    if (response.ok) {
      const text = await response.text();
      // Look for magnet link in the response
      const magnetMatch = text.match(/magnet:\?[^"'\s<>]+/);
      if (magnetMatch) {
        //console.log(`[MAGNET RESOLVE] Found magnet in response body: ${magnetMatch[0].substring(0, 80)}...`);
        magnetCache.set(downloadUrl, magnetMatch[0]);
        return magnetMatch[0];
      }
    }
    
    //console.log(`[MAGNET RESOLVE] No magnet found, status: ${response.status}`);
    magnetCache.set(downloadUrl, null); // Cache the null result too
    return null;
  } catch (error) {
    //console.log(`[MAGNET RESOLVE] Error: ${error.message}`);
    magnetCache.set(downloadUrl, null); // Cache the failure
    return null;
  }
}
