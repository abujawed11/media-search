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
      let magnet = null;
      
      // Try multiple sources for magnet links
      if (x.magnetUrl && x.magnetUrl.startsWith("magnet:")) {
        magnet = x.magnetUrl;
      } else if (x.guid && x.guid.startsWith("magnet:")) {
        magnet = x.guid;
      }
      
      // Check if we have Prowlarr download URLs to resolve
      const downloadUrl = x.link && x.link.includes('download?') ? x.link : 
                         x.magnetUrl && x.magnetUrl.includes('download?') ? x.magnetUrl : 
                         x.downloadUrl || null;
      
      if (downloadUrl && !magnet) {
        console.log(`[PROWLARR] Resolving download URL for: ${x.title}`);
        const resolvedMagnet = await this.resolveDownloadUrlToMagnet(downloadUrl);
        if (resolvedMagnet) {
          magnet = resolvedMagnet;
        }
      }
      
      // If still no magnet, try the link field as a fallback
      if (!magnet && x.link && !x.link.includes('download?')) {
        if (x.link.startsWith('magnet:')) {
          magnet = x.link;
        } else {
          // Try resolving the link as it might redirect to a magnet
          console.log(`[PROWLARR] Trying to resolve link as potential magnet for: ${x.title}`);
          const resolvedMagnet = await this.resolveDownloadUrlToMagnet(x.link);
          if (resolvedMagnet) {
            magnet = resolvedMagnet;
          }
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
        console.log(`[PROWLARR] Found magnet via final URL: ${response.url.substring(0, 80)}...`);
        magnetCache.set(downloadUrl, response.url);
        return response.url;
      }
      
      // Check if it's a direct response, look in body
      if (response.ok) {
        const text = await response.text();
        
        // Look for various magnet link patterns
        const magnetPatterns = [
          /magnet:\?[^"'\s<>]+/g,
          /href=['"]?(magnet:\?[^"'\s>]+)/g,
          /"(magnet:\?[^"]+)"/g
        ];
        
        for (const pattern of magnetPatterns) {
          const matches = text.match(pattern);
          if (matches && matches.length > 0) {
            let magnet = matches[0];
            // Clean up the magnet link if it includes href= prefix
            if (magnet.includes('href=')) {
              magnet = magnet.replace(/.*href=['"]?/, '').replace(/['"].*/, '');
            }
            if (magnet.startsWith('magnet:')) {
              console.log(`[PROWLARR] Found magnet in response body: ${magnet.substring(0, 80)}...`);
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
            console.log(`[PROWLARR] Found limetorrents magnet: ${limeMatch[1].substring(0, 80)}...`);
            magnetCache.set(downloadUrl, limeMatch[1]);
            return limeMatch[1];
          }
        }
      }
      
      console.log(`[PROWLARR] No magnet found, status: ${response.status}, content-type: ${response.headers.get('content-type')}`);
      magnetCache.set(downloadUrl, null);
      return null;
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log(`[PROWLARR] Request timeout resolving magnet`);
      } else {
        console.log(`[PROWLARR] Error resolving magnet: ${error.message}`);
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
}

module.exports = ProwlarrProvider;