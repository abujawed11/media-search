// Utility functions for extracting magnet links from various sources
import bencode from 'bencode';

/**
 * Extract magnet link from error messages or console output
 * @param {string} text - Text that might contain a magnet link
 * @returns {string|null} - Extracted magnet link or null if not found
 */
export function extractMagnetFromText(text) {
  if (!text || typeof text !== 'string') return null;

  // Enhanced regex to match magnet links more comprehensively
  // This will capture magnet links even if they span multiple lines or have special characters
  const magnetRegex = /magnet:\?[^\s"<>]+/gi;
  const matches = text.match(magnetRegex);

  if (matches && matches.length > 0) {
    // Return the longest magnet link (most complete)
    const longestMagnet = matches.reduce((longest, current) =>
      current.length > longest.length ? current : longest
    );

    console.log(`[EXTRACTOR] Found ${matches.length} magnet(s), returning longest: ${longestMagnet.substring(0, 100)}...`);
    return longestMagnet;
  }

  return null;
}

/**
 * Monitor console for magnet links and return the first one found
 * @param {number} timeout - How long to monitor in milliseconds
 * @returns {Promise<string|null>} - Promise that resolves with magnet link or null
 */
export function monitorConsoleForMagnet(timeout = 2000) {
  return new Promise((resolve) => {
    let foundMagnet = null;
    const originalError = console.error;
    const originalLog = console.log;
    const originalWarn = console.warn;

    // Override console methods to capture magnet links
    const captureMethod = (originalMethod) => (...args) => {
      if (!foundMagnet) {
        const message = args.join(' ');
        const magnet = extractMagnetFromText(message);
        if (magnet) {
          foundMagnet = magnet;
        }
      }
      originalMethod.apply(console, args);
    };

    console.error = captureMethod(originalError);
    console.log = captureMethod(originalLog);
    console.warn = captureMethod(originalWarn);

    // Clean up after timeout
    setTimeout(() => {
      console.error = originalError;
      console.log = originalLog;
      console.warn = originalWarn;
      resolve(foundMagnet);
    }, timeout);
  });
}

/**
 * Try to trigger a browser protocol error and capture magnet link
 * @param {string} url - URL that might redirect to magnet
 * @returns {Promise<string|null>} - Promise that resolves with magnet link or null
 */
export async function extractMagnetFromProtocolError(url) {
  return new Promise((resolve) => {
    // Start monitoring console
    const monitorPromise = monitorConsoleForMagnet(1500);

    // Try to trigger protocol error
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.style.visibility = 'hidden';
    iframe.style.position = 'absolute';
    iframe.style.left = '-9999px';

    iframe.onload = () => {
      // Sometimes the redirect happens on load
      setTimeout(() => {
        if (iframe.parentNode) {
          document.body.removeChild(iframe);
        }
      }, 1000);
    };

    iframe.onerror = () => {
      // Error might contain magnet link
      setTimeout(() => {
        if (iframe.parentNode) {
          document.body.removeChild(iframe);
        }
      }, 500);
    };

    document.body.appendChild(iframe);
    iframe.src = url;

    // Wait for monitor to complete
    monitorPromise.then((magnet) => {
      resolve(magnet);
    });
  });
}

/**
 * Copy magnet link from browser error message to clipboard
 * @param {string} url - URL to trigger magnet error
 * @returns {Promise<string|null>} - Promise that resolves with magnet link or null
 */
export async function copyMagnetFromError(url) {
  console.group(`[MAGNET_COPIER] 📋 Monitoring for magnet error message`);
  console.log(`📋 Target URL: ${url}`);

  return new Promise((resolve) => {
    let foundMagnet = null;

    // Override console.error to capture the "Failed to launch" message
    const originalError = console.error;

    console.error = (...args) => {
      const message = args.join(' ');

      // Look for the specific "Failed to launch" error message
      if (message.includes("Failed to launch 'magnet:") && message.includes("because the scheme does not have a registered handler")) {
        console.log(`🎯 FOUND TARGET ERROR MESSAGE!`);

        // Extract the magnet link from the error message
        const magnetMatch = message.match(/'(magnet:[^']+)'/);
        if (magnetMatch && magnetMatch[1]) {
          foundMagnet = magnetMatch[1];
          console.log(`✅ Extracted magnet: ${foundMagnet.substring(0, 100)}...`);

          // Copy to clipboard
          navigator.clipboard.writeText(foundMagnet).then(() => {
            console.log(`📋 ✅ Magnet link copied to clipboard!`);
            console.log(`🔗 Full magnet: ${foundMagnet}`);
          }).catch((clipboardError) => {
            console.warn(`📋 ❌ Failed to copy to clipboard:`, clipboardError);
            console.log(`🔗 Manual copy needed: ${foundMagnet}`);
          });

          // Restore original console.error
          console.error = originalError;
          console.groupEnd();
          resolve(foundMagnet);
          return;
        }
      }

      // Call original console.error
      originalError.apply(console, args);
    };

    // Create hidden iframe to trigger the error
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.style.visibility = 'hidden';
    iframe.style.position = 'absolute';
    iframe.style.left = '-9999px';
    iframe.style.top = '-9999px';
    iframe.style.width = '1px';
    iframe.style.height = '1px';

    // Set up timeout to clean up
    setTimeout(() => {
      console.error = originalError;
      if (iframe.parentNode) {
        document.body.removeChild(iframe);
      }

      if (foundMagnet) {
        console.log(`✅ SUCCESS: Magnet copied to clipboard`);
      } else {
        console.log(`❌ No magnet error message detected`);
      }
      console.groupEnd();
      resolve(foundMagnet);
    }, 5000); // Wait 5 seconds for the error

    // Start the process
    document.body.appendChild(iframe);
    iframe.src = url;

    console.log(`⏳ Waiting for "Failed to launch" error message...`);
  });
}

