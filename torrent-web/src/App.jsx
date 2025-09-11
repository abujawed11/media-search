import { useMemo, useState } from "react";
import "./App.css";

export default function App() {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState(""); // Torznab category (e.g., 2000 Movies, 5000 TV)
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);
  const [sendState, setSendState] = useState("");
  const [copiedMagnet, setCopiedMagnet] = useState("");

  const totalSeeders = useMemo(
    () => rows.reduce((a, r) => a + (r.seeders ?? 0), 0),
    [rows]
  );

  async function onSearch() {
    try {
      setError(null);
      setLoading(true);
      const p = new URLSearchParams({ q });
      if (cat) p.set("cat", cat);
      const r = await fetch(`/api/search?${p.toString()}`);
      const data = await r.json();
      // console.log("Data:", data);
      // console.log("First result magnet:", data.results?.[0]?.magnet);
      // console.log("First result link:", data.results?.[0]?.link);
      if (!r.ok) throw new Error(data?.error || "Search failed");
      setRows(data.results || []);
    } catch (e) {
      setRows([]);
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  async function sendToQB(magnet) {
    try {
      setSendState("sending…");
      const r = await fetch("/api/qbit/add", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ magnet }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Failed");
      setSendState("added ✓");
      setTimeout(() => setSendState(""), 1500);
    } catch (e) {
      setSendState("error");
      setTimeout(() => setSendState(""), 1600);
      alert("Failed to send to qBittorrent: " + String(e?.message || e));
    }
  }

  async function copyMagnet(magnet) {
    try {
      await navigator.clipboard.writeText(magnet);
      setCopiedMagnet(magnet);
      setTimeout(() => setCopiedMagnet(""), 2000);
    } catch (e) {
      alert("Failed to copy magnet link: " + e.message);
    }
  }

  return (
    <div className="layout">
      <h1 className="title">Torrent Meta-Search</h1>

      <div className="controls">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e)=> e.key === 'Enter' && onSearch()}
          placeholder="Search movies, TV, software, etc."
          className="input"
        />
        <input
          value={cat}
          onChange={(e) => setCat(e.target.value)}
          placeholder="Category (e.g., 2000)"
          className="input small"
          title="Torznab category IDs, e.g., 2000 Movies, 5000 TV"
        />
        <button onClick={onSearch} disabled={!q || loading} className="btn">
          {loading ? "Searching…" : "Search"}
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="meta">
        {rows.length ? `${rows.length} results • total seeders ~ ${totalSeeders}` : null}
        {sendState && <span className="status">{sendState}</span>}
      </div>

      {/* Debug section */}
      {rows.length > 0 && (
        <details style={{ marginBottom: '20px', fontSize: '12px' }}>
          <summary style={{ cursor: 'pointer', color: '#666' }}>🔍 Debug: First Result Data</summary>
          <pre style={{ background: '#f5f5f5', padding: '10px', overflow: 'auto', fontSize: '11px' }}>
            {JSON.stringify({
              title: rows[0]?.title,
              magnet: rows[0]?.magnet ? `${rows[0].magnet.substring(0, 100)}...` : null,
              link: rows[0]?.link,
              tracker: rows[0]?.tracker
            }, null, 2)}
          </pre>
        </details>
      )}

      <div className="tableWrap">
        <table className="table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Seed</th>
              <th>Leech</th>
              <th>Size</th>
              <th>Tracker</th>
              <th>Date</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.title}</td>
                <td className="center">{r.seeders ?? "-"}</td>
                <td className="center">{r.leechers ?? "-"}</td>
                <td>{formatSize(r.size)}</td>
                <td>{r.tracker || "-"}</td>
                <td>{r.published ? new Date(r.published).toLocaleString() : "-"}</td>
                <td className="actions">
                  {r.magnet && (
                    <>
                      <button 
                        onClick={() => copyMagnet(r.magnet)}
                        className="link"
                        title="Copy magnet link"
                        style={{ 
                          background: 'none', 
                          border: 'none', 
                          color: '#3b82f6',
                          cursor: 'pointer',
                          marginRight: '8px'
                        }}
                      >
                        {copiedMagnet === r.magnet ? '✓ Copied' : '🧲 Copy'}
                      </button>
                      <a href={r.magnet} className="link">Direct</a>
                    </>
                  )}
                  {!r.magnet && r.link && (
                    <a href={r.link} className="link">.torrent</a>
                  )}
                  {r.magnet && (
                    <button onClick={() => sendToQB(r.magnet)} className="btnGhost">
                      Send
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!rows.length && !loading && (
              <tr><td colSpan={7} className="empty">No results yet. Try a search.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="footNote">
        For legal use only. Indexes are provided by your configured Prowlarr/Jackett instance.
      </p>
    </div>
  );
}

function formatSize(bytes) {
  if (!bytes || bytes <= 0) return "-";
  const u = ["B","KB","MB","GB","TB"];
  let i = 0, v = bytes;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(2)} ${u[i]}`;
}
