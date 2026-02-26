const { parseStringPromise } = require("xml2js");
const { LRUCache } = require("lru-cache");

// magnet resolution cache (5 minutes)
const magnetCache = new LRUCache({ max: 1000, ttl: 300_000 });

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

    // Process results and resolve magnet links
    const results = await Promise.all(items.map(async (it) => {
      const attrs = this.toArray(it["torznab:attr"]).reduce((a, b) => {
        if (b?.name) a[b.name] = b.value;
        return a;
      }, {});
      
      const encUrl = it?.enclosure?.url;
      const link = typeof it?.link === "string" ? it.link : null;
      let magnet = link?.startsWith("magnet:") ? link : encUrl?.startsWith("magnet:") ? encUrl : null;
      const torrent = encUrl && encUrl.startsWith("http") ? encUrl : null;

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

    console.log(`[JACKETT] Normalization done, returning ${results.length} results`);
    return results;
  }

  /**
   * Resolve Jackett download URLs to actual magnet links
   */
  async resolveDownloadUrlToMagnet(downloadUrl) {
    // Check cache first
    const cached = magnetCache.get(downloadUrl);
    if (cached !== undefined) {
      if (cached === null) {
        // Don't log for known failed URLs to reduce spam
        return cached;
      }
      console.log(`[JACKETT] Using cached magnet for: ${downloadUrl.substring(0, 100)}...`);
      return cached;
    }

    try {
      console.log(`[JACKETT] Fetching magnet from: ${downloadUrl.substring(0, 100)}...`);
      
      // Add timeout to prevent hanging
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // Reduced to 10 seconds
      
      const response = await fetch(downloadUrl, { 
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });
      
      clearTimeout(timeoutId);
      
      // If we get 404 or other errors, cache the failure and return quickly
      if (!response.ok) {
        console.log(`[JACKETT] Download URL failed with status ${response.status}, caching failure`);
        magnetCache.set(downloadUrl, null);
        return null;
      }
      
      // Check final URL after redirects
      if (response.url && response.url.startsWith('magnet:')) {
        console.log(`[JACKETT] Found magnet via final URL: ${response.url.substring(0, 80)}...`);
        magnetCache.set(downloadUrl, response.url);
        return response.url;
      }
      
      // Check if it's a direct response, look in body
      const text = await response.text();
      
      // Look for various magnet link patterns
      const magnetPatterns = [
        /magnet:\?[^"'\s<>]+/g,
        /href=['\"]?(magnet:\?[^"'\s>]+)/g,
        /"(magnet:\?[^"]+)"/g
      ];
      
      for (const pattern of magnetPatterns) {
        const matches = text.match(pattern);
        if (matches && matches.length > 0) {
          let magnet = matches[0];
          // Clean up the magnet link if it includes href= prefix
          if (magnet.includes('href=')) {
            magnet = magnet.replace(/.*href=['\"]?/, '').replace(/['\"].*/, '');
          }
          if (magnet.startsWith('magnet:')) {
            console.log(`[JACKETT] Found magnet in response body: ${magnet.substring(0, 80)}...`);
            magnetCache.set(downloadUrl, magnet);
            return magnet;
          }
        }
      }
      
      // Special handling for certain tracker patterns
      if (text.includes('limetorrents') || downloadUrl.includes('limetorrents')) {
        const limePattern = /onclick="location\.href='(magnet:[^']+)'/;
        const limeMatch = text.match(limePattern);
        if (limeMatch) {
          console.log(`[JACKETT] Found limetorrents magnet: ${limeMatch[1].substring(0, 80)}...`);
          magnetCache.set(downloadUrl, limeMatch[1]);
          return limeMatch[1];
        }
      }
      
      // Additional pattern for JavaScript-based magnet links
      const jsPatterns = [
        /window\.location\s*=\s*['"](magnet:[^'"]+)['"]/g,
        /location\.href\s*=\s*['"](magnet:[^'"]+)['"]/g,
        /document\.location\s*=\s*['"](magnet:[^'"]+)['"]/g
      ];
      
      for (const pattern of jsPatterns) {
        const matches = text.match(pattern);
        if (matches && matches.length > 0) {
          const magnetMatch = matches[0].match(/magnet:[^'"]+/);
          if (magnetMatch) {
            console.log(`[JACKETT] Found JS magnet: ${magnetMatch[0].substring(0, 80)}...`);
            magnetCache.set(downloadUrl, magnetMatch[0]);
            return magnetMatch[0];
          }
        }
      }
      
      // No magnet found, cache the failure
      magnetCache.set(downloadUrl, null);
      return null;
      
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log(`[JACKETT] Request timeout resolving magnet`);
      } else {
        console.log(`[JACKETT] Error resolving magnet: ${error.message}`);
      }
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