/**
 * Extract magnet link using multiple methods
 * @param {string} url - URL to extract magnet from
 * @returns {Promise<string|null>} - Promise that resolves with magnet link or null
 */
export async function extractMagnetMultiMethod(url) {
  console.group(`[MAGNET_EXTRACTOR] 🔍 Starting extraction process`);
  console.log(`📋 Input URL: ${url}`);
  console.log(`📏 URL Length: ${url.length}`);
  console.log(`🔗 URL Type: ${url.toLowerCase().includes('.torrent') ? '.torrent file' : 'other'}`);
  console.log(`🌐 URL Domain: ${new URL(url).hostname}`);

  // Method 1: Check if this is a download URL that should return a .torrent file
  const isDownloadUrl = url.includes('/download?') || url.includes('jackett_apikey') || url.toLowerCase().includes('.torrent') || url.includes('9696') || url.includes('9117');

  if (isDownloadUrl) {
    console.group(`[METHOD 1] 📄 Download URL detected - attempting torrent file extraction`);
    console.log(`🔍 URL analysis:`, {
      containsDownload: url.includes('/download?'),
      containsJackett: url.includes('jackett_apikey'),
      containsTorrent: url.toLowerCase().includes('.torrent'),
      isProwlarr: url.includes('9696'),
      isJackett: url.includes('9117')
    });

    try {
      console.log(`⏳ Attempting to download and parse .torrent file...`);
      const magnetFromTorrent = await extractMagnetFromTorrentFile(url);
      if (magnetFromTorrent) {
        console.log(`✅ SUCCESS! Extracted magnet: ${magnetFromTorrent.substring(0, 100)}...`);
        console.groupEnd();
        console.groupEnd();
        return magnetFromTorrent;
      } else {
        console.log(`❌ No magnet extracted from torrent file`);
      }
    } catch (error) {
      console.error(`❌ Torrent file parsing failed:`, error);
      console.log(`📊 Error details:`, {
        name: error.name,
        message: error.message,
        stack: error.stack?.split('\n')[0]
      });
    }
    console.groupEnd();
  } else {
    console.log(`[METHOD 1] ⏭️ Skipping .torrent parsing - URL doesn't appear to be a download URL`);
  }

  // Method 2: Protocol error capture
  console.group(`[METHOD 2] 🔄 Protocol error capture`);
  try {
    console.log(`⏳ Attempting protocol error capture...`);
    const magnetFromProtocol = await extractMagnetFromProtocolError(url);
    if (magnetFromProtocol) {
      console.log(`✅ SUCCESS! Extracted via protocol error: ${magnetFromProtocol.substring(0, 100)}...`);
      console.groupEnd();
      console.groupEnd();
      return magnetFromProtocol;
    } else {
      console.log(`❌ No magnet captured from protocol errors`);
    }
  } catch (error) {
    console.error(`❌ Protocol error method failed:`, error);
  }
  console.groupEnd();

  // Method 3: Enhanced redirect and error capture
  console.group(`[METHOD 3] 🌐 Enhanced redirect and error capture`);
  try {
    console.log(`⏳ Attempting to trigger redirect and capture magnet...`);

    // Method 3a: Try direct fetch to trigger redirect
    try {
      const response = await fetch(url, {
        method: 'GET',
        mode: 'no-cors',
        redirect: 'manual'
      });
      console.log(`📊 Fetch response status: ${response.status}`);
    } catch (fetchError) {
      console.log(`🔍 Checking fetch error for magnet links...`);
      console.log(`📝 Fetch error message: ${fetchError.message}`);

      const magnetFromFetch = extractMagnetFromText(fetchError.message);
      if (magnetFromFetch) {
        console.log(`✅ SUCCESS! Extracted from fetch error: ${magnetFromFetch.substring(0, 100)}...`);
        console.groupEnd();
        console.groupEnd();
        return magnetFromFetch;
      }
    }

    // Method 3b: Enhanced navigation error capture
    console.log(`⏳ Attempting enhanced navigation error capture...`);
    const magnetFromNav = await new Promise((resolve) => {
      let foundMagnet = null;
      let attempts = 0;
      const maxAttempts = 3;

      const tryCapture = () => {
        attempts++;
        console.log(`  Attempt ${attempts}/${maxAttempts}`);

        // Create temporary window to trigger navigation error
        const testWindow = window.open('', '_blank', 'width=1,height=1,left=-1000,top=-1000');

        setTimeout(() => {
          try {
            // Monitor for navigation errors and protocol handler activation
            const originalError = console.error;
            const originalWarn = console.warn;

            console.error = (...args) => {
              const message = args.join(' ');
              console.log(`  🔍 Console error captured: ${message.substring(0, 200)}`);
              const magnet = extractMagnetFromText(message);
              if (magnet && !foundMagnet) {
                foundMagnet = magnet;
                console.log(`  ✅ Magnet found in console error!`);
              }
              originalError.apply(console, args);
            };

            console.warn = (...args) => {
              const message = args.join(' ');
              console.log(`  🔍 Console warn captured: ${message.substring(0, 200)}`);
              const magnet = extractMagnetFromText(message);
              if (magnet && !foundMagnet) {
                foundMagnet = magnet;
                console.log(`  ✅ Magnet found in console warn!`);
              }
              originalWarn.apply(console, args);
            };

            // Try to navigate to the URL
            if (testWindow && !testWindow.closed) {
              testWindow.location.href = url;
            }

            // Restore console methods and close window after delay
            setTimeout(() => {
              console.error = originalError;
              console.warn = originalWarn;
              if (testWindow && !testWindow.closed) {
                testWindow.close();
              }

              if (foundMagnet) {
                resolve(foundMagnet);
              } else if (attempts < maxAttempts) {
                setTimeout(tryCapture, 500);
              } else {
                resolve(null);
              }
            }, 1000);

          } catch (windowError) {
            console.log(`  ⚠️ Window navigation error: ${windowError.message}`);
            const magnet = extractMagnetFromText(windowError.message);
            if (magnet && !foundMagnet) {
              foundMagnet = magnet;
              resolve(foundMagnet);
            } else if (attempts < maxAttempts) {
              setTimeout(tryCapture, 500);
            } else {
              resolve(null);
            }
          }
        }, 100);
      };

      tryCapture();
    });

    if (magnetFromNav) {
      console.log(`✅ SUCCESS! Extracted from navigation: ${magnetFromNav.substring(0, 100)}...`);
      console.groupEnd();
      console.groupEnd();
      return magnetFromNav;
    }

    console.log(`❌ No magnet captured from enhanced methods`);
  } catch (error) {
    console.error(`❌ Enhanced capture method failed:`, error);
  }
  console.groupEnd();

  // Method 4: Browser location monitoring for successful redirects
  console.group(`[METHOD 4] 🔍 Browser location monitoring`);
  try {
    console.log(`⏳ Monitoring browser location changes...`);

    const magnetFromLocation = await new Promise((resolve) => {
      let foundMagnet = null;
      let originalLocation = window.location.href;

      // Create a hidden iframe to trigger the redirect
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.style.width = '1px';
      iframe.style.height = '1px';
      iframe.style.position = 'absolute';
      iframe.style.left = '-9999px';
      iframe.style.top = '-9999px';

      // Monitor for location changes in the main window
      const locationChecker = setInterval(() => {
        if (window.location.href !== originalLocation) {
          const currentUrl = window.location.href;
          console.log(`  🔍 Location changed to: ${currentUrl.substring(0, 100)}...`);

          if (currentUrl.startsWith('magnet:')) {
            foundMagnet = currentUrl;
            console.log(`  ✅ Magnet link detected in location!`);
            clearInterval(locationChecker);
            resolve(foundMagnet);
            return;
          }
        }
      }, 100);

      // Also monitor the iframe's attempts to navigate
      iframe.onload = () => {
        console.log(`  📄 Iframe loaded`);
        try {
          const iframeUrl = iframe.contentWindow?.location?.href;
          if (iframeUrl && iframeUrl.startsWith('magnet:')) {
            foundMagnet = iframeUrl;
            console.log(`  ✅ Magnet found in iframe location!`);
            clearInterval(locationChecker);
            resolve(foundMagnet);
          }
        } catch (e) {
          // Cross-origin restrictions prevent access
          console.log(`  ⚠️ Iframe cross-origin restriction: ${e.message}`);
          const magnet = extractMagnetFromText(e.message);
          if (magnet) {
            foundMagnet = magnet;
            clearInterval(locationChecker);
            resolve(foundMagnet);
          }
        }
      };

      iframe.onerror = (e) => {
        console.log(`  ⚠️ Iframe error: ${e.message || 'Unknown error'}`);
        const magnet = extractMagnetFromText(e.message || e.toString());
        if (magnet) {
          foundMagnet = magnet;
          clearInterval(locationChecker);
          resolve(foundMagnet);
        }
      };

      // Set up timeout
      setTimeout(() => {
        clearInterval(locationChecker);
        if (iframe.parentNode) {
          document.body.removeChild(iframe);
        }
        resolve(foundMagnet);
      }, 3000);

      // Start the process
      document.body.appendChild(iframe);
      iframe.src = url;
    });

    if (magnetFromLocation) {
      console.log(`✅ SUCCESS! Extracted from location monitoring: ${magnetFromLocation.substring(0, 100)}...`);
      console.groupEnd();
      console.groupEnd();
      return magnetFromLocation;
    }

    console.log(`❌ No magnet detected from location monitoring`);
  } catch (error) {
    console.error(`❌ Location monitoring failed:`, error);
  }
  console.groupEnd();

  console.log(`❌ ALL METHODS FAILED for URL: ${url}`);
  console.groupEnd();
  return null;
}

