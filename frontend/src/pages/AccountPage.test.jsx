import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import AccountPage from './AccountPage';
import { AuthContext } from '../context/authContext';
import { CloudSyncContext } from '../context/cloudSyncContext';

function renderAccount({ auth = {}, sync = {} } = {}) {
    const authValue = {
        configured: true,
        user: null,
        loading: false,
        error: null,
        sendMagicLink: vi.fn(async () => ({ ok: true })),
        signOut: vi.fn(async () => ({ ok: true })),
        ...auth,
    };
    const syncValue = { status: 'guest', error: null, lastSyncedAt: null, retry: vi.fn(), ...sync };
    return {
        authValue,
        syncValue,
        ...render(
            <MemoryRouter>
                <AuthContext.Provider value={authValue}>
                    <CloudSyncContext.Provider value={syncValue}>
                        <AccountPage />
                    </CloudSyncContext.Provider>
                </AuthContext.Provider>
            </MemoryRouter>,
        ),
    };
}

describe('AccountPage', () => {
    it('offers email magic-link sign-in and explains local guest mode', () => {
        renderAccount();
        expect(screen.getByRole('heading', { name: /sync across devices/i })).toBeInTheDocument();
        expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /email me a sign-in link/i })).toBeInTheDocument();
        expect(screen.getByText(/keep browsing as a guest/i)).toBeInTheDocument();
    });

    it('sends the link and confirms which email to check', async () => {
        const user = userEvent.setup();
        const { authValue } = renderAccount();
        await user.type(screen.getByLabelText(/email address/i), 'viewer@example.com');
        await user.click(screen.getByRole('button', { name: /email me a sign-in link/i }));
        expect(authValue.sendMagicLink).toHaveBeenCalledWith('viewer@example.com');
        expect(await screen.findByRole('status')).toHaveTextContent('Check viewer@example.com for your sign-in link.');
    });

    it('shows account and sync state when signed in', () => {
        renderAccount({
            auth: { user: { email: 'viewer@example.com' } },
            sync: { status: 'synced', lastSyncedAt: '2026-10-01T12:00:00.000Z' },
        });
        expect(screen.getByRole('heading', { name: 'Your account' })).toBeInTheDocument();
        expect(screen.getByText('viewer@example.com')).toBeInTheDocument();
        expect(screen.getByText('Synced')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    });

    it('keeps the page usable and local-first if auth is not configured', () => {
        renderAccount({ auth: { configured: false } });
        expect(screen.getByText(/not configured on this deployment/i)).toBeInTheDocument();
        expect(screen.queryByLabelText(/email address/i)).toBeNull();
    });

    it('offers a sync retry when the device is offline', () => {
        const { syncValue } = renderAccount({
            auth: { user: { email: 'viewer@example.com' } },
            sync: { status: 'offline', error: 'offline' },
        });
        expect(screen.getByRole('status')).toHaveTextContent('Offline — changes are saved on this device');
        expect(screen.getByRole('button', { name: /retry sync/i })).toBeInTheDocument();
        expect(syncValue.retry).not.toHaveBeenCalled();
    });
});
