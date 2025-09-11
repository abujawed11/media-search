function formatSize(bytes) {
  if (!bytes || bytes <= 0) return "-";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0, v = bytes;
  while (v >= 1024 && i < u.length - 1) { 
    v /= 1024; 
    i++; 
  }
  return `${v.toFixed(2)} ${u[i]}`;
}

export default function ResultsTable({ 
  rows, 
  loading, 
  copiedMagnet, 
  onCopyMagnet, 
  onResolveMagnet,
  onSendToQB 
}) {
  const handleTorrentFileClick = async (e, torrentUrl) => {
    e.preventDefault();
    
    try {
      console.log('[FRONTEND] Requesting magnet extraction from .torrent file...');
      
      // Send the torrent URL to our backend to extract magnet
      const response = await fetch('/api/extract-magnet', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ torrentUrl }),
      });
      
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      const data = await response.json();
      
      if (data.magnet) {
        console.log('[FRONTEND] Extracted magnet:', data.magnet.substring(0, 100) + '...');
        // Copy the magnet link
        onCopyMagnet(data.magnet);
        alert('✅ Magnet link extracted and copied to clipboard!');
      } else {
        throw new Error(data.error || 'Could not extract magnet link');
      }
    } catch (error) {
      console.error('[FRONTEND] Error extracting magnet:', error);
      // Fallback: try to copy the original link and let user know
      navigator.clipboard.writeText(torrentUrl).then(() => {
        alert('⚠️ Could not extract magnet. Torrent URL copied to clipboard instead.');
      }).catch(() => {
        alert('❌ Could not extract magnet link. Please try downloading the .torrent file directly.');
      });
    }
  };
  return (
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
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            // Debug: Log problematic objects
            if (typeof r.title === 'object') console.error('Title is object:', r.title);
            if (typeof r.tracker === 'object') console.error('Tracker is object:', r.tracker);
            if (typeof r.published === 'object') console.error('Published is object:', r.published);
            
            return (
              <tr key={i}>
                <td>{typeof r.title === 'object' ? JSON.stringify(r.title) : r.title}</td>
                <td className="center">{r.seeders ?? "-"}</td>
                <td className="center">{r.leechers ?? "-"}</td>
                <td>{formatSize(r.size)}</td>
                <td>{typeof r.tracker === 'object' ? JSON.stringify(r.tracker) : (r.tracker || "-")}</td>
                <td>{typeof r.published === 'object' ? JSON.stringify(r.published) : (r.published ? new Date(r.published).toLocaleString() : "-")}</td>
                <td className="actions">
                  {r.magnet ? (
                    // Already have magnet link
                    <>
                      <button 
                        onClick={() => onCopyMagnet(r.magnet)}
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
                      <button onClick={() => onSendToQB(r.magnet)} className="btnGhost">
                        Send
                      </button>
                    </>
                  ) : r.link ? (
                    // Need to resolve magnet or extract from torrent
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      {r.link.includes('jackett_apikey') || r.link.includes('download?') ? (
                        // This looks like a download URL that might resolve to magnet
                        <button 
                          onClick={() => onResolveMagnet(r.link)}
                          className="link"
                          title="Resolve magnet link on-demand"
                          style={{ 
                            background: 'none', 
                            border: 'none', 
                            color: '#3b82f6',
                            cursor: 'pointer',
                            padding: 0,
                            textDecoration: 'underline'
                          }}
                        >
                          {copiedMagnet === "resolving..." ? '⏳ Resolving...' : '🧲 Get Magnet'}
                        </button>
                      ) : (
                        // This looks like a direct .torrent file
                        <button 
                          onClick={(e) => handleTorrentFileClick(e, r.link)}
                          className="link"
                          title="Extract magnet from .torrent file"
                          style={{ 
                            background: 'none', 
                            border: 'none', 
                            color: '#3b82f6',
                            cursor: 'pointer',
                            padding: 0,
                            textDecoration: 'underline'
                          }}
                        >
                          🧲 Extract
                        </button>
                      )}
                      <a 
                        href={r.link} 
                        className="link" 
                        title="Download .torrent file directly"
                        style={{ fontSize: '0.8rem' }}
                      >
                        📄 Direct
                      </a>
                    </div>
                  ) : (
                    <span style={{ color: '#999' }}>No link</span>
                  )}
                </td>
              </tr>
            )
          })}
          {!rows.length && !loading && (
            <tr><td colSpan={7} className="empty">No results yet. Try a search.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}