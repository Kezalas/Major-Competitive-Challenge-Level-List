import { getSupabase, isConfigured } from './supabase.js';

/**
 * Global login state, shared by the nav bar and all pages.
 */
export const auth = Vue.reactive({
    enabled: isConfigured,
    ready: false,
    session: null,
    profile: null,
    /** true after clicking the link in a "reset password" email */
    recovery: false,
    /** message to show once (e.g. error from an email link) */
    notice: '',
    get user() {
        return this.session?.user ?? null;
    },
    get isStaff() {
        return ['reviewer', 'admin'].includes(this.profile?.role);
    },
    get isAdmin() {
        return this.profile?.role === 'admin';
    },
});

let readyResolve;
const readyPromise = new Promise((r) => (readyResolve = r));

/** Resolves once the session was restored (or Supabase is unavailable). */
export function authReady() {
    return readyPromise;
}

export async function loadProfile() {
    const sb = await getSupabase();
    if (!sb || !auth.user) {
        auth.profile = null;
        return null;
    }
    const { data, error } = await sb
        .from('profiles')
        .select('*')
        .eq('id', auth.user.id)
        .maybeSingle();
    if (error) console.error('Failed to load profile.', error);
    auth.profile = data ?? null;
    return auth.profile;
}

export async function initAuth(router) {
    const sb = await getSupabase();
    if (!sb) {
        auth.ready = true;
        readyResolve();
        return;
    }

    // Errors from email links arrive as ?error_description=... (or in the hash)
    const params = new URLSearchParams(window.location.search);
    const linkError =
        params.get('error_description') ||
        new URLSearchParams(window.location.hash.split('?')[1] || '').get(
            'error_description',
        );

    // getSession() waits until supabase-js has processed ?code=... from the URL
    const { data } = await sb.auth.getSession();
    auth.session = data.session;
    if (auth.session) await loadProfile();

    if (linkError) {
        auth.notice = auth.session
            ? ''
            : `${linkError}. If you just confirmed your email, simply log in.`;
    }
    if (params.has('code') || params.has('error') || params.has('error_description')) {
        // remove ?code=... so a reload does not try to use it again
        window.history.replaceState(
            null,
            '',
            window.location.pathname + window.location.hash,
        );
    }

    sb.auth.onAuthStateChange((event, session) => {
        auth.session = session;
        // Calling Supabase inside this callback can dead-lock, so defer it.
        setTimeout(async () => {
            if (event === 'SIGNED_OUT') {
                auth.profile = null;
                auth.recovery = false;
                return;
            }
            if (
                event === 'SIGNED_IN' ||
                event === 'USER_UPDATED' ||
                event === 'PASSWORD_RECOVERY'
            ) {
                if (!auth.profile || auth.profile.id !== session?.user?.id) {
                    await loadProfile();
                }
            }
            if (event === 'PASSWORD_RECOVERY') {
                auth.recovery = true;
                router.push('/account');
            }
        }, 0);
    });

    auth.ready = true;
    readyResolve();
}

export async function signOut() {
    const sb = await getSupabase();
    await sb?.auth.signOut();
    auth.session = null;
    auth.profile = null;
}

/** Where Supabase should send people back to after clicking an email link. */
export function siteUrl() {
    return window.location.origin + '/';
}
