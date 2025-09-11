export default function FilterSidebar({ 
  provider, 
  onProviderChange, 
  filters, 
  onFiltersChange, 
  availableTrackers 
}) {
  const updateFilter = (key, value) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  const clearFilters = () => {
    onFiltersChange({
      category: "",
      minSize: "",
      maxSize: "",
      minSeeders: "",
      maxSeeders: "",
      selectedTrackers: [],
      sortBy: "seeders",
      sortOrder: "desc"
    });
  };

  return (
    <div className="sidebar">
      {/* Provider Switch */}
      <div className="provider-switch">
        <h3>📡 Search Provider</h3>
        <div className="toggle-switch-container">
          <div className="toggle-switch">
            <input
              type="checkbox"
              id="provider-toggle"
              className="toggle-input"
              checked={provider === "jackett"}
              onChange={(e) => onProviderChange(e.target.checked ? "jackett" : "prowlarr")}
            />
            <label htmlFor="provider-toggle" className="toggle-label">
              <span className="toggle-slider">
                <span className="toggle-button"></span>
              </span>
              <span className="toggle-text">
                <span className="toggle-option left">🔍 Prowlarr</span>
                <span className="toggle-option right">🎯 Jackett</span>
              </span>
            </label>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="filters-section">
        <h3>🔧 Filters</h3>
        
        {/* Category Filter */}
        <div className="filter-group">
          <label>Category</label>
          <select 
            className="select"
            value={filters.category}
            onChange={(e) => updateFilter('category', e.target.value)}
          >
            <option value="">All Categories</option>
            <option value="movie">Movies</option>
            <option value="tv">TV Shows</option>
            <option value="software">Software</option>
            <option value="game">Games</option>
            <option value="music">Music</option>
            <option value="book">Books</option>
          </select>
        </div>

        {/* Size Filter */}
        <div className="filter-group">
          <label>Size (GB)</label>
          <div className="range-inputs">
            <input
              type="number"
              placeholder="Min"
              className="range-input"
              value={filters.minSize}
              onChange={(e) => updateFilter('minSize', e.target.value)}
            />
            <span className="range-separator">—</span>
            <input
              type="number"
              placeholder="Max"
              className="range-input"
              value={filters.maxSize}
              onChange={(e) => updateFilter('maxSize', e.target.value)}
            />
          </div>
        </div>

        {/* Seeders Filter */}
        <div className="filter-group">
          <label>Seeders</label>
          <div className="range-inputs">
            <input
              type="number"
              placeholder="Min"
              className="range-input"
              value={filters.minSeeders}
              onChange={(e) => updateFilter('minSeeders', e.target.value)}
            />
            <span className="range-separator">—</span>
            <input
              type="number"
              placeholder="Max"
              className="range-input"
              value={filters.maxSeeders}
              onChange={(e) => updateFilter('maxSeeders', e.target.value)}
            />
          </div>
        </div>

        {/* Tracker Filter */}
        {availableTrackers.length > 0 && (
          <div className="filter-group">
            <label>
              Trackers ({availableTrackers.length} available)
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => updateFilter('selectedTrackers', availableTrackers)}
                  style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                >
                  Select All
                </button>
                <button
                  type="button" 
                  className="btn-ghost"
                  onClick={() => updateFilter('selectedTrackers', [])}
                  style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                >
                  Clear All
                </button>
              </div>
            </label>
            <select 
              className="select"
              multiple
              value={filters.selectedTrackers}
              onChange={(e) => {
                const values = Array.from(e.target.selectedOptions, option => option.value);
                updateFilter('selectedTrackers', values);
              }}
              style={{ height: 'auto', minHeight: '100px' }}
            >
              {availableTrackers.map(tracker => (
                <option key={tracker} value={tracker}>{tracker}</option>
              ))}
            </select>
            <small style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.5rem', display: 'block' }}>
              Hold Ctrl/Cmd to select multiple or use buttons above
            </small>
          </div>
        )}

        {/* Sort Options */}
        <div className="filter-group">
          <label>Sort by</label>
          <select 
            className="select"
            value={filters.sortBy}
            onChange={(e) => updateFilter('sortBy', e.target.value)}
          >
            <option value="seeders">Seeders</option>
            <option value="size">Size</option>
            <option value="title">Title</option>
            <option value="date">Date</option>
          </select>
          <div style={{ marginTop: '0.5rem' }}>
            <label style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input
                type="radio"
                name="sortOrder"
                value="desc"
                checked={filters.sortOrder === "desc"}
                onChange={(e) => updateFilter('sortOrder', e.target.value)}
              />
              Descending
            </label>
            <label style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input
                type="radio"
                name="sortOrder" 
                value="asc"
                checked={filters.sortOrder === "asc"}
                onChange={(e) => updateFilter('sortOrder', e.target.value)}
              />
              Ascending
            </label>
          </div>
        </div>

        {/* Clear Filters */}
        <button 
          className="btn btn-secondary"
          onClick={clearFilters}
          style={{ width: '100%', marginTop: '1rem' }}
        >
          Clear Filters
        </button>
      </div>
    </div>
  );
}