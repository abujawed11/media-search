const { LRUCache } = require("lru-cache");
const { followRedirectsToMagnet } = require("./utils");

// magnet resolution cache (5 minutes)
const magnetCache = new LRUCache({ max: 1000, ttl: 300_000 });

/**
 * Prowlarr search provider
 */
class ProwlarrProvider {
  constructor(url, apiKey) {
    this.url = url;
    this.apiKey = apiKey;
    this.name = 'prowlarr';
  }

  /**
   * List configured indexers
   */
  async getIndexers() {
    if (!this.url || !this.apiKey) throw new Error("Missing Prowlarr configuration");

    const url = new URL("/api/v1/indexer", this.url);
    url.searchParams.set("apikey", this.apiKey);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);
    let response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }
    if (!response.ok) throw new Error(`Prowlarr indexers ${response.status}`);

    const data = await response.json();
    return data.map(idx => ({ id: String(idx.id), name: idx.name }));
  }

  /**
   * Search torrents using Prowlarr
   * @param {string} query
   * @param {string} category
   * @param {string} indexers   — legacy comma-separated names (unused when indexerId set)
   * @param {string} indexerId  — specific indexer numeric id, or '' for all
   */
  async search(query, category = '', indexers = '', indexerId = '') {
    if (!this.url || !this.apiKey) {
      throw new Error("Missing Prowlarr configuration");
    }

    const url = new URL("/api/v1/search", this.url);
    url.searchParams.set("apikey", this.apiKey);
    url.searchParams.set("query", query);
    url.searchParams.set("type", "search");
    if (category) url.searchParams.set("categories", category);
    // Prefer specific indexer id; fall back to legacy multi-indexer filter
    if (indexerId) url.searchParams.set("indexerIds", indexerId);
    else if (indexers) url.searchParams.set("indexers", indexers);

    console.log(`[PROWLARR] Searching: ${query}`);

    // --- Timeout on upstream fetch ---
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25_000);
    let response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }
    if (!response.ok) throw new Error(`Prowlarr ${response.status}`);
    console.log(`[PROWLARR] Got HTTP response, reading body...`);

    const raw = await response.json();
    // Cap at 300 to avoid slow post-processing on huge result sets
    const data = raw.slice(0, 300);
    console.log(`[PROWLARR] Got ${raw.length} raw results (capped at ${data.length}), normalizing...`);

    // Process results and resolve magnet links
    const results = await Promise.all(data.map(async (x) => {
      let magnet = null;
      
      // Try multiple sources for magnet links
      if (x.magnetUrl && x.magnetUrl.startsWith("magnet:")) {
        magnet = x.magnetUrl;
      } else if (x.guid && x.guid.startsWith("magnet:")) {
        magnet = x.guid;
      }
      
      // Store the download URL for on-demand resolution
      const downloadUrl = x.link && x.link.includes('download?') ? x.link : 
                         x.magnetUrl && x.magnetUrl.includes('download?') ? x.magnetUrl : 
                         x.downloadUrl || null;
      
      // Skip magnet resolution during search for performance
      // We'll resolve magnets on-demand when user clicks copy button
      
      return this.normalizeResult({
        title: String(x.title || ""),
        size: Number(x.size || 0),
        seeders: x.seeders ?? null,
        leechers: x.leechers ?? null,
        tracker: String(x.indexer || ""),
        published: String(x.publishDate || ""),
        magnet,
        link: downloadUrl || x.link || null, // Store download URL for on-demand resolution
      });
    }));

    // ── Debug: summarise what we got from this indexer ──────────────────────
    const withMagnet  = results.filter(r => r.magnet).length;
    const withLink    = results.filter(r => r.link && !r.magnet).length;
    const withNothing = results.filter(r => !r.magnet && !r.link).length;

    console.log(`[PROWLARR] ✅ Done — ${results.length} results | `+
      `🧲 magnet ready: ${withMagnet} | 🔗 needs resolve: ${withLink} | ❌ no link: ${withNothing}`);

    results.slice(0, 3).forEach((r, i) => {
      console.log(`[PROWLARR] [${i+1}] "${r.title.substring(0,60)}"`);
      console.log(`           tracker=${r.tracker} | seeds=${r.seeders} | size=${r.size}`);
      console.log(`           magnet=${r.magnet ? r.magnet.substring(0,80)+'...' : 'null'}`);
      console.log(`           link=${r.link ? r.link.substring(0,80)+'...' : 'null'}`);
    });
    // ────────────────────────────────────────────────────────────────────────

    return results;
  }

  /**
   * Resolve Prowlarr download URLs to actual magnet links.
   * Uses manual redirect following so magnet: Location headers are caught
   * before Node.js fetch tries (and fails) to fetch the magnet: protocol.
   */
  async resolveDownloadUrlToMagnet(downloadUrl) {
    const cached = magnetCache.get(downloadUrl);
    if (cached !== undefined) {
      if (cached) console.log(`[PROWLARR] Cache hit: ${downloadUrl.substring(0, 80)}...`);
      return cached;
    }

    console.log(`[PROWLARR] Resolving: ${downloadUrl.substring(0, 100)}...`);
    try {
      const magnet = await followRedirectsToMagnet(downloadUrl, { timeoutMs: 15_000 });
      if (magnet) {
        console.log(`[PROWLARR] Resolved magnet: ${magnet.substring(0, 80)}...`);
      } else {
        console.log(`[PROWLARR] Could not resolve magnet for: ${downloadUrl.substring(0, 80)}`);
      }
      magnetCache.set(downloadUrl, magnet);
      return magnet;
    } catch (e) {
      console.log(`[PROWLARR] resolveDownloadUrlToMagnet error: ${e.message}`);
      magnetCache.set(downloadUrl, null);
      return null;
    }
  }

  /**
   * Normalize search result
   */
  normalizeResult(result) {
    const normTitle = String(result.title || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/\[.*?\]|\(.*?\)/g, "")
      .trim();
    
    return { ...result, normTitle };
  }
}

module.exports = ProwlarrProvider;