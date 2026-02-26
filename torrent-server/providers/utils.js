// Shared utility for following redirect chains that may end in magnet: URLs.
// Node.js fetch with redirect:'follow' throws TypeError when it hits magnet:,
// so we follow HTTP(S) redirects manually and stop when we find a magnet.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const MAGNET_RE = /magnet:\?[^"'\s<>&]+/;

/**
 * Follow a URL chain manually until we find a magnet link.
 * Handles three cases:
 *   1. A redirect whose Location header is magnet:?...
 *   2. A 200 HTML/text body containing a magnet link
 *   3. A 200 binary body that looks like a .torrent file
 *
 * @param {string}  startUrl
 * @param {object}  [opts]
 * @param {number}  [opts.maxHops=12]
 * @param {number}  [opts.timeoutMs=15000]  per-hop timeout
 * @returns {Promise<string|null>}  magnet string or null
 */
async function followRedirectsToMagnet(startUrl, { maxHops = 12, timeoutMs = 15_000 } = {}) {
  let url = startUrl;

  for (let hop = 0; hop < maxHops; hop++) {
    // If any redirect was itself a magnet: link, we're done
    if (url.startsWith('magnet:')) {
      return url;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res;
    try {
      res = await fetch(url, {
        redirect: 'manual',          // <-- key: don't let fetch auto-follow
        signal: controller.signal,
        headers: { 'User-Agent': UA },
      });
    } finally {
      clearTimeout(timer);
    }

    // ── Redirect ──────────────────────────────────────────────────────────
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) {
        console.log(`[UTILS] Redirect with no Location header at hop ${hop}`);
        break;
      }
      console.log(`[UTILS] Hop ${hop}: ${res.status} → ${location.substring(0, 120)}`);
      url = location; // may be magnet:, will be detected at top of next loop
      continue;
    }

    // ── 200 OK ────────────────────────────────────────────────────────────
    if (res.ok) {
      const ct = (res.headers.get('content-type') || '').toLowerCase();

      // Binary torrent — parse it to extract info hash
      if (ct.includes('bittorrent') || ct.includes('octet-stream')) {
        console.log(`[UTILS] Got binary torrent at hop ${hop}, extracting magnet...`);
        const magnet = await extractMagnetFromTorrentBuffer(await res.arrayBuffer());
        return magnet; // may be null
      }

      // HTML / text — scrape for magnet link
      const text = await res.text();
      const match = text.match(MAGNET_RE);
      if (match) {
        console.log(`[UTILS] Found magnet in body at hop ${hop}`);
        return match[0];
      }

      console.log(`[UTILS] 200 body has no magnet link (${ct}, ${text.length} chars)`);
      break;
    }

    // ── Error ─────────────────────────────────────────────────────────────
    console.log(`[UTILS] HTTP ${res.status} at hop ${hop} for ${url.substring(0, 100)}`);
    break;
  }

  return null;
}

/**
 * Parse a .torrent ArrayBuffer and return a magnet: link.
 * Uses a minimal bencode parser — no npm dependency needed.
 */
const crypto = require('crypto');

async function extractMagnetFromTorrentBuffer(arrayBuffer) {
  try {
    const buf = Buffer.from(arrayBuffer);
    const str = buf.toString('latin1');

    const infoIdx = str.indexOf('4:info');
    if (infoIdx === -1) return null;

    // Walk the bencode to find end of the info dict
    let i = infoIdx + 6; // skip '4:info'
    let depth = 0;
    let inStr = false, strLeft = 0;

    for (; i < str.length; i++) {
      if (inStr) { if (--strLeft <= 0) inStr = false; continue; }
      const c = str[i];
      if (c >= '0' && c <= '9') {
        let numStr = '';
        let j = i;
        while (j < str.length && str[j] >= '0' && str[j] <= '9') numStr += str[j++];
        if (str[j] === ':') { strLeft = parseInt(numStr); inStr = true; i = j; continue; }
      }
      if (c === 'd' || c === 'l') depth++;
      else if (c === 'e') { if (--depth === 0) { i++; break; } }
    }

    const infoHash = crypto
      .createHash('sha1')
      .update(buf.slice(infoIdx + 6, i))
      .digest('hex');

    // Try to get the name
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
