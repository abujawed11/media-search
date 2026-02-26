const { parseStringPromise } = require("xml2js");
const { LRUCache } = require("lru-cache");
const { followRedirectsToMagnet } = require("./utils");

// magnet resolution cache (5 minutes)
const magnetCache = new LRUCache({ max: 1000, ttl: 300_000 });

// in-flight map: downloadUrl → Promise<string|null>
// Prevents duplicate Jackett requests when prefetch + on-demand click race
const inFlight = new Map();

/**
 * Jackett search provider
 */
class JackettProvider {
  constructor(url, apiKey) {
    this.url = url;
    this.apiKey = apiKey;
    this.name = 'jackett';
  }

  /**
   * List configured indexers
   */
  async getIndexers() {
    if (!this.url || !this.apiKey) throw new Error("Missing Jackett configuration");

    // NOTE: Jackett's REST indexer list endpoint (/api/v2.0/indexers) may not exist
    // in all versions. We use the Torznab caps approach instead: query each
    // configured indexer by fetching the "all" caps and parsing tracker names
    // from a minimal search, OR we fall back to the torznab indexers caps endpoint.
    // Most reliable: use /api/v2.0/indexers without any extra params.
    const url = new URL("/api/v2.0/indexers", this.url);
    url.searchParams.set("apikey", this.apiKey);
    // Do NOT add configured=true — not supported in all Jackett versions

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);
    let response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }

    // If REST indexer list not available, fall back to torznab caps
    if (!response.ok) {
      console.log(`[JACKETT] /api/v2.0/indexers returned ${response.status}, trying torznab caps fallback`);
      return this._getIndexersFromCaps();
    }

    const data = await response.json();
    // Filter to only configured indexers (those with a non-empty "configured" field)
    return data
      .filter(idx => idx.configured !== false)
      .map(idx => ({ id: idx.id, name: idx.name || idx.id }));
  }

  /**
   * Fallback: get indexer list from Jackett's torznab caps endpoint
   */
  async _getIndexersFromCaps() {
    const url = new URL("/api/v2.0/indexers/all/results/torznab/api", this.url);
    url.searchParams.set("apikey", this.apiKey);
    url.searchParams.set("t", "indexers");
    url.searchParams.set("configured", "true");

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);
    let response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }
    if (!response.ok) throw new Error(`Jackett caps ${response.status}`);

    const xml = await response.text();
    const parsed = await parseStringPromise(xml, { explicitArray: false, mergeAttrs: true });
    const indexers = this.toArray(parsed?.indexers?.indexer);
    return indexers.map(idx => ({ id: idx.id, name: idx.title || idx.id }));
  }

  /**
   * Search torrents using Jackett
   * @param {string} query
   * @param {string} category
   * @param {string} indexerId  — specific indexer id, or '' for all
   */
  async search(query, category = '', indexerId = '') {
    if (!this.url || !this.apiKey) {
      throw new Error("Missing Jackett configuration");
    }

    // Use specific indexer path, or 'all' to search everything
    const indexerPath = indexerId || 'all';
    const url = new URL(`/api/v2.0/indexers/${indexerPath}/results/torznab/api`, this.url);
    url.searchParams.set("apikey", this.apiKey);
    url.searchParams.set("t", "search");
    url.searchParams.set("q", query);
    if (category) url.searchParams.set("cat", category);
    // Cap results at Jackett level — avoids fetching 400+ items when searching all indexers
    if (!indexerId) url.searchParams.set("limit", "100");

    console.log(`[JACKETT] Searching: ${query}`);

    // --- Timeout on upstream fetch ---
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25_000);
    let response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }
    if (!response.ok) throw new Error(`Jackett ${response.status}`);
    console.log(`[JACKETT] Got HTTP response, reading body...`);

    const xml = await response.text();
    console.log(`[JACKETT] Parsing XML (${xml.length} bytes)...`);
    const parsed = await parseStringPromise(xml, { explicitArray: false, mergeAttrs: true });

    // Cap at 300 to avoid slow post-processing on huge result sets
    const items = this.toArray(parsed?.rss?.channel?.item).slice(0, 300);
    console.log(`[JACKETT] Got ${items.length} raw results (capped at 300), normalizing...`);

    // Dump raw fields of first result so we can see what the indexer provides
    if (items.length > 0) {
      const sample = items[0];
      const sampleAttrs = this.toArray(sample["torznab:attr"]).reduce((a, b) => {
        if (b?.name) a[b.name] = b.value;
        return a;
      }, {});
      console.log(`[JACKETT] 🔍 First result raw fields:`);
      console.log(`          title    = ${String(sample?.title || '').substring(0, 60)}`);
      console.log(`          link     = ${String(sample?.link || '').substring(0, 100)}`);
      console.log(`          enclosure= ${String(sample?.enclosure?.url || '').substring(0, 100)}`);
      console.log(`          attrs    = ${JSON.stringify(sampleAttrs)}`);
    }

    // Process results and resolve magnet links
    const results = await Promise.all(items.map(async (it) => {
      const attrs = this.toArray(it["torznab:attr"]).reduce((a, b) => {
        if (b?.name) a[b.name] = b.value;
        return a;
      }, {});
      
      const encUrl = it?.enclosure?.url;
      const link = typeof it?.link === "string" ? it.link : null;

      // Check torznab:attr for magneturl — many indexers (1337x, RARBG, etc.)
      // embed the magnet link directly in the XML so no resolution needed
      const magnetFromAttr = attrs.magneturl || attrs.magnetUrl;

      let magnet = magnetFromAttr?.startsWith("magnet:") ? magnetFromAttr
        : link?.startsWith("magnet:") ? link
        : encUrl?.startsWith("magnet:") ? encUrl
        : null;

      // Only store the download link if we don't already have a magnet
      const torrent = !magnet && encUrl && encUrl.startsWith("http") ? encUrl : null;

      // Skip magnet resolution during search for performance
      // We'll resolve magnets on-demand when user clicks copy button

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
      
      return this.normalizeResult({
        title: String(it?.title || ""),
        size: size,
        seeders: this.asNum(attrs.seeders),
        leechers: this.asNum(attrs.peers ?? attrs.leechers),
        tracker: trackerName,
        published: String(it?.pubDate || ""),
        magnet,
        link: torrent,
      });
    }));

    // ── Debug: summarise what we got from this indexer ──────────────────────
    const withMagnet    = results.filter(r => r.magnet).length;
    const withLink      = results.filter(r => r.link && !r.magnet).length;
    const withNothing   = results.filter(r => !r.magnet && !r.link).length;

    console.log(`[JACKETT] ✅ Done — ${results.length} results | `+
      `🧲 magnet ready: ${withMagnet} | 🔗 needs resolve: ${withLink} | ❌ no link: ${withNothing}`);

    // Print first 3 results so you can see the raw fields
    results.slice(0, 3).forEach((r, i) => {
      console.log(`[JACKETT] [${i+1}] "${r.title.substring(0,60)}"`);
      console.log(`         tracker=${r.tracker} | seeds=${r.seeders} | size=${r.size}`);
      console.log(`         magnet=${r.magnet ? r.magnet.substring(0,80)+'...' : 'null'}`);
      console.log(`         link=${r.link ? r.link.substring(0,80)+'...' : 'null'}`);
    });
    // ────────────────────────────────────────────────────────────────────────

    return results;
  }

  /**
   * Resolve Jackett download URLs to actual magnet links.
   * Uses manual redirect following so magnet: Location headers are caught
   * before Node.js fetch tries (and fails) to fetch the magnet: protocol.
   */
  async resolveDownloadUrlToMagnet(downloadUrl) {
    // 1. Cache hit
    const cached = magnetCache.get(downloadUrl);
    if (cached !== undefined) {
      if (cached) console.log(`[JACKETT] Cache hit: ${downloadUrl.substring(0, 80)}...`);
      return cached;
    }

    // 2. Already resolving — join the existing promise instead of firing a duplicate request
    if (inFlight.has(downloadUrl)) {
      console.log(`[JACKETT] Joining in-flight resolution for: ${downloadUrl.substring(0, 60)}...`);
      return inFlight.get(downloadUrl);
    }

    // 3. Start a new resolution — 45s timeout so slow indexers (1337x, ~20s) can complete
    console.log(`[JACKETT] Resolving: ${downloadUrl.substring(0, 100)}...`);
    const promise = followRedirectsToMagnet(downloadUrl, { timeoutMs: 45_000 })
      .then(magnet => {
        if (magnet) {
          console.log(`[JACKETT] Resolved magnet: ${magnet.substring(0, 80)}...`);
          magnetCache.set(downloadUrl, magnet); // cache success
        } else {
          console.log(`[JACKETT] Could not resolve magnet for: ${downloadUrl.substring(0, 80)}`);
          magnetCache.set(downloadUrl, null); // definitive failure — Jackett returned nothing
        }
        inFlight.delete(downloadUrl);
        return magnet;
      })
      .catch(e => {
        console.log(`[JACKETT] resolveDownloadUrlToMagnet error: ${e.message}`);
        inFlight.delete(downloadUrl);
        // Don't cache timeout/abort errors — let the next call retry
        const isTimeout = e.message.toLowerCase().includes('abort') || e.message.toLowerCase().includes('timeout');
        if (!isTimeout) magnetCache.set(downloadUrl, null);
        return null;
      });

    inFlight.set(downloadUrl, promise);
    return promise;
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

  /**
   * Helper: Convert to array
   */
  toArray(x) {
    if (!x) return [];
    return Array.isArray(x) ? x : [x];
  }

  /**
   * Helper: Convert to number
   */
  asNum(n) {
    const v = Number(n);
    return Number.isFinite(v) ? v : null;
  }
}

module.exports = JackettProvider;