import './ViewToggle.css';

export default function ViewToggle({ view, onChange }) {
    return (
        <div className="view-toggle" role="group" aria-label="View mode">
            <button
                className={`view-toggle-btn ${view === 'grid' ? 'active' : ''}`}
                onClick={() => onChange('grid')}
                title="Grid view"
                aria-label="Grid view"
            >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="7" height="7" rx="1.5" />
                    <rect x="14" y="3" width="7" height="7" rx="1.5" />
                    <rect x="3" y="14" width="7" height="7" rx="1.5" />
                    <rect x="14" y="14" width="7" height="7" rx="1.5" />
                </svg>
            </button>
            <button
                className={`view-toggle-btn ${view === 'list' ? 'active' : ''}`}
                onClick={() => onChange('list')}
                title="List view"
                aria-label="List view"
            >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="3" y1="6" x2="21" y2="6" />
                    <line x1="3" y1="12" x2="21" y2="12" />
                    <line x1="3" y1="18" x2="21" y2="18" />
                    <line x1="8" y1="4" x2="8" y2="8" />
                    <line x1="8" y1="10" x2="8" y2="14" />
                    <line x1="8" y1="16" x2="8" y2="20" />
                </svg>
            </button>
        </div>
    );
}