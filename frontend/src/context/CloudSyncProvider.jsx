import { useCallback, useEffect, useRef, useState } from 'react';
import { CloudSyncContext } from './cloudSyncContext';
import { useAuth } from './authContext';
import { fetchAccountSync, mergeAccountSync, putAccountSync } from '../api/account';
import {
    GUEST_CACHE_KEY,
    LOCAL_SYNC_EVENT,
    readLocalSyncData,
    writeLocalSyncData,
} from '../lib/localSync';

const USER_CACHE_PREFIX = 'flickfindr-user-cache:';
const POLL_MS = 30_000;
const PUSH_DEBOUNCE_MS = 650;
const EMPTY = {
    lists: { v: 1, lists: [{ id: 'watch-later', name: 'Watch later', createdAt: 0, movies: [] }] },
    searchHistory: [],
    transcript: [],
};

function userCacheKey(id) {
    return `${USER_CACHE_PREFIX}${id}`;
}

function readCache(key) {
    try {
        const parsed = JSON.parse(localStorage.getItem(key) || 'null');
        return parsed && parsed.lists?.v === 1 ? parsed : null;
    } catch {
        return null;
    }
}

function writeCache(key, data) {
    try {
        localStorage.setItem(key, JSON.stringify(data));
    } catch {
        // The cloud copy still works even if localStorage is unavailable/full.
    }
}

/**
 * Local-first/cloud-sync bridge for the three existing guest stores.
 *
 * - Signed out: existing localStorage behaviour is unchanged, and guest changes
 *   are snapshotted so they can be merged on first sign-in.
 * - First sign-in: POST /merge unions lists/movies and history, and combines the
 *   transcript; localStorage is then the instant local cache.
 * - Signed in: local mutations debounce to one cloud PUT; a 30s poll pulls updates
 *   made on another device. The account's local cache is keyed by user id, and is
 *   never exposed to a different account when switching/signing out.
 *
 * Concurrent simultaneous edits are last-write-wins in v1. Normal sequential
 * multi-device use converges through polling; a future operation log/tombstone
 * model would be needed to merge simultaneous delete-vs-edit conflicts perfectly.
 */
