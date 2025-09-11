import { useState } from 'react';

export function useTorrentSearch() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [allResults, setAllResults] = useState([]);

  const search = async (query, provider, category = "") => {
    if (!query.trim()) return;

    try {
      setError(null);
      setLoading(true);
      
      const params = new URLSearchParams({ q: query, provider });
      if (category) params.set("cat", category);
      
      const response = await fetch(`/api/search?${params.toString()}`);
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
      const response = await fetch("/api/qbit/add", {
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

  return {
    loading,
    error,
    allResults,
    search,
    sendToQB,
    copyMagnet
  };
}