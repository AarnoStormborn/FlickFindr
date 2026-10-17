import { useState } from 'react';
import { useAuth } from '../context/authContext';
import { useCloudSync } from '../context/cloudSyncContext';
import './AccountPage.css';

export default function AccountPage() {
    const { configured, user, loading, error: authError, sendMagicLink, signInWithGoogle, signOut } = useAuth();
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

    const googleSignIn = async () => {
        setBusy(true);
        setLocalError('');
        const result = await signInWithGoogle();
        if (!result.ok) setLocalError(result.error ?? 'Could not start Google sign-in.');
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
                            Sign in to sync your lists, search history, and concierge conversation across devices.
                            Your existing local data will merge into your account; browsing stays available as a guest.
                        </p>
                        <button className="account-google" type="button" onClick={googleSignIn} disabled={busy}>
                            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 48 48">
                                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z" />
                                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.27 5.48-4.78 7.18l7.72 5.99c4.51-4.17 7.1-10.31 7.1-17.64Z" />
                                <path fill="#FBBC05" d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.75-4.59l-7.98-6.19A23.9 23.9 0 0 0 0 24c0 3.87.93 7.52 2.56 10.78l7.97-6.19Z" />
                                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.81l-7.72-5.99c-2.14 1.44-4.88 2.3-8.18 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z" />
                            </svg>
                            Continue with Google
                        </button>
                        <div className="account-divider"><span>or use email</span></div>
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
                        <p className="account-footnote">Supabase&apos;s built-in email sender is limited to 2 links per hour per project (plus a 60-second resend cooldown). Google sign-in avoids the email limit; custom SMTP can raise it.</p>
                    </>
                )}
            </section>
        </main>
    );
}