/**
 * Convert array buffer to hex string
 * @param {ArrayBuffer} buffer - Buffer to convert
 * @returns {string} - Hex string
 */
function arrayBufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Parse .torrent file and extract magnet link
 * @param {ArrayBuffer} torrentData - Raw torrent file data
 * @returns {Promise<string|null>} - Promise that resolves with magnet link or null if parsing fails
 */
export async function parseTorrentFile(torrentData) {
  console.group('[TORRENT_PARSER] 🔧 Parsing torrent file');

  try {
    console.log('📦 Data size:', torrentData.byteLength, 'bytes');
    console.log('🔍 Data type:', torrentData.constructor.name);

    // Decode the torrent file
    console.log('⏳ Decoding bencode data...');
    const torrent = bencode.decode(new Uint8Array(torrentData));
    console.log('✅ Bencode decode successful');
    console.log('📋 Torrent keys:', Object.keys(torrent));

    if (!torrent || !torrent.info) {
      console.error('❌ Invalid torrent file: missing info section');
      console.log('📊 Torrent object:', torrent);
      console.groupEnd();
      return null;
    }

    console.log('📋 Info section keys:', Object.keys(torrent.info));
    console.log('📄 Torrent name:', torrent.info.name ? torrent.info.name.toString() : 'No name');

    // Calculate info hash (SHA1 of info section)
    console.log('⏳ Calculating info hash...');
    const infoBuffer = bencode.encode(torrent.info);
    console.log('📦 Info buffer size:', infoBuffer.length, 'bytes');

    const infoHash = await crypto.subtle.digest('SHA-1', infoBuffer);
    const infoHashHex = arrayBufferToHex(infoHash);
    console.log('🔑 Info hash (hex):', infoHashHex);
    console.log('🔑 Info hash (base32):', infoHashHex.toUpperCase());

    // Extract torrent name
    const name = torrent.info.name ? torrent.info.name.toString() : 'Unknown';
    console.log('📛 Display name:', name);

    // Extract trackers
    console.log('⏳ Extracting trackers...');
    const trackers = [];

    // Single announce URL
    if (torrent.announce) {
      const announceUrl = torrent.announce.toString();
      trackers.push(announceUrl);
      console.log('📡 Single announce:', announceUrl);
    }

    // Multiple announce URLs
    if (torrent['announce-list'] && Array.isArray(torrent['announce-list'])) {
      console.log('📡 Processing announce-list...');
      torrent['announce-list'].forEach((tier, tierIndex) => {
        console.log(`  Tier ${tierIndex}:`, tier);
        if (Array.isArray(tier)) {
          tier.forEach(tracker => {
            if (tracker) {
              const trackerUrl = tracker.toString();
              trackers.push(trackerUrl);
              console.log(`    Tracker: ${trackerUrl}`);
            }
          });
        }
      });
    }

    console.log('📊 Total trackers found:', trackers.length);

    // Build magnet link
    console.log('⏳ Building magnet link...');
    let magnetLink = `magnet:?xt=urn:btih:${infoHashHex}`;

    // Add display name
    if (name) {
      magnetLink += `&dn=${encodeURIComponent(name)}`;
    }

    // Add trackers
    trackers.forEach((tracker, index) => {
      magnetLink += `&tr=${encodeURIComponent(tracker)}`;
      if (index < 3) console.log(`  Added tracker ${index + 1}: ${tracker}`);
    });

    console.log('✅ Magnet link generated successfully!');
    console.log('🧲 Magnet link:', magnetLink.substring(0, 150) + '...');
    console.log('📏 Magnet length:', magnetLink.length);
    console.groupEnd();

    return magnetLink;

  } catch (error) {
    console.error('❌ Parsing failed:', error);
    console.log('📊 Error details:', {
      name: error.name,
      message: error.message,
      stack: error.stack?.split('\n').slice(0, 3)
    });
    console.groupEnd();
    return null;
  }
}

