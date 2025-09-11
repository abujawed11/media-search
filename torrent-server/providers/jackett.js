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
   * Search torrents using Jackett
   */
  async search(query, category = '') {
    if (!this.url || !this.apiKey) {
      throw new Error("Missing Jackett configuration");
    }

    // Jackett Torznab XML (all indexers)
    const url = new URL("/api/v2.0/indexers/all/results/torznab/api", this.url);
    url.searchParams.set("apikey", this.apiKey);
    url.searchParams.set("t", "search");
    url.searchParams.set("q", query);
    if (category) url.searchParams.set("cat", category);

    console.log(`[JACKETT] Searching: ${query}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Jackett ${response.status}`);
    
    const xml = await response.text();
    const parsed = await parseStringPromise(xml, { explicitArray: false, mergeAttrs: true });
    const items = this.toArray(parsed?.rss?.channel?.item);
    
    console.log(`[JACKETT] Got ${items.length} raw results`);
    if (items.length > 0) {
      console.log('[JACKETT] Sample result:', JSON.stringify(items[0], null, 2));
    }

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

      // If no magnet found, try resolving torrent URLs that might redirect to magnets
      if (!magnet && torrent && torrent.includes('jackett_apikey')) {
        console.log(`[JACKETT] Resolving download URL for: ${it?.title}`);
        magnet = await this.resolveDownloadUrlToMagnet(torrent);
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

    return results;
  }

  /**
   * Resolve Jackett download URLs to actual magnet links
   */
  async resolveDownloadUrlToMagnet(downloadUrl) {
    // Check cache first
    const cached = magnetCache.get(downloadUrl);
    if (cached !== undefined) {
      console.log(`[JACKETT] Using cached magnet for: ${downloadUrl.substring(0, 100)}...`);
      return cached;
    }

    try {
      console.log(`[JACKETT] Fetching magnet from: ${downloadUrl.substring(0, 100)}...`);
      
      // Add timeout to prevent hanging
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout
      
      const response = await fetch(downloadUrl, { 
        redirect: 'follow', // Follow redirects but check headers too
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });
      
      clearTimeout(timeoutId);
      
      // Check final URL after redirects
      if (response.url && response.url.startsWith('magnet:')) {
        console.log(`[JACKETT] Found magnet via final URL: ${response.url.substring(0, 80)}...`);
        magnetCache.set(downloadUrl, response.url);
        return response.url;
      }
      
      // Check if it's a direct response, look in body
      if (response.ok) {
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
          // Look for limetorrents specific patterns
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
      }
      
      console.log(`[JACKETT] No magnet found, status: ${response.status}, content-type: ${response.headers.get('content-type')}`);
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