import { useCallback, useEffect, useMemo, useState } from 'react';
import { AuthContext } from './authContext';
import { supabase, supabaseConfigured } from '../lib/supabase';

function userFacingAuthError(error, fallback) {
    const raw = error?.message ?? fallback;
    if (/unsupported provider|provider is not enabled/i.test(raw)) {
        return 'Google sign-in is not enabled in Supabase yet. Use the email link for now.';
    }
    if (error?.status === 429 || /rate.?limit|too many requests|email rate/i.test(raw)) {
        return 'Email sign-in is being rate-limited. Try Google sign-in, wait before requesting another link, or configure custom SMTP.';
    }
    return raw;
}

export function AuthProvider({ children }) {
    const [session, setSession] = useState(null);
    const [loading, setLoading] = useState(supabaseConfigured);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!supabase) return undefined;
        let live = true;
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
            if (!live) return;
            setSession(next);
            setLoading(false);
            setError(null);
        });
        supabase.auth.getSession()
            .then(({ data, error: sessionError }) => {
                if (!live) return;
                setSession(data.session);
                setError(sessionError?.message ?? null);
                setLoading(false);
            })
            .catch((err) => {
                if (!live) return;
                setError(err instanceof Error ? err.message : 'Could not restore your session');
                setLoading(false);
            });
        return () => {
            live = false;
            subscription.unsubscribe();
        };
    }, []);

    const signInWithGoogle = useCallback(async () => {
        setError(null);
        if (!supabase) {
            const message = 'Accounts are not configured on this deployment yet.';
            setError(message);
            return { ok: false, error: message };
        }
        try {
            const { error: authError } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: { redirectTo: `${window.location.origin}/account` },
            });
            if (authError) {
                const message = userFacingAuthError(authError, 'Could not start Google sign-in.');
                setError(message);
                return { ok: false, error: message };
            }
            // Supabase redirects the browser to Google; a successful call normally
            // does not return to this page until OAuth completes.
            return { ok: true };
        } catch (err) {
            const message = userFacingAuthError(err, 'Could not start Google sign-in.');
            setError(message);
            return { ok: false, error: message };
        }
    }, []);

    const sendMagicLink = useCallback(async (email) => {
        setError(null);
        if (!supabase) {
            const message = 'Accounts are not configured on this deployment yet.';
            setError(message);
            return { ok: false, error: message };
        }
        try {
            const { error: authError } = await supabase.auth.signInWithOtp({
                email: email.trim(),
                options: { emailRedirectTo: `${window.location.origin}/account` },
            });
            if (authError) {
                const message = userFacingAuthError(authError, 'Could not send the sign-in link.');
                setError(message);
                return { ok: false, error: message };
            }
            return { ok: true };
        } catch (err) {
            const message = userFacingAuthError(err, 'Could not send the sign-in link.');
            setError(message);
            return { ok: false, error: message };
        }
    }, []);

    const signOut = useCallback(async () => {
        setError(null);
        if (!supabase) return { ok: false, error: 'Accounts are not configured.' };
        try {
            const { error: authError } = await supabase.auth.signOut();
            if (authError) {
                setError(authError.message);
                return { ok: false, error: authError.message };
            }
            return { ok: true };
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Could not sign out.';
            setError(message);
            return { ok: false, error: message };
        }
    }, []);

    const value = useMemo(() => ({
        configured: supabaseConfigured,
        session,
        user: session?.user ?? null,
        loading,
        error,
        sendMagicLink,
        signInWithGoogle,
        signOut,
    }), [session, loading, error, sendMagicLink, signInWithGoogle, signOut]);

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

