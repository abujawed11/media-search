// Shared utility for following redirect chains that may end in magnet: URLs.
// Node.js fetch with redirect:'follow' throws TypeError when it hits magnet:,
// so we follow HTTP(S) redirects manually and stop when we find a magnet.

const crypto = require('crypto');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Allow & in magnet URLs — stops only at whitespace, quotes, angle brackets
const MAGNET_RE = /magnet:\?[^\s"'<>]+/;

/**
 * Follow a URL chain manually until we find a magnet link.
 * Handles:
 *   1. Redirect whose Location header IS a magnet: URL (most common for 1337x, TorrentGalaxy)
 *   2. Redirect chain through multiple HTTP hops before reaching magnet
 *   3. 200 HTML/text body containing a magnet: link (scraping)
 *   4. 200 binary body that is a .torrent file (parse info hash → build magnet)
 */
async function followRedirectsToMagnet(startUrl, { maxHops = 12, timeoutMs = 15_000 } = {}) {
  let url = startUrl;

  for (let hop = 0; hop < maxHops; hop++) {
    // Already a magnet — return immediately
    if (url.startsWith('magnet:')) {
      console.log(`[UTILS] Magnet URL at hop ${hop}`);
      return url;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res;
    try {
      res = await fetch(url, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': UA },
      });
    } finally {
      clearTimeout(timer);
    }

    console.log(`[UTILS] Hop ${hop}: status=${res.status} url=${url.substring(0, 100)}`);

    // ── Redirect ────────────────────────────────────────────────────────────
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) {
        console.log(`[UTILS] Redirect with no Location header, giving up`);
        break;
      }
      console.log(`[UTILS] → ${location.substring(0, 120)}`);
      url = location;
      continue;
    }

    // ── 200 OK ──────────────────────────────────────────────────────────────
    if (res.ok) {
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      console.log(`[UTILS] 200 content-type: "${ct}"`);

      // Read body as buffer so we can try both binary and text
      const buf = Buffer.from(await res.arrayBuffer());

      // 1. Detect binary torrent by content-type OR by bencode signature (starts with 'd')
      const looksLikeTorrent = ct.includes('bittorrent') ||
        ct.includes('octet-stream') ||
        (buf.length > 0 && buf[0] === 0x64); // 'd' = bencode dict

      if (looksLikeTorrent) {
        console.log(`[UTILS] Trying binary torrent parse (${buf.length} bytes)...`);
        const magnet = await extractMagnetFromTorrentBuffer(buf);
        if (magnet) {
          console.log(`[UTILS] Extracted magnet from torrent`);
          return magnet;
        }
        console.log(`[UTILS] Torrent parse failed, falling through to text scrape`);
      }

      // 2. Scrape body text for magnet: link
      const text = buf.toString('utf-8');
      const match = text.match(MAGNET_RE);
      if (match) {
        // Decode HTML entities so &amp; → & in the magnet URL
        const magnet = match[0].replace(/&amp;/gi, '&');
        console.log(`[UTILS] Found magnet in body text`);
        return magnet;
      }

      // 3. Last resort: try torrent parse even if content-type said HTML
      //    (some servers mislabel .torrent files)
      if (!looksLikeTorrent && buf.length > 0) {
        const magnet = await extractMagnetFromTorrentBuffer(buf);
        if (magnet) {
          console.log(`[UTILS] Extracted magnet from mislabeled torrent`);
          return magnet;
        }
      }

      console.log(`[UTILS] 200 body has no magnet (ct="${ct}", ${buf.length} bytes)`);
      break;
    }

    // ── Error ────────────────────────────────────────────────────────────────
    console.log(`[UTILS] HTTP ${res.status} — giving up`);
    break;
  }

  return null;
}

/**
 * Parse a .torrent Buffer and return a magnet: link.
 * Minimal bencode walker — no npm dependency.
 */
async function extractMagnetFromTorrentBuffer(bufOrArrayBuffer) {
  try {
    const buf = Buffer.isBuffer(bufOrArrayBuffer)
      ? bufOrArrayBuffer
      : Buffer.from(bufOrArrayBuffer);

    const str = buf.toString('latin1');

    const infoIdx = str.indexOf('4:info');
    if (infoIdx === -1) return null;

    // Walk bencode to find end of info dict
    let i = infoIdx + 6; // skip '4:info'
    let depth = 0;
    let inStr = false, strLeft = 0;

    for (; i < str.length; i++) {
      if (inStr) { if (--strLeft <= 0) inStr = false; continue; }
      const c = str[i];
      if (c >= '0' && c <= '9') {
        let numStr = '', j = i;
        while (j < str.length && str[j] >= '0' && str[j] <= '9') numStr += str[j++];
        if (str[j] === ':') { strLeft = parseInt(numStr); inStr = true; i = j; continue; }
      }
      if (c === 'd' || c === 'l') depth++;
      else if (c === 'e') { if (--depth === 0) { i++; break; } }
    }

    if (depth !== 0) return null;

    const infoHash = crypto
      .createHash('sha1')
      .update(buf.slice(infoIdx + 6, i))
      .digest('hex');

    const nameMatch = str.match(/4:name(\d+):/);
    let name = 'Unknown';
    if (nameMatch) {
      const nameLen = parseInt(nameMatch[1]);
      const nameStart = str.indexOf(nameMatch[0]) + nameMatch[0].length;
      name = str.substring(nameStart, nameStart + nameLen);
    }

    return `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(name)}`;
  } catch (e) {
    console.log(`[UTILS] Torrent parse error: ${e.message}`);
    return null;
  }
}

module.exports = { followRedirectsToMagnet };
