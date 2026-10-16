import { useState, useCallback, useEffect } from 'react';
import { HISTORY_KEY, LOCAL_SYNC_EVENT, notifyLocalSyncChange } from '../lib/localSync';

export { HISTORY_KEY };
const MAX_ENTRIES = 25;

export function loadHistory() {
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
        notifyLocalSyncChange();
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
        const reload = () => setHistory(loadHistory());
        const onStorage = (e) => {
            if (e.key === HISTORY_KEY) reload();
        };
        const onLocalSync = (e) => {
            if (e.detail?.source === 'cloud') reload();
        };
        window.addEventListener('storage', onStorage);
        window.addEventListener(LOCAL_SYNC_EVENT, onLocalSync);
        return () => {
            window.removeEventListener('storage', onStorage);
            window.removeEventListener(LOCAL_SYNC_EVENT, onLocalSync);
        };
    }, []);

    return { history, recordSearch, clearHistory };
}