/**
 * Download and parse .torrent file to extract magnet link
 * @param {string} torrentUrl - URL to .torrent file
 * @returns {Promise<string|null>} - Promise that resolves with magnet link or null
 */
export async function extractMagnetFromTorrentFile(torrentUrl) {
  console.group('[TORRENT_DOWNLOADER] 📥 Downloading .torrent file');
  console.log('🔗 URL:', torrentUrl);

  try {
    console.log('⏳ Attempting direct fetch...');
    console.log('📋 Request headers:', {
      'Accept': 'application/x-bittorrent',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    });

    // Try to fetch the .torrent file with different approaches
    let response;

    // Special handling for localhost/127.0.0.1 URLs (Prowlarr/Jackett)
    if (torrentUrl.includes('127.0.0.1') || torrentUrl.includes('localhost')) {
      console.log('🏠 Localhost URL detected - trying fetch with CORS mode');
      try {
        response = await fetch(torrentUrl, {
          method: 'GET',
          mode: 'cors', // Allow CORS for localhost
          headers: {
            'Accept': 'application/x-bittorrent, application/octet-stream, */*',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });
      } catch (corsError) {
        console.log('❌ CORS fetch failed, trying no-cors mode:', corsError.message);
        // Try with no-cors as fallback
        response = await fetch(torrentUrl, {
          method: 'GET',
          mode: 'no-cors',
          headers: {
            'Accept': 'application/x-bittorrent, application/octet-stream, */*'
          }
        });
      }
    } else {
      // Regular fetch for external URLs
      response = await fetch(torrentUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/x-bittorrent, application/octet-stream, */*',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
    }

    console.log('📊 Response status:', response.status, response.statusText);
    console.log('📋 Response headers:', Object.fromEntries(response.headers.entries()));

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type');
    console.log('📄 Content-Type:', contentType);

    const torrentData = await response.arrayBuffer();
    console.log('✅ Download successful!');
    console.log('📦 File size:', torrentData.byteLength, 'bytes');
    console.log('🔍 First 20 bytes (hex):', Array.from(new Uint8Array(torrentData.slice(0, 20))).map(b => b.toString(16).padStart(2, '0')).join(' '));

    // Parse the torrent file
    console.groupEnd();
    return await parseTorrentFile(torrentData);

  } catch (error) {
    console.error('❌ Direct fetch failed:', error);
    console.log('📊 Error details:', {
      name: error.name,
      message: error.message,
      stack: error.stack?.split('\n')[0]
    });

    // Try different proxy methods
    const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
    const proxyMethods = [
      {
        name: 'Backend Proxy',
        getUrl: () => `${API_BASE}/api/proxy-torrent`,
        getOptions: () => ({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: torrentUrl })
        })
      },
    ];

    for (const proxy of proxyMethods) {
      try {
        console.log(`🔄 Trying ${proxy.name}...`);
        const proxyUrl = proxy.getUrl();
        console.log('🔗 Proxy URL:', proxyUrl);

        const proxyResponse = await fetch(proxyUrl, proxy.getOptions());
        console.log('📊 Proxy response status:', proxyResponse.status, proxyResponse.statusText);

        if (proxyResponse.ok) {
          const ct = proxyResponse.headers.get('content-type') || '';
          // Backend proxy now returns JSON {"magnet":"..."} when it finds a magnet redirect
          if (ct.includes('application/json') || ct.includes('text/')) {
            const json = await proxyResponse.json().catch(() => null);
            if (json?.magnet) {
              console.log(`✅ ${proxy.name} returned magnet JSON`);
              console.groupEnd();
              return json.magnet;
            }
          }
          // Binary torrent file
          const torrentData = await proxyResponse.arrayBuffer();
          console.log(`✅ ${proxy.name} download successful!`);
          console.log('📦 File size:', torrentData.byteLength, 'bytes');
          console.groupEnd();
          return await parseTorrentFile(torrentData);
        } else {
          console.log(`❌ ${proxy.name} returned error status`);
        }
      } catch (proxyError) {
        console.error(`❌ ${proxy.name} failed:`, proxyError.message);
      }
    }

    console.groupEnd();
    return null;
  }
}

//===========================================================================



/**
 * Try to read a redirect Location header without following it.
 * Works only if same-origin or CORS exposes `Location`.
 * @param {string} url
 * @returns {Promise<string|null>}
 */
export async function tryExtractMagnetFromRedirect(url) {
  try {
    const res = await fetch(url, { redirect: 'manual' });
    const loc = res.headers.get('Location');
    if (loc && loc.startsWith('magnet:')) return loc;
  } catch (_) {}
  return null;
}

/** Clipboard helper with fallback for http/older browsers */
export async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (_) {}
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', 'true');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  ta.style.pointerEvents = 'none';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try { document.execCommand('copy'); } catch (_) {}
  document.body.removeChild(ta);
}

/**
 * Resolve a magnet from many sources and copy it.
 * Call this inside a user gesture (click) for best results.
 *
 * @param {string|HTMLElement|(() => (string|Promise<string>))} source
 *   - string: "magnet:..." OR "https://..." that redirects to magnet (same-origin/CORS)
 *   - element: tries data-magnet or href
 *   - function: returns/awaits a magnet string
 * @param {{ openAfter?: boolean }} [opts]
 * @returns {Promise<string>} copied magnet
 */
export async function copyMagnetSmart(source, opts = {}) {
  const { openAfter = false } = opts;

  // 1) Resolve the magnet value
  const magnet = await (async () => {
    if (typeof source === 'function') {
      const v = await source();
      if (typeof v === 'string') return v;
      throw new Error('Resolver function did not return a string');
    }

    if (source && typeof source === 'object' && 'nodeType' in source) {
      const el = /** @type {HTMLElement} */(source);
      const dataMagnet = el.getAttribute('data-magnet') || el.dataset?.magnet;
      if (dataMagnet?.startsWith('magnet:')) return dataMagnet;

      const href = el.getAttribute?.('href') || '';
      if (href?.startsWith('magnet:')) return href;

      if (href && /^https?:/i.test(href)) {
        const redirected = await tryExtractMagnetFromRedirect(href);
        if (redirected) return redirected;
      }
      throw new Error('Could not find magnet in element (data-magnet/href)');
    }

    if (typeof source === 'string') {
      if (source.startsWith('magnet:')) return source;
      if (/^https?:/i.test(source)) {
        const redirected = await tryExtractMagnetFromRedirect(source);
        if (redirected) return redirected;
      }
      throw new Error('Source must be a magnet: URL or a redirecting http(s) URL');
    }

    throw new Error('Unsupported source type');
  })();

  // 2) Copy
  await copyText(magnet);

  // 3) Optionally try to open after copying (best-effort)
  if (openAfter) {
    try { window.location.assign(magnet); } catch (_) {}
  }

  return magnet;
}