export function CloudSyncProvider({ children }) {
    const { user, session, loading: authLoading, configured } = useAuth();
    const [status, setStatus] = useState('guest'); // guest | syncing | synced | offline | disabled
    const [error, setError] = useState(null);
    const [lastSyncedAt, setLastSyncedAt] = useState(null);
    const activeUser = useRef(null);
    const ready = useRef(false);
    const dirty = useRef(false);
    const revision = useRef(0);
    const pushTimer = useRef(null);
    const requestInFlight = useRef(false);
    const mergeRequired = useRef(false);
    const sessionRef = useRef(session);
    sessionRef.current = session;

    const saveUserCache = useCallback((id, data) => writeCache(userCacheKey(id), data), []);

    const replaceLocal = useCallback((data) => {
        writeLocalSyncData(data);
    }, []);

    const pushCurrent = useCallback(async () => {
        const currentSession = sessionRef.current;
        if (!currentSession?.access_token || requestInFlight.current || !ready.current) return;
        requestInFlight.current = true;
        setStatus('syncing');
        setError(null);
        const data = readLocalSyncData();
        try {
            const result = mergeRequired.current
                ? await mergeAccountSync(currentSession.access_token, data)
                : await putAccountSync(currentSession.access_token, data);
            mergeRequired.current = false;
            revision.current = result.revision;
            dirty.current = false;
            saveUserCache(currentSession.user.id, data);
            setLastSyncedAt(result.updatedAt ?? new Date().toISOString());
            setStatus('synced');
        } catch (err) {
            dirty.current = true;
            setError(err instanceof Error ? err.message : 'Sync failed');
            setStatus('offline');
        } finally {
            requestInFlight.current = false;
        }
    }, [saveUserCache]);

    const schedulePush = useCallback(() => {
        dirty.current = true;
        if (pushTimer.current) window.clearTimeout(pushTimer.current);
        pushTimer.current = window.setTimeout(() => { void pushCurrent(); }, PUSH_DEBOUNCE_MS);
    }, [pushCurrent]);

    // Keep user data isolated when auth state changes. Guest data is merged exactly
    // once into an account, then cleared from the guest bucket; sign-out restores a
    // fresh guest store instead of showing a previous account's lists on the device.
    useEffect(() => {
        if (authLoading) return undefined;
        let cancelled = false;
        const nextUserId = user?.id ?? null;
        const previousUserId = activeUser.current;

        const initialize = async () => {
            ready.current = false;
            if (!configured) {
                setStatus('disabled');
                return;
            }
            if (!nextUserId || !session?.access_token) {
                if (previousUserId) {
                    saveUserCache(previousUserId, readLocalSyncData());
                    activeUser.current = null;
                    revision.current = 0;
                    mergeRequired.current = false;
                    dirty.current = false;
                    const guest = readCache(GUEST_CACHE_KEY) ?? EMPTY;
                    replaceLocal(guest);
                } else {
                    // Anonymous browsing remains exactly local-first.
                    writeCache(GUEST_CACHE_KEY, readLocalSyncData());
                }
                setStatus('guest');
                setError(null);
                return;
            }

            if (previousUserId && previousUserId !== nextUserId) {
                saveUserCache(previousUserId, readLocalSyncData());
                // Never merge one user's cached data into another user's account.
                replaceLocal(readCache(userCacheKey(nextUserId)) ?? EMPTY);
            } else if (!previousUserId) {
                const existingAccountCache = readCache(userCacheKey(nextUserId));
                if (existingAccountCache) replaceLocal(existingAccountCache);
                else writeCache(GUEST_CACHE_KEY, readLocalSyncData());
            }

            setStatus('syncing');
            setError(null);
            mergeRequired.current = true;
            try {
                // Always merge on sign-in. The operation is idempotent, so this also
                // recovers safely if the browser closed before receiving the response.
                const local = readLocalSyncData();
                const result = await mergeAccountSync(session.access_token, local);
                if (cancelled) return;
                revision.current = result.revision;
                mergeRequired.current = false;
                replaceLocal(result.data);
                saveUserCache(nextUserId, result.data);
                // Guest items have now been imported; don't merge them into a different
                // account on a later sign-in.
                localStorage.removeItem(GUEST_CACHE_KEY);
                activeUser.current = nextUserId;
                ready.current = true;
                dirty.current = false;
                setLastSyncedAt(result.updatedAt ?? new Date().toISOString());
                setStatus('synced');
            } catch (err) {
                if (cancelled) return;
                activeUser.current = nextUserId;
                mergeRequired.current = true; // retry by merging, never overwrite remote guest data
                ready.current = true; // keep offline edits queued locally
                dirty.current = true;
                setError(err instanceof Error ? err.message : 'Could not sync your account');
                setStatus('offline');
            }
        };

        void initialize();
        return () => {
            cancelled = true;
            if (pushTimer.current) window.clearTimeout(pushTimer.current);
            ready.current = false;
        };
    }, [authLoading, user?.id, session?.access_token, configured, replaceLocal, saveUserCache]);

    // Local mutations sync after the local store has persisted them. Cross-tab
    // storage events use the same path. Cloud-originated replacements are ignored.
    useEffect(() => {
        const onLocalChange = (event) => {
            if (event.detail?.source === 'cloud') return;
            if (user?.id && ready.current) schedulePush();
            else if (!user?.id) writeCache(GUEST_CACHE_KEY, readLocalSyncData());
        };
        const onStorage = (event) => {
            if ([null, undefined, 'flickfindr-lists', 'flickfindr-search-history', 'flickfindr-concierge-transcript'].includes(event.key)) {
                onLocalChange({ detail: { source: 'local' } });
            }
        };
        window.addEventListener(LOCAL_SYNC_EVENT, onLocalChange);
        window.addEventListener('storage', onStorage);
        return () => {
            window.removeEventListener(LOCAL_SYNC_EVENT, onLocalChange);
            window.removeEventListener('storage', onStorage);
        };
    }, [schedulePush, user?.id]);

    // Pull writes made on another device. Don't stomp an unsent local edit; push it
    // first and the next poll will fetch the resulting canonical snapshot. When the
    // remote revision is newer, it is authoritative and replaces this cache — merging
    // an old local snapshot here would resurrect a list the user deleted elsewhere.
    useEffect(() => {
        if (!user?.id || !session?.access_token || status === 'disabled') return undefined;
        let cancelled = false;
        const poll = async () => {
            if (dirty.current || requestInFlight.current || !ready.current) return;
            try {
                const remote = await fetchAccountSync(session.access_token);
                if (cancelled || Number(remote.revision) <= revision.current) return;
                if (cancelled) return;
                revision.current = Number(remote.revision);
                replaceLocal(remote.data);
                saveUserCache(user.id, remote.data);
                setLastSyncedAt(remote.updatedAt ?? new Date().toISOString());
                setStatus('synced');
            } catch {
                if (!cancelled) setStatus('offline');
            }
        };
        const timer = window.setInterval(() => { void poll(); }, POLL_MS);
        const online = () => { if (dirty.current) void pushCurrent(); else void poll(); };
        window.addEventListener('online', online);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
            window.removeEventListener('online', online);
        };
    }, [user?.id, session?.access_token, status, pushCurrent, replaceLocal, saveUserCache]);

    const retry = useCallback(() => {
        if (sessionRef.current?.access_token) void pushCurrent();
    }, [pushCurrent]);

    return (
        <CloudSyncContext.Provider value={{ status, error, lastSyncedAt, retry }}>
            {children}
        </CloudSyncContext.Provider>
    );
}

