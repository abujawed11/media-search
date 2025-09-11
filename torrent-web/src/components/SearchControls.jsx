import { useState } from 'react';

export default function SearchControls({ onSearch, loading, query, onQueryChange }) {
  return (
    <div className="controls">
      <input
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onSearch()}
        placeholder="Search movies, TV, software, etc."
        className="input"
      />
      <button 
        onClick={onSearch} 
        disabled={!query || loading} 
        className="btn"
      >
        {loading ? "🔍 Searching…" : "🔍 Search"}
      </button>
    </div>
  );
}