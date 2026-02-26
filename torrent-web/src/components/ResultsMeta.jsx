export default function ResultsMeta({
  rows,
  allResults,
  totalSeeders,
  provider,
  sendState
}) {
  if (rows.length === 0) return null;

  const prefetching = allResults.filter(r => !r.magnet && r.link).length;

  return (
    <div className="meta">
      <span>
        📊 {rows.length} results • {totalSeeders.toLocaleString()} total seeders • using {provider}
        {allResults.length !== rows.length && (
          <span style={{ color: 'var(--warning)' }}> (filtered from {allResults.length})</span>
        )}
      </span>
      {prefetching > 0 && (
        <span style={{ color: '#f59e0b', fontSize: '0.82rem', marginLeft: '0.75rem' }}>
          ⏳ Pre-fetching magnets for {prefetching} result{prefetching > 1 ? 's' : ''} in background…
        </span>
      )}
      {sendState && <span className="status">{sendState}</span>}
    </div>
  );
}