export default function ResultsMeta({ 
  rows, 
  allResults, 
  totalSeeders, 
  provider, 
  sendState 
}) {
  if (rows.length === 0) return null;

  return (
    <div className="meta">
      <span>
        📊 {rows.length} results • {totalSeeders.toLocaleString()} total seeders • using {provider}
        {allResults.length !== rows.length && (
          <span style={{ color: 'var(--warning)' }}> (filtered from {allResults.length})</span>
        )}
      </span>
      {sendState && <span className="status">{sendState}</span>}
    </div>
  );
}