import { useState, useRef, useEffect } from 'react';

export default function SearchControls({
  onSearch,
  loading,
  query,
  onQueryChange,
  searchHistory = [],
  onHistorySearch,
  onClearHistory,
  onClearResults
}) {
  const [showHistory, setShowHistory] = useState(false);
  const historyRef = useRef(null);

  // Close history dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (historyRef.current && !historyRef.current.contains(event.target)) {
        setShowHistory(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleInputFocus = () => {
    if (searchHistory.length > 0) {
      setShowHistory(true);
    }
  };

  const handleHistoryClick = (historyQuery) => {
    onHistorySearch(historyQuery);
    setShowHistory(false);
  };

  const formatTimeAgo = (timestamp) => {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  };
  return (
    <div className="controls" style={{ position: 'relative' }}>
      <div style={{ position: 'relative', display: 'flex', flex: 1 }}>
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSearch()}
          onFocus={handleInputFocus}
          placeholder="Search movies, TV, software, etc."
          className="input"
          style={{
            paddingRight: searchHistory.length > 0 ? '40px' : '12px',
            width: '100%',
            flex: '1'
          }}
        />
        {searchHistory.length > 0 && (
          <button
            type="button"
            onClick={() => setShowHistory(!showHistory)}
            style={{
              position: 'absolute',
              right: '12px',
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: '16px',
              color: '#666',
              padding: '4px',
              zIndex: 1
            }}
            title="Search History"
          >
            🕐
          </button>
        )}
      </div>

      <button
        onClick={onSearch}
        disabled={!query || loading}
        className="btn"
      >
        {loading ? "🔍 Searching…" : "🔍 Search"}
      </button>
      {onClearResults && (
        <button
          onClick={onClearResults}
          className="btn"
          style={{ background: '#6c757d' }}
          title="Clear search results"
        >
          ✕ Clear
        </button>
      )}

      {/* Search History Dropdown */}
      {showHistory && searchHistory.length > 0 && (
        <div
          ref={historyRef}
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            backgroundColor: 'white',
            border: '1px solid #ddd',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            zIndex: 1000,
            maxHeight: '300px',
            overflowY: 'auto',
            marginTop: '4px'
          }}
        >
          <div style={{
            padding: '8px 12px',
            borderBottom: '1px solid #eee',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '12px',
            fontWeight: 'bold',
            color: '#666'
          }}>
            <span>Recent Searches</span>
            <button
              onClick={() => {
                onClearHistory();
                setShowHistory(false);
              }}
              style={{
                background: 'none',
                border: 'none',
                color: '#999',
                cursor: 'pointer',
                fontSize: '11px',
                textDecoration: 'underline'
              }}
            >
              Clear
            </button>
          </div>

          {searchHistory.map((entry, index) => (
            <div
              key={`${entry.query}-${entry.timestamp}`}
              onClick={() => handleHistoryClick(entry.query)}
              style={{
                padding: '12px',
                cursor: 'pointer',
                borderBottom: index < searchHistory.length - 1 ? '1px solid #f0f0f0' : 'none',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                ':hover': {
                  backgroundColor: '#f5f5f5'
                }
              }}
              onMouseEnter={(e) => e.target.style.backgroundColor = '#f5f5f5'}
              onMouseLeave={(e) => e.target.style.backgroundColor = 'white'}
            >
              <div>
                <div style={{ fontSize: '14px', marginBottom: '2px' }}>
                  {entry.query}
                </div>
                <div style={{ fontSize: '11px', color: '#999' }}>
                  via {entry.provider} • {formatTimeAgo(entry.timestamp)}
                </div>
              </div>
              <div style={{ fontSize: '12px', color: '#ccc' }}>↩</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}