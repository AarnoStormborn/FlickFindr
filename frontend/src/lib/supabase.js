import { createClient } from '@supabase/supabase-js';

/**
 * Supabase Auth client. The URL and anon/publishable key are public application
 * config, never a service-role secret. Supports Vite envs (build-time) and an
 * optional runtime-injected config for static hosting.
 */
function runtimeValue(key) {
    try {
        return window.__FLICKFINDR_CONFIG__?.[key] ?? '';
    } catch {
        return '';
    }
}

export const SUPABASE_URL = import.meta.env?.VITE_SUPABASE_URL || runtimeValue('supabaseUrl');
export const SUPABASE_ANON_KEY = import.meta.env?.VITE_SUPABASE_ANON_KEY || runtimeValue('supabaseAnonKey');
export const SUPABASE_GOOGLE_ENABLED = import.meta.env?.VITE_SUPABASE_GOOGLE_ENABLED === 'true' || runtimeValue('supabaseGoogleEnabled') === true;
export const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export const supabase = supabaseConfigured
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          auth: {
              persistSession: true,
              autoRefreshToken: true,
              detectSessionInUrl: true,
              flowType: 'pkce',
          },
      })
    : null;
