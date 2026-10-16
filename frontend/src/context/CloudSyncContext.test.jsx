import { render, screen, waitFor, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from './authContext';
import { CloudSyncProvider } from './CloudSyncProvider';
import { useCloudSync } from './cloudSyncContext';
import { HISTORY_KEY, LISTS_KEY, TRANSCRIPT_KEY, notifyLocalSyncChange } from '../lib/localSync';

const USER = { id: 'user-1', email: 'viewer@example.com' };
const SESSION = { access_token: 'test-token', user: USER };
const EMPTY = {
    lists: { v: 1, lists: [{ id: 'watch-later', name: 'Watch later', createdAt: 0, movies: [] }] },
    searchHistory: [],
    transcript: [],
};

function Status() {
    const sync = useCloudSync();
    return <div data-testid="sync-status">{sync.status}</div>;
}

function AuthHarness({ value }) {
    return (
        <AuthContext.Provider value={value}>
            <CloudSyncProvider><Status /></CloudSyncProvider>
        </AuthContext.Provider>
    );
}

const authValue = (user = USER) => ({
    session: user ? { access_token: `token-${user.id}`, user } : null,
    user,
    loading: false,
    configured: true,
    error: null,
});

function response(data = EMPTY, revision = 1) {
    return { ok: true, status: 200, json: async () => ({ data, revision, updatedAt: '2026-10-01T00:00:00.000Z' }) };
}

describe('CloudSyncProvider', () => {
    beforeEach(() => {
        localStorage.clear();
        globalThis.fetch = vi.fn(async () => response());
    });

    it('merges the guest snapshot on first sign-in and uses the bearer token', async () => {
        const guestLists = { v: 1, lists: [{ id: 'watch-later', name: 'Watch later', createdAt: 1, movies: [{ id: 5, title: 'Arrival', addedAt: 2 }] }] };
        localStorage.setItem(LISTS_KEY, JSON.stringify(guestLists));
        localStorage.setItem(HISTORY_KEY, JSON.stringify([{ label: 'Arrival', mode: 'semantic', params: 'q=arrival', ts: 5 }]));
        localStorage.setItem(TRANSCRIPT_KEY, JSON.stringify([{ role: 'user', content: 'A film about first contact' }]));
        globalThis.fetch = vi.fn(async () => response({ lists: guestLists, searchHistory: [{ label: 'Arrival', mode: 'semantic', params: 'q=arrival', ts: 5 }], transcript: [{ role: 'user', content: 'A film about first contact' }] }));

        render(<AuthHarness value={authValue()} />);
        await waitFor(() => expect(screen.getByTestId('sync-status')).toHaveTextContent('synced'));
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        const [url, init] = globalThis.fetch.mock.calls[0];
        expect(String(url)).toContain('/account/sync/merge');
        expect(init.headers.Authorization).toBe('Bearer token-user-1');
        expect(JSON.parse(localStorage.getItem(LISTS_KEY)).lists[0].movies[0].title).toBe('Arrival');
        expect(localStorage.getItem(TRANSCRIPT_KEY)).toContain('first contact');
    });

    it('pushes local changes to the cloud after a short debounce', async () => {
        render(<AuthHarness value={authValue()} />);
        await waitFor(() => expect(screen.getByTestId('sync-status')).toHaveTextContent('synced'));
        globalThis.fetch.mockClear();

        const changed = { v: 1, lists: [{ id: 'watch-later', name: 'Watch later', createdAt: 0, movies: [{ id: 8, title: 'The Matrix' }] }] };
        localStorage.setItem(LISTS_KEY, JSON.stringify(changed));
        act(() => notifyLocalSyncChange('local'));

        await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1), { timeout: 2_000 });
        const [url, init] = globalThis.fetch.mock.calls[0];
        expect(String(url)).toContain('/account/sync');
        expect(init.method).toBe('PUT');
        expect(JSON.parse(init.body).lists.lists[0].movies[0].title).toBe('The Matrix');
    });

    it('keeps guest mode local and does not call the account API', async () => {
        render(<AuthHarness value={authValue(null)} />);
        await waitFor(() => expect(screen.getByTestId('sync-status')).toHaveTextContent('guest'));
        expect(globalThis.fetch).not.toHaveBeenCalled();
        expect(localStorage.getItem(LISTS_KEY)).toBeNull();
    });

    it('does not carry one signed-in user’s local cache into a different account', async () => {
        const calls = [];
        globalThis.fetch = vi.fn(async (url, init) => {
            const body = init?.body ? JSON.parse(init.body) : null;
            calls.push({ url: String(url), body });
            const data = body?.lists?.lists?.some((l) => l.movies?.some((m) => m.title === 'User A private film'))
                ? { ...EMPTY, lists: { v: 1, lists: [{ id: 'watch-later', name: 'Watch later', createdAt: 0, movies: [{ id: 1, title: 'User A private film' }] }] } }
                : EMPTY;
            return response(data, calls.length);
        });
        const { rerender } = render(<AuthHarness value={authValue({ id: 'user-a', email: 'a@example.com' })} />);
        await waitFor(() => expect(screen.getByTestId('sync-status')).toHaveTextContent('synced'));
        // Simulate User A's local list having synced into the current device.
        localStorage.setItem(LISTS_KEY, JSON.stringify({ v: 1, lists: [{ id: 'watch-later', name: 'Watch later', createdAt: 0, movies: [{ id: 1, title: 'User A private film' }] }] }));
        rerender(<AuthHarness value={authValue({ id: 'user-b', email: 'b@example.com' })} />);
        await waitFor(() => expect(screen.getByTestId('sync-status')).toHaveTextContent('synced'));
        const lastMerge = calls.filter((c) => c.url.includes('/merge')).at(-1);
        expect(JSON.stringify(lastMerge?.body)).not.toContain('User A private film');
    });
});
