import { useMemo } from 'react';

export function useFiltering(allResults, filters) {
  // Get unique trackers from all results
  const availableTrackers = useMemo(() => {
    const trackers = [...new Set(allResults.map(r => r.tracker).filter(Boolean))];
    return trackers.sort();
  }, [allResults]);

  // Apply filters and sorting to results
  const filteredAndSortedRows = useMemo(() => {
    let filtered = [...allResults];

    // Apply filters
    if (filters.category) {
      // Basic category filtering - you can expand this based on your category system
      filtered = filtered.filter(r => 
        r.title?.toLowerCase().includes(filters.category.toLowerCase())
      );
    }

    if (filters.minSize) {
      const minBytes = parseFloat(filters.minSize) * 1024 * 1024 * 1024; // GB to bytes
      filtered = filtered.filter(r => r.size >= minBytes);
    }

    if (filters.maxSize) {
      const maxBytes = parseFloat(filters.maxSize) * 1024 * 1024 * 1024; // GB to bytes
      filtered = filtered.filter(r => r.size <= maxBytes);
    }

    if (filters.minSeeders) {
      filtered = filtered.filter(r => (r.seeders ?? 0) >= parseInt(filters.minSeeders));
    }

    if (filters.maxSeeders) {
      filtered = filtered.filter(r => (r.seeders ?? 0) <= parseInt(filters.maxSeeders));
    }

    if (filters.selectedTrackers.length > 0) {
      filtered = filtered.filter(r => filters.selectedTrackers.includes(r.tracker));
    }

    // Apply sorting
    filtered.sort((a, b) => {
      let valueA, valueB;
      
      switch (filters.sortBy) {
        case 'title':
          valueA = a.title?.toLowerCase() || '';
          valueB = b.title?.toLowerCase() || '';
          break;
        case 'size':
          valueA = a.size || 0;
          valueB = b.size || 0;
          break;
        case 'date':
          valueA = new Date(a.published || 0).getTime();
          valueB = new Date(b.published || 0).getTime();
          break;
        case 'seeders':
        default:
          valueA = a.seeders || 0;
          valueB = b.seeders || 0;
          break;
      }

      if (filters.sortOrder === 'asc') {
        return valueA < valueB ? -1 : valueA > valueB ? 1 : 0;
      } else {
        return valueA > valueB ? -1 : valueA < valueB ? 1 : 0;
      }
    });

    return filtered;
  }, [allResults, filters]);

  return {
    availableTrackers,
    filteredAndSortedRows
  };
}