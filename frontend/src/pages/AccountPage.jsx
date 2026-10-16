import { useState } from 'react';
import { useAuth } from '../context/authContext';
import { useCloudSync } from '../context/cloudSyncContext';
import './AccountPage.css';

export default function AccountPage() {
    const { configured, user, loading, error: authError, sendMagicLink, signOut } = useAuth();
    const sync = useCloudSync();
    const [email, setEmail] = useState('');
    const [sentTo, setSentTo] = useState('');
    const [busy, setBusy] = useState(false);
    const [localError, setLocalError] = useState('');

    const submit = async (event) => {
        event.preventDefault();
        setBusy(true);
        setLocalError('');
        setSentTo('');
        const result = await sendMagicLink(email);
        if (result.ok) setSentTo(email.trim());
        else setLocalError(result.error ?? 'Could not send the sign-in link.');
        setBusy(false);
    };

    const leave = async () => {
        setBusy(true);
        const result = await signOut();
        if (!result.ok) setLocalError(result.error ?? 'Could not sign out.');
        setBusy(false);
    };

    return (
        <main className="account-page">
            <section className="account-card" aria-labelledby="account-title">
                <p className="account-eyebrow">Your FlickFindr</p>
                <h1 id="account-title">{user ? 'Your account' : 'Sync across devices'}</h1>

                {!configured ? (
                    <div className="account-notice" role="status">
                        Accounts are not configured on this deployment yet. You can keep using FlickFindr as a guest.
                    </div>
                ) : loading ? (
                    <p className="account-muted" role="status">Checking your sign-in…</p>
                ) : user ? (
                    <>
                        <p className="account-email">{user.email}</p>
                        <p className="account-muted">
                            Your lists, search history, and concierge conversation sync to this account.
                        </p>
                        <div className={`account-sync-status is-${sync?.status ?? 'guest'}`} role="status">
                            {sync?.status === 'syncing' && 'Syncing…'}
                            {sync?.status === 'synced' && 'Synced'}
                            {sync?.status === 'offline' && 'Offline — changes are saved on this device'}
                            {sync?.status === 'disabled' && 'Cloud sync is not configured'}
                            {sync?.status === 'guest' && 'Local guest mode'}
                            {sync?.lastSyncedAt && sync.status === 'synced' && (
                                <span className="account-sync-time">
                                    Last synced {new Date(sync.lastSyncedAt).toLocaleTimeString()}
                                </span>
                            )}
                        </div>
                        {sync?.error && <p className="account-error" role="alert">{sync.error}</p>}
                        {sync?.status === 'offline' && (
                            <button className="account-secondary" onClick={sync.retry} disabled={busy}>
                                Retry sync
                            </button>
                        )}
                        <button className="account-secondary account-signout" onClick={leave} disabled={busy}>
                            {busy ? 'Signing out…' : 'Sign out'}
                        </button>
                    </>
                ) : (
                    <>
                        <p className="account-muted">
                            Get a sign-in link by email. Your local lists, search history, and concierge conversation
                            will merge into your account; you can keep browsing as a guest either way.
                        </p>
                        <form className="account-form" onSubmit={submit}>
                            <label htmlFor="account-email">Email address</label>
                            <input
                                id="account-email"
                                type="email"
                                autoComplete="email"
                                required
                                maxLength={320}
                                placeholder="you@example.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                            />
                            <button className="account-primary" type="submit" disabled={busy}>
                                {busy ? 'Sending…' : 'Email me a sign-in link'}
                            </button>
                        </form>
                        {sentTo && (
                            <p className="account-success" role="status">
                                Check <strong>{sentTo}</strong> for your sign-in link.
                            </p>
                        )}
                        {(localError || authError) && <p className="account-error" role="alert">{localError || authError}</p>}
                        <p className="account-footnote">No password to remember. The link expires after a short time.</p>
                    </>
                )}
            </section>
        </main>
    );
}
