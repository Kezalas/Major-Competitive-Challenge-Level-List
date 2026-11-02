import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const SUPABASE_JS =
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm';

export const isConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let clientPromise = null;

/**
 * Lazily loads supabase-js and returns a shared client,
 * or null if Supabase is not configured / could not be loaded.
 * The list keeps working from /data in that case.
 */
export function getSupabase() {
    if (!isConfigured) return Promise.resolve(null);
    clientPromise ??= import(SUPABASE_JS)
        .then(({ createClient }) =>
            createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
                auth: {
                    // PKCE puts ?code=... in the query string, which does not
                    // collide with the #/route hash used by the router.
                    flowType: 'pkce',
                    persistSession: true,
                    autoRefreshToken: true,
                    detectSessionInUrl: true,
                },
            }),
        )
        .catch((e) => {
            console.error('Failed to load Supabase.', e);
            return null;
        });
    return clientPromise;
}

/**
 * Fetches every row of a query, page by page
 * (Supabase returns at most 1000 rows per request).
 * @param {(from: number, to: number) => any} build returns a query with .range() applied
 */
export async function fetchAll(build, pageSize = 1000) {
    const rows = [];
    for (let from = 0; ; from += pageSize) {
        const { data, error } = await build(from, from + pageSize - 1);
        if (error) throw error;
        rows.push(...data);
        if (data.length < pageSize) return rows;
    }
}

/** Turns Supabase/Postgres errors into something a player understands. */
export function friendlyError(error) {
    if (!error) return '';
    const msg = error.message || String(error);
    if (error.code === '23505') {
        if (msg.includes('submissions_one_pending_per_level')) {
            return 'You already have a pending record for this level. Withdraw it first if you want to send a better one.';
        }
        if (msg.includes('gd_username')) {
            return 'This GD account is already confirmed for another player.';
        }
        if (msg.includes('username')) {
            return 'This username is already taken.';
        }
        return 'This entry already exists.';
    }
    if (error.code === '23514') {
        if (msg.includes('username')) {
            return 'Usernames need 3 - 24 characters: letters, numbers, _ . and -';
        }
        return 'Some fields are invalid. Please check links and numbers.';
    }
    if (msg.includes('Invalid login credentials')) {
        return 'Wrong email or password.';
    }
    if (msg.includes('Email not confirmed')) {
        return 'Please confirm your email first (check your inbox and spam folder).';
    }
    return msg;
}
