import { useState, useRef } from 'react';
import { extractMagnetMultiMethod } from '../utils/magnetExtractor';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

export function useTorrentSearch() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [allResults, setAllResults] = useState([]);
  const abortRef = useRef(null);

  const fetchIndexers = async (provider) => {
    const response = await fetch(`${API_BASE_URL}/api/indexers?provider=${provider}`);
    if (!response.ok) throw new Error("Failed to fetch indexers");
    const data = await response.json();
    return data.indexers || [];
  };

  const abortSearch = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setLoading(false);
  };

  const search = async (query, provider, category = "", indexer = "") => {
    if (!query.trim()) return;

    // Cancel any in-flight request before starting a new one
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    try {
      setError(null);
      setLoading(true);

      const params = new URLSearchParams({ q: query, provider });
      if (category) params.set("cat", category);
      if (indexer) params.set("indexer", indexer);

      const response = await fetch(`${API_BASE_URL}/api/search?${params.toString()}`, { signal });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Search failed");
      }

      setAllResults(data.results || []);
    } catch (e) {
      if (e.name === 'AbortError') return; // user cancelled — no error shown
      setAllResults([]);
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
      abortRef.current = null;
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

      // Method 1: provider-specific resolver (uses Prowlarr/Jackett redirect logic)
      try {
        const response = await fetch(`${API_BASE_URL}/api/resolve-magnet-provider`, {
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
      } catch (e) {
        console.log("Provider resolver failed:", e.message);
      }

      // Method 2: generic redirect resolver — field name must be 'url'
      try {
        const response = await fetch(`${API_BASE_URL}/api/resolve-magnet`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: downloadUrl }),
        });
        const result = await response.json();
        if (response.ok && result.magnet) {
          await navigator.clipboard.writeText(result.magnet);
          setCopiedMagnet(result.magnet);
          setTimeout(() => setCopiedMagnet(""), 2000);
          return;
        }
      } catch (e) {
        console.log("Generic resolver failed:", e.message);
      }

      // Method 3: client-side extraction fallback
      const magnetFromError = await extractMagnetMultiMethod(downloadUrl);
      if (magnetFromError) {
        await navigator.clipboard.writeText(magnetFromError);
        setCopiedMagnet(magnetFromError);
        setTimeout(() => setCopiedMagnet(""), 2000);
        return;
      }

      throw new Error("Could not resolve magnet link through any method");
    } catch (e) {
      setCopiedMagnet("");
      alert("Failed to resolve magnet link: " + String(e?.message || e));
    }
  };

  const clearResults = () => setAllResults([]);

  return {
    loading,
    error,
    allResults,
    search,
    abortSearch,
    clearResults,
    fetchIndexers,
    sendToQB,
    copyMagnet,
    resolveMagnet,
    sendToWebTorrent
  };
}