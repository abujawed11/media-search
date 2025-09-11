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

export default function App() {
  // Search state
  const [q, setQ] = useState("");
  const [cat, setCat] = useState(""); // Category parameter for backend
  const [rows, setRows] = useState([]);
  const [sendState, setSendState] = useState("");
  const [copiedMagnet, setCopiedMagnet] = useState("");
  const [provider, setProvider] = useState("prowlarr");
  
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

  const totalSeeders = useMemo(
    () => rows.reduce((a, r) => a + (r.seeders ?? 0), 0),
    [rows]
  );

  const handleSearch = () => {
    search(q, provider, cat);
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
