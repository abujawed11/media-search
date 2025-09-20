/**
 * Resolves magnet links from URLs that redirect to magnet: URLs
 * @param {string} downloadUrl - The URL to resolve
 * @returns {Promise<string>} - The resolved magnet link
 * @throws {Error} - If the magnet could not be resolved
 */
export async function resolveMagnetViaApi(downloadUrl) {
  if (!downloadUrl) {
    throw new Error('Download URL is required');
  }

  // If it's already a magnet link, return it as-is
  if (downloadUrl.startsWith('magnet:')) {
    return downloadUrl;
  }

  try {
    const response = await fetch('/api/resolve-magnet', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: downloadUrl }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (!data.magnet) {
      throw new Error('No magnet link found in response');
    }

    if (!data.magnet.startsWith('magnet:')) {
      throw new Error('Invalid magnet link format');
    }

    return data.magnet;
  } catch (error) {
    // Re-throw with more context
    throw new Error(`Failed to resolve magnet link: ${error.message}`);
  }
}