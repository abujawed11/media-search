import { useMemo, useState, useEffect } from "react";
import "./App.css";

// Components
import SearchControls from './components/SearchControls';
import FilterSidebar from './components/FilterSidebar';
import ResultsTable from './components/ResultsTable';
import ResultsMeta from './components/ResultsMeta';

// Custom hooks
import { useTorrentSearch } from './hooks/useTorrentSearch';
import { useFiltering } from './hooks/useFiltering';

// Helper functions for URL and localStorage management
const getUrlParams = () => {
  const params = new URLSearchParams(window.location.search);
  return {
    q: params.get('q') || '',
    provider: params.get('provider') || 'prowlarr',
    cat: params.get('cat') || ''
  };
};

const updateUrl = (q, provider, cat) => {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (provider && provider !== 'prowlarr') params.set('provider', provider);
  if (cat) params.set('cat', cat);

  const newUrl = params.toString() ? `${window.location.pathname}?${params}` : window.location.pathname;
  window.history.replaceState({}, '', newUrl);
};

const getSearchHistory = () => {
  try {
    return JSON.parse(localStorage.getItem('torrent-search-history') || '[]');
  } catch {
    return [];
  }
};

const saveToSearchHistory = (query, provider) => {
  if (!query.trim()) return;

  const history = getSearchHistory();
  const entry = {
    query: query.trim(),
    provider,
    timestamp: Date.now()
  };

  // Remove duplicate and add to front
  const filtered = history.filter(h => h.query !== entry.query || h.provider !== entry.provider);
  const newHistory = [entry, ...filtered].slice(0, 10); // Keep last 10 searches

  localStorage.setItem('torrent-search-history', JSON.stringify(newHistory));
};

export default function App() {
  // Initialize state from URL parameters
  const urlParams = getUrlParams();

  // Search state
  const [q, setQ] = useState(urlParams.q);
  const [cat, setCat] = useState(urlParams.cat); // Category parameter for backend
  const [rows, setRows] = useState([]);
  const [sendState, setSendState] = useState("");
  const [copiedMagnet, setCopiedMagnet] = useState("");
  const [provider, setProvider] = useState(urlParams.provider);
  const [searchHistory, setSearchHistory] = useState(getSearchHistory());
  
  // Filter state
  const [filters, setFilters] = useState({
    category: "",
    minSize: "",
    maxSize: "",
    minSeeders: "",
    maxSeeders: "",
    selectedTrackers: [],
    sortBy: "seeders", // seeders, size, date, title
    sortOrder: "desc" // asc, desc
  });

  // Custom hooks
  const { loading, error, allResults, search, sendToQB, copyMagnet, resolveMagnet } = useTorrentSearch();
  const { availableTrackers, filteredAndSortedRows } = useFiltering(allResults, filters);

  // Update rows when filtered results change
  useEffect(() => {
    setRows(filteredAndSortedRows);
  }, [filteredAndSortedRows]);

  // Update URL when search params change
  useEffect(() => {
    updateUrl(q, provider, cat);
  }, [q, provider, cat]);

  // Perform search on component mount if URL has search params
  useEffect(() => {
    if (urlParams.q) {
      search(urlParams.q, urlParams.provider, urlParams.cat);
    }
  }, []); // Only run once on mount

  // Update search history when it changes in localStorage
  useEffect(() => {
    const handleStorageChange = () => {
      setSearchHistory(getSearchHistory());
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const totalSeeders = useMemo(
    () => rows.reduce((a, r) => a + (r.seeders ?? 0), 0),
    [rows]
  );

  const handleSearch = () => {
    if (q.trim()) {
      saveToSearchHistory(q, provider);
      setSearchHistory(getSearchHistory()); // Update local state
      search(q, provider, cat);
    }
  };

  const handleHistorySearch = (historyQuery) => {
    setQ(historyQuery);
    search(historyQuery, provider, cat);
  };

  const clearSearchHistory = () => {
    localStorage.removeItem('torrent-search-history');
    setSearchHistory([]);
  };

  const handleSendToQB = (magnet) => {
    sendToQB(magnet, setSendState);
  };

  const handleCopyMagnet = (magnet) => {
    copyMagnet(magnet, setCopiedMagnet);
  };

  const handleResolveMagnet = (downloadUrl) => {
    resolveMagnet(downloadUrl, provider, setCopiedMagnet);
  };

  return (
    <div className="app-container">
      <div className="layout">
        {/* Header */}
        <div className="header">
          <h1 className="title">🔍 Torrent Meta-Search</h1>
          <p className="subtitle">Search across multiple torrent indexers with advanced filtering</p>
        </div>

        {/* Main Content */}
        <div className="main-content">
          {/* Sidebar with Filters */}
          <FilterSidebar
            provider={provider}
            onProviderChange={setProvider}
            filters={filters}
            onFiltersChange={setFilters}
            availableTrackers={availableTrackers}
          />

          {/* Content Area */}
          <div className="content-area">
            {/* Search Controls */}
            <SearchControls
              onSearch={handleSearch}
              loading={loading}
              query={q}
              onQueryChange={setQ}
              searchHistory={searchHistory}
              onHistorySearch={handleHistorySearch}
              onClearHistory={clearSearchHistory}
            />

            {error && <div className="error">❌ {error}</div>}

            {/* Results Meta */}
            <ResultsMeta
              rows={rows}
              allResults={allResults}
              totalSeeders={totalSeeders}
              provider={provider}
              sendState={sendState}
            />

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

            {/* Results Table */}
            <ResultsTable
              rows={rows}
              loading={loading}
              copiedMagnet={copiedMagnet}
              onCopyMagnet={handleCopyMagnet}
              onResolveMagnet={handleResolveMagnet}
              onSendToQB={handleSendToQB}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="footNote">
          For legal use only. Indexes are provided by your configured Prowlarr/Jackett instance.
        </div>
      </div>
    </div>
  );
}
