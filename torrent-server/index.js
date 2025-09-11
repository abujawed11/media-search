// index.js — CommonJS backend

const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
require("dotenv").config();
const { LRUCache } = require("lru-cache");
const rateLimit = require("express-rate-limit");

// Import providers
const ProwlarrProvider = require("./providers/prowlarr");
const JackettProvider = require("./providers/jackett");

const app = express();
app.use(cors());
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

app.get("/api/health", (_req, res) => {
  res.json({ 
    ok: true, 
    providers: {
      prowlarr: !!PROWLARR_URL && !!PROWLARR_API_KEY,
      jackett: !!JACKETT_URL && !!JACKETT_API_KEY
    }
  });
});

app.get("/api/search", async (req, res) => {
  const q = String(req.query.q || "").trim();
  const cat = String(req.query.cat || "").trim();          // torznab category (e.g., 2000 Movies, 5000 TV)
  const indexers = String(req.query.indexers || "").trim(); // prowlarr: comma-separated names
  const provider = String(req.query.provider || "prowlarr").trim(); // provider selection
  
  if (!q) return res.status(400).json({ error: "Missing q" });
  if (!providers[provider]) {
    return res.status(400).json({ error: `Invalid provider: ${provider}` });
  }

  const key = `${provider}|${q}|${cat}|${indexers}`;
  const cached = cache.get(key);
  if (cached) return res.json(cached);

  try {
    console.log(`[API] Using provider: ${provider}`);
    
    // Use the selected provider
    const selectedProvider = providers[provider];
    let results = [];
    
    if (provider === 'prowlarr') {
      results = await selectedProvider.search(q, cat, indexers);
    } else if (provider === 'jackett') {
      results = await selectedProvider.search(q, cat);
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
