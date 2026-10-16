import { useCallback, useEffect, useMemo, useState } from 'react';
import { AuthContext } from './authContext';
import { supabase, supabaseConfigured } from '../lib/supabase';

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
                setError(authError.message);
                return { ok: false, error: authError.message };
            }
            return { ok: true };
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Could not send the sign-in link.';
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
        signOut,
    }), [session, loading, error, sendMagicLink, signOut]);

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

