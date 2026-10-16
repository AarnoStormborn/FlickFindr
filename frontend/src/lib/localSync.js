/** Local storage keys shared by the guest stores and account sync. */
export const LOCAL_SYNC_EVENT = 'flickfindr:local-sync-change';
export const GUEST_CACHE_KEY = 'flickfindr-guest-cache';
export const HISTORY_KEY = 'flickfindr-search-history';
export const LISTS_KEY = 'flickfindr-lists';
export const TRANSCRIPT_KEY = 'flickfindr-concierge-transcript';

export function notifyLocalSyncChange(source = 'local') {
    if (typeof window === 'undefined') return;
    // Stores call this from inside a React state updater (the persistence operation
    // is part of the updater). Dispatch after that updater returns so listeners do
    // not synchronously schedule a second setState while React is processing it.
    queueMicrotask(() => {
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent(LOCAL_SYNC_EVENT, { detail: { source } }));
        }
    });
}

const emptyData = () => ({
    lists: { v: 1, lists: [{ id: 'watch-later', name: 'Watch later', createdAt: 0, movies: [] }] },
    searchHistory: [],
    transcript: [],
});

/** Read the v1 localStorage stores into one sync envelope, tolerating bad storage. */
export function readLocalSyncData() {
    const empty = emptyData();
    try {
        const lists = JSON.parse(localStorage.getItem(LISTS_KEY) || 'null');
        if (lists?.v === 1 && Array.isArray(lists.lists)) empty.lists = lists;
    } catch { /* fall back to empty guest store */ }
    try {
        const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || 'null');
        if (Array.isArray(history)) empty.searchHistory = history;
    } catch { /* fall back to empty history */ }
    try {
        const transcript = JSON.parse(localStorage.getItem(TRANSCRIPT_KEY) || 'null');
        if (Array.isArray(transcript)) empty.transcript = transcript;
    } catch { /* fall back to empty transcript */ }
    return empty;
}

/**
 * Replace the local cache after an account restore/merge. `cloud` events update the
 * React stores in this tab but are ignored by CloudSyncProvider, avoiding a push loop.
 */
export function writeLocalSyncData(data) {
    try {
        localStorage.setItem(LISTS_KEY, JSON.stringify(data.lists));
        localStorage.setItem(HISTORY_KEY, JSON.stringify(data.searchHistory));
        localStorage.setItem(TRANSCRIPT_KEY, JSON.stringify(data.transcript));
    } catch {
        // If storage is unavailable the cloud copy is still authoritative.
    }
    notifyLocalSyncChange('cloud');
}
