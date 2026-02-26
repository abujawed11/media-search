import { useState } from 'react';
import { extractMagnetMultiMethod } from '../utils/magnetExtractor';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

export function useTorrentSearch() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [allResults, setAllResults] = useState([]);

  const fetchIndexers = async (provider) => {
    const response = await fetch(`${API_BASE_URL}/api/indexers?provider=${provider}`);
    if (!response.ok) throw new Error("Failed to fetch indexers");
    const data = await response.json();
    return data.indexers || [];
  };

  const search = async (query, provider, category = "", indexer = "") => {
    if (!query.trim()) return;

    try {
      setError(null);
      setLoading(true);

      const params = new URLSearchParams({ q: query, provider });
      if (category) params.set("cat", category);
      if (indexer) params.set("indexer", indexer);

      const response = await fetch(`${API_BASE_URL}/api/search?${params.toString()}`);
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data?.error || "Search failed");
      }
      
      setAllResults(data.results || []);
    } catch (e) {
      setAllResults([]);
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  const sendToQB = async (magnet, setSendState) => {
    try {
      setSendState("sending…");
      const response = await fetch(`${API_BASE_URL}/api/qbit/add`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ magnet }),
      });
      
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error || "Failed");
      
      setSendState("added ✓");
      setTimeout(() => setSendState(""), 1500);
    } catch (e) {
      setSendState("error");
      setTimeout(() => setSendState(""), 1600);
      alert("Failed to send to qBittorrent: " + String(e?.message || e));
    }
  };

  const copyMagnet = async (magnet, setCopiedMagnet) => {
    try {
      await navigator.clipboard.writeText(magnet);
      setCopiedMagnet(magnet);
      setTimeout(() => setCopiedMagnet(""), 2000);
    } catch (e) {
      alert("Failed to copy magnet link: " + e.message);
    }
  };

  const sendToWebTorrent = async (magnet, webTorrentUrl) => {
    try {
      // Option 1: Open WebTorrent site with magnet as URL parameter
      const url = new URL(webTorrentUrl);
      url.searchParams.set('magnet', magnet);
      window.open(url.toString(), '_blank');

      return true;
    } catch (e) {
      // Option 2: Try to post message to WebTorrent site if it's already open
      try {
        const webTorrentWindow = window.open(webTorrentUrl, 'webtorrent');
        if (webTorrentWindow) {
          // Wait a moment for page to load, then post message
          setTimeout(() => {
            webTorrentWindow.postMessage({
              type: 'ADD_TORRENT',
              magnet: magnet
            }, '*');
          }, 1000);
          return true;
        }
      } catch (postError) {
        console.error('Failed to send magnet to WebTorrent:', postError);
        return false;
      }
    }
  };

  const resolveMagnet = async (downloadUrl, provider, setCopiedMagnet) => {
    try {
      setCopiedMagnet("resolving...");

      // Method 1: Try the backend API
      try {
        const response = await fetch(`${API_BASE_URL}/api/resolve-magnet`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ downloadUrl, provider }),
        });

        const result = await response.json();
        if (response.ok && result.magnet) {
          await navigator.clipboard.writeText(result.magnet);
          setCopiedMagnet(result.magnet);
          setTimeout(() => setCopiedMagnet(""), 2000);
          return;
        }

        throw new Error(result?.error || "Backend resolution failed");
      } catch (backendError) {
        console.log("Backend magnet resolution failed:", backendError.message);

        // Method 2: Try the improved magnet extraction
        const magnetFromError = await extractMagnetMultiMethod(downloadUrl);

        if (magnetFromError) {
          await navigator.clipboard.writeText(magnetFromError);
          setCopiedMagnet(magnetFromError);
          setTimeout(() => setCopiedMagnet(""), 2000);
          return;
        }

        throw new Error("Could not resolve magnet link through any method");
      }
    } catch (e) {
      setCopiedMagnet("");
      alert("Failed to resolve magnet link: " + String(e?.message || e) + "\n\nTip: Try clicking the 'Direct' link and check browser console for magnet links in error messages.");
    }
  };

  return {
    loading,
    error,
    allResults,
    search,
    fetchIndexers,
    sendToQB,
    copyMagnet,
    resolveMagnet,
    sendToWebTorrent
  };
}