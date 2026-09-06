import { useState, useCallback, useEffect } from 'react';

const HISTORY_KEY = 'flickfindr-search-history';
const MAX_ENTRIES = 25;

function loadHistory() {
    try {
        const raw = localStorage.getItem(HISTORY_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((e) => e && typeof e === 'object' && typeof e.label === 'string' && typeof e.params === 'string');
    } catch {
        return [];
    }
}

function saveHistory(items) {
    try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
    } catch {
        /* storage full / unavailable — ignore */
    }
}

/**
 * Local-first search history (no accounts). Each entry reproduces a search
 * via its URL params, so re-running is just a navigation:
 *   { label, mode, params: 'q=...&mode=...' , ts }
 */
export default function useSearchHistory() {
    const [history, setHistory] = useState(loadHistory);

    const recordSearch = useCallback((label, mode, searchParams) => {
        const params = searchParams.toString();
        if (!label || !params) return;
        setHistory((prev) => {
            const next = [{ label, mode, params, ts: Date.now() }, ...prev.filter((e) => e.params !== params)];
            const trimmed = next.slice(0, MAX_ENTRIES);
            saveHistory(trimmed);
            return trimmed;
        });
    }, []);

    const clearHistory = useCallback(() => {
        setHistory([]);
        saveHistory([]);
    }, []);

    // Keep state in sync if another tab writes history.
    useEffect(() => {
        const onStorage = (e) => {
            if (e.key === HISTORY_KEY) setHistory(loadHistory());
        };
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, []);

    return { history, recordSearch, clearHistory };
}
