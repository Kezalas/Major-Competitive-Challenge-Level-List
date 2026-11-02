/**
 * Supabase connection for the record submission system.
 *
 * Where to find these values:
 *   Supabase dashboard -> Project Settings -> API
 *     - "Project URL"            -> SUPABASE_URL
 *     - "anon" / "public" key    -> SUPABASE_ANON_KEY
 *
 * The anon key is MEANT to be public (it ships to every browser).
 * Security comes from the Row Level Security rules in supabase/schema.sql.
 * NEVER put the "service_role" key here.
 *
 * While both values are empty the site works exactly like before
 * (list + leaderboard from /data), and "Submit Record" links to the
 * old Google Form below.
 */
export const SUPABASE_URL = 'https://rwfnjizsukwlzapskaaq.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_tkipDFdeLtqI8UIjcCWXgw_m9iTnB7Z';

/** Fallback while Supabase is not configured. */
export const GOOGLE_FORM_URL = '#';
