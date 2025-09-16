// Utility functions for extracting magnet links from various sources

/**
 * Extract magnet link from error messages or console output
 * @param {string} text - Text that might contain a magnet link
 * @returns {string|null} - Extracted magnet link or null if not found
 */
export function extractMagnetFromText(text) {
  if (!text || typeof text !== 'string') return null;

  // Regex to match magnet links
  const magnetRegex = /magnet:\?[^'\s"<>&]+/i;
  const match = text.match(magnetRegex);

  return match ? match[0] : null;
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
    let foundMagnet = null;

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
 * Extract magnet link using multiple methods
 * @param {string} url - URL to extract magnet from
 * @returns {Promise<string|null>} - Promise that resolves with magnet link or null
 */
export async function extractMagnetMultiMethod(url) {
  console.log(`[MAGNET_EXTRACTOR] Attempting to extract magnet from: ${url}`);

  // Method 1: Protocol error capture
  try {
    const magnetFromProtocol = await extractMagnetFromProtocolError(url);
    if (magnetFromProtocol) {
      console.log(`[MAGNET_EXTRACTOR] Successfully extracted via protocol error: ${magnetFromProtocol.substring(0, 100)}...`);
      return magnetFromProtocol;
    }
  } catch (error) {
    console.log(`[MAGNET_EXTRACTOR] Protocol error method failed:`, error);
  }

  // Method 2: Direct fetch (might cause CORS, but worth trying)
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      mode: 'no-cors'
    });
    // If we get here, the URL might be accessible
    // But we can't read the response due to CORS
    console.log(`[MAGNET_EXTRACTOR] Direct fetch completed, but can't read response due to CORS`);
  } catch (error) {
    // Check if error message contains magnet
    const magnet = extractMagnetFromText(error.message);
    if (magnet) {
      console.log(`[MAGNET_EXTRACTOR] Extracted from fetch error: ${magnet.substring(0, 100)}...`);
      return magnet;
    }
  }

  console.log(`[MAGNET_EXTRACTOR] All methods failed for: ${url}`);
  return null;
}