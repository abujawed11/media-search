const { LRUCache } = require("lru-cache");

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
   * Search torrents using Prowlarr
   */
  async search(query, category = '', indexers = '') {
    if (!this.url || !this.apiKey) {
      throw new Error("Missing Prowlarr configuration");
    }

    const url = new URL("/api/v1/search", this.url);
    url.searchParams.set("apikey", this.apiKey);
    url.searchParams.set("query", query);
    url.searchParams.set("type", "search");
    if (category) url.searchParams.set("categories", category);
    if (indexers) url.searchParams.set("indexers", indexers);

    console.log(`[PROWLARR] Searching: ${query}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Prowlarr ${response.status}`);
    
    const data = await response.json();
    console.log(`[PROWLARR] Got ${data.length} raw results`);

    // Process results and resolve magnet links
    const results = await Promise.all(data.map(async (x) => {
      let magnet = x.magnetUrl || (x.guid?.startsWith("magnet:") ? x.guid : null);
      
      // Check if we have a Prowlarr download URL in any field
      const downloadUrl = x.link && x.link.includes('download?') ? x.link : 
                         x.magnetUrl && x.magnetUrl.includes('download?') ? x.magnetUrl : null;
      
      if (downloadUrl) {
        console.log(`[PROWLARR] Resolving download URL for: ${x.title}`);
        const resolvedMagnet = await this.resolveDownloadUrlToMagnet(downloadUrl);
        if (resolvedMagnet) {
          magnet = resolvedMagnet;
        }
      }
      
      return this.normalizeResult({
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

    return results;
  }

  /**
   * Resolve Prowlarr download URLs to actual magnet links
   */
  async resolveDownloadUrlToMagnet(downloadUrl) {
    // Check cache first
    const cached = magnetCache.get(downloadUrl);
    if (cached !== undefined) {
      console.log(`[PROWLARR] Using cached magnet for: ${downloadUrl.substring(0, 100)}...`);
      return cached;
    }

    try {
      console.log(`[PROWLARR] Fetching magnet from: ${downloadUrl.substring(0, 100)}...`);
      
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
        console.log(`[PROWLARR] Found magnet via redirect: ${location.substring(0, 80)}...`);
        magnetCache.set(downloadUrl, location);
        return location;
      }
      
      // If it's a direct response, check the body
      if (response.ok) {
        const text = await response.text();
        // Look for magnet link in the response
        const magnetMatch = text.match(/magnet:\?[^"'\s<>]+/);
        if (magnetMatch) {
          console.log(`[PROWLARR] Found magnet in response body: ${magnetMatch[0].substring(0, 80)}...`);
          magnetCache.set(downloadUrl, magnetMatch[0]);
          return magnetMatch[0];
        }
      }
      
      console.log(`[PROWLARR] No magnet found, status: ${response.status}`);
      magnetCache.set(downloadUrl, null);
      return null;
    } catch (error) {
      console.log(`[PROWLARR] Error resolving magnet: ${error.message}`);
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