import { useMemo, useState, useEffect, useRef } from "react";
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
    cat: params.get('cat') || '',
    indexer: params.get('indexer') || '',
  };
};

const updateUrl = (q, provider, cat, indexer) => {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (provider && provider !== 'prowlarr') params.set('provider', provider);
  if (cat) params.set('cat', cat);
  if (indexer) params.set('indexer', indexer);

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
  // Capture URL params once at mount — use a ref so re-renders don't lose them
  const initialParams = useRef(getUrlParams());
  const { q: initQ, provider: initProvider, cat: initCat, indexer: initIndexerFromUrl } = initialParams.current;

  // Restore indexer: URL param takes priority, then localStorage per provider
  const initIndexer = initIndexerFromUrl
    || localStorage.getItem(`torrent-indexer-${initProvider}`)
    || '';

  // Search state
  const [q, setQ] = useState(initQ);
  const [cat, setCat] = useState(initCat);
  const [rows, setRows] = useState([]);
  const [sendState, setSendState] = useState("");
  const [copiedMagnet, setCopiedMagnet] = useState("");
  const [provider, setProvider] = useState(initProvider);
  const [indexer, setIndexer] = useState(initIndexer);
  const [indexers, setIndexers] = useState([]);
  const isFirstProviderMount = useRef(true); // track initial mount vs real provider switch
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

  // WebTorrent settings
  const [webTorrentUrl, setWebTorrentUrl] = useState(
    localStorage.getItem('webtorrent-url') || ''
  );

  // Custom hooks
  const { loading, error, allResults, search, abortSearch, clearResults, fetchIndexers, sendToQB, copyMagnet, resolveMagnet, sendToWebTorrent } = useTorrentSearch();
  const { availableTrackers, filteredAndSortedRows } = useFiltering(allResults, filters);

  // Update rows when filtered results change
  useEffect(() => {
    setRows(filteredAndSortedRows);
  }, [filteredAndSortedRows]);

  // Save selected indexer to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem(`torrent-indexer-${provider}`, indexer);
  }, [indexer, provider]);

  // Fetch indexer list when provider changes
  useEffect(() => {
    if (isFirstProviderMount.current) {
      // On initial mount: don't reset indexer (it was restored from localStorage/URL)
      isFirstProviderMount.current = false;
    } else {
      // Real provider switch: reset indexer, restore from localStorage for new provider
      const saved = localStorage.getItem(`torrent-indexer-${provider}`) || '';
      setIndexer(saved);
    }
    setIndexers([]);
    fetchIndexers(provider)
      .then(setIndexers)
      .catch(() => setIndexers([]));
  }, [provider]);

  // Update URL when search params change
  useEffect(() => {
    updateUrl(q, provider, cat, indexer);
  }, [q, provider, cat, indexer]);

  // Auto-search on mount — wait for indexers to load if a specific indexer is needed
  useEffect(() => {
    if (!initQ) return;
    // If a specific indexer was selected, wait until the list has loaded
    // so we confirm the indexer is valid before searching
    if (initIndexer && indexers.length === 0) return;
    search(initQ, initProvider, initCat, initIndexer);
  }, [indexers]); // re-runs once when indexers finish loading

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
      setSearchHistory(getSearchHistory());
      search(q, provider, cat, indexer);
    }
  };

  const handleHistorySearch = (historyQuery) => {
    setQ(historyQuery);
    search(historyQuery, provider, cat, indexer);
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

  const handleSendToWebTorrent = (magnet) => {
    if (!webTorrentUrl.trim()) {
      alert('Please set your WebTorrent URL in the settings first.');
      return;
    }
    sendToWebTorrent(magnet, webTorrentUrl);
  };

  const saveWebTorrentUrl = (url) => {
    setWebTorrentUrl(url);
    localStorage.setItem('webtorrent-url', url);
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
            indexers={indexers}
            indexer={indexer}
            onIndexerChange={setIndexer}
            filters={filters}
            onFiltersChange={setFilters}
            availableTrackers={availableTrackers}
          />

          {/* Content Area */}
          <div className="content-area">
            {/* Search Controls */}
            <SearchControls
              onSearch={handleSearch}
              onStopSearch={abortSearch}
              loading={loading}
              query={q}
              onQueryChange={setQ}
              searchHistory={searchHistory}
              onHistorySearch={handleHistorySearch}
              onClearHistory={clearSearchHistory}
              onClearResults={allResults.length > 0 ? clearResults : null}
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
              onSendToWebTorrent={handleSendToWebTorrent}
              webTorrentUrl={webTorrentUrl}
              onWebTorrentUrlChange={saveWebTorrentUrl}
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
