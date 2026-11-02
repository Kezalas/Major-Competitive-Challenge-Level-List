import { round, score } from './score.js';
import { getSupabase, fetchAll } from './supabase.js';

/**
 * Path to directory containing `_list.json` and all levels
 */
const dir = '/data';

/**
 * Accepted records from the submission system (Supabase), grouped by level path.
 * Returns an empty object when Supabase is not configured or unreachable,
 * so the list still works with the static /data files alone.
 */
export async function fetchAcceptedRecords() {
    const sb = await getSupabase();
    if (!sb) return {};
    try {
        const rows = await fetchAll((from, to) =>
            sb.from('records').select('*').order('id').range(from, to),
        );
        const byLevel = {};
        for (const r of rows) {
            (byLevel[r.level_path] ??= []).push({
                user: r.user,
                link: r.link,
                percent: r.percent,
                hz: r.hz,
                mobile: r.mobile,
                cbf: r.cbf ?? false,
                nation: r.nation,
            });
        }
        return byLevel;
    } catch (e) {
        console.error('Failed to load accepted records.', e);
        return {};
    }
}

/**
 * Static records from the JSON file + accepted submissions.
 * One record per player: the one with the highest percentage.
 */
function mergeRecords(staticRecords = [], accepted = []) {
    const best = new Map();
    for (const r of [...staticRecords, ...accepted]) {
        const key = r.user.toLowerCase();
        const prev = best.get(key);
        if (!prev || Number(r.percent) > Number(prev.percent)) best.set(key, r);
    }
    return [...best.values()];
}

function byPercent(a, b) {
    return Number(b.percent) - Number(a.percent);
}

/** Levels admins added on the website (Supabase table `levels`). */
export async function fetchDbLevels() {
    const sb = await getSupabase();
    if (!sb) return [];
    try {
        return await fetchAll((from, to) =>
            sb.from('levels').select('*').order('placement').order('created_at').range(from, to),
        );
    } catch (e) {
        console.error('Failed to load levels from the database.', e);
        return [];
    }
}

/** DB row -> same shape as a level JSON file */
export function dbLevelToLevel(row) {
    return {
        id: row.level_id,
        name: row.name,
        author: row.author,
        creators: row.creators ?? [],
        verifier: row.verifier,
        verification: row.verification,
        ...(row.showcase ? { showcase: row.showcase } : {}),
        password: row.password ?? '',
        percentToQualify: row.percent_to_qualify ?? 100,
        ...(row.rating ? { rating: row.rating } : {}),
        ...(row.difficulty ? { difficulty: row.difficulty } : {}),
        records: [],
        fromDatabase: true,
    };
}

/**
 * The list as [[level, error], ...] in rank order.
 *
 * - Database mode (after supabase/import_json_levels.sql was run): all levels
 *   and records come from Supabase, data/*.json is not used.
 * - Otherwise (Supabase not set up or not imported yet): levels and records
 *   from data/*.json, plus website levels / accepted records merged in.
 */
export async function fetchList({ includeAccepted = true } = {}) {
    const [accepted, profiles, dbLevels] = await Promise.all([
        includeAccepted ? fetchAcceptedRecords() : {},
        includeAccepted ? fetchProfiles() : {},
        fetchDbLevels(),
    ]);

    const canonical = makeCanonical(profiles);
    const withRecords = (level) => {
        const records = mergeRecords(
            (level.records ?? []).map((r) => ({ ...r, user: canonical(r.user) })),
            (accepted[level.path] ?? []).map((r) => ({ ...r, user: canonical(r.user) })),
        )
            .map((r) => ({
                ...r,
                nation: r.nation ?? profiles[r.user.toLowerCase()]?.nation ?? null,
            }))
            .sort(byPercent);
        return [{ ...level, records }, null];
    };

    if (isDatabaseMode(dbLevels)) {
        return dbLevels.map((row) => withRecords({ ...dbLevelToLevel(row), path: row.path }));
    }

    let entries;
    try {
        const listResult = await fetch(`${dir}/_list.json`);
        const list = await listResult.json();
        entries = await Promise.all(
            list.map(async (path, rank) => {
                const levelResult = await fetch(`${dir}/${path}.json`);
                try {
                    return [{ ...(await levelResult.json()), path }, null];
                } catch {
                    console.error(`Failed to load level #${rank + 1} ${path}.`);
                    return [null, path];
                }
            }),
        );
    } catch {
        console.error(`Failed to load list.`);
        return null;
    }

    // insert website-added levels at their placement (sorted, so each lands exactly there)
    for (const row of dbLevels) {
        const at = Math.min(Math.max(row.placement - 1, 0), entries.length);
        entries.splice(at, 0, [{ ...dbLevelToLevel(row), path: row.path }, null]);
    }

    return entries.map(([level, err]) => (level ? withRecords(level) : [null, err]));
}

/** true once the JSON levels were imported (their paths are not "gd-…"/"lvl-…") */
export function isDatabaseMode(dbLevels) {
    return dbLevels.some((l) => !/^(gd|lvl)-/.test(l.path));
}

/** Packs (Supabase table `packs`), ordered for display. */
export async function fetchPacks() {
    const sb = await getSupabase();
    if (!sb) return [];
    const { data, error } = await sb
        .from('packs')
        .select('*')
        .order('position')
        .order('created_at');
    if (error) {
        console.error('Failed to load packs.', error);
        return [];
    }
    return data;
}

/**
 * Packs with their levels resolved against the list, plus which leaderboard
 * players beat every level of the pack (completed or verified).
 */
export function resolvePacks(packs, list, leaderboard = []) {
    const byPath = new Map();
    (list ?? []).forEach(([level], i) => level && byPath.set(level.path, { ...level, rank: i + 1 }));
    return packs.map((pack) => {
        const levels = pack.levels.map((p) => byPath.get(p)).filter(Boolean);
        const paths = levels.map((l) => l.path);
        const completedBy = paths.length
            ? leaderboard.filter((e) => {
                  const done = new Set([...e.completed, ...e.verified].map((s) => s.path));
                  return paths.every((p) => done.has(p));
              })
            : [];
        return { ...pack, levels, completedBy };
    });
}

/**
 * Returns name -> account username for confirmed GD accounts, so records,
 * verifications and creator credits under the GD name count for the account.
 * Unknown names are returned unchanged.
 */
export function makeCanonical(profiles) {
    const alias = {};
    for (const p of Object.values(profiles ?? {})) {
        if (p.gd_verified && p.gd_username) alias[p.gd_username.toLowerCase()] = p.username;
    }
    return (name) => {
        const n = String(name ?? '');
        return alias[n.toLowerCase()] ?? profiles?.[n.toLowerCase()]?.username ?? n;
    };
}

/** Levels on the list that `name` published or helped create. */
export function createdBy(list, name, canonical = (n) => n) {
    const me = String(name).toLowerCase();
    const out = [];
    (list ?? []).forEach(([level], i) => {
        if (!level) return;
        const names = [level.author, ...(level.creators ?? [])].map((n) => canonical(n).toLowerCase());
        if (names.includes(me)) {
            out.push({ rank: i + 1, path: level.path, level: level.name, link: level.verification });
        }
    });
    return out;
}

/**
 * username (lower case) -> public profile
 * ({ username, nation, role, bio, banner_url, banner_color, pinned_levels })
 */
export async function fetchProfiles() {
    const sb = await getSupabase();
    if (!sb) return {};
    try {
        const rows = await fetchAll((from, to) =>
            sb
                .from('profiles')
                .select('id, username, nation, role, bio, banner_url, banner_color, pinned_levels, gd_username, gd_verified, created_at')
                .order('username')
                .range(from, to),
        );
        return Object.fromEntries(rows.map((p) => [p.username.toLowerCase(), p]));
    } catch (e) {
        console.error('Failed to load profiles.', e);
        return {};
    }
}

export async function fetchEditors() {
    try {
        const editorsResults = await fetch(`${dir}/_editors.json`);
        const editors = await editorsResults.json();
        return editors;
    } catch {
        return null;
    }
}

export async function fetchLeaderboard() {
    const [list, profiles, packs] = await Promise.all([fetchList(), fetchProfiles(), fetchPacks()]);
    if (!list) return [[], ['_list']];

    const canonical = makeCanonical(profiles);
    const scoreMap = {};
    const errs = [];
    list.forEach(([level, err], rank) => {
        if (err) {
            errs.push(err);
            return;
        }

        // Verification
        const verifierName = canonical(level.verifier);
        const verifier = Object.keys(scoreMap).find(
            (u) => u.toLowerCase() === verifierName.toLowerCase(),
        ) || verifierName;
        scoreMap[verifier] ??= {
            verified: [],
            completed: [],
            progressed: [],
        };
        const { verified } = scoreMap[verifier];
        verified.push({
            rank: rank + 1,
            path: level.path,
            level: level.name,
            score: score(rank + 1, 100, level.percentToQualify),
            link: level.verification,
        });

        // Records
        level.records.forEach((record) => {
            const user = Object.keys(scoreMap).find(
                (u) => u.toLowerCase() === record.user.toLowerCase(),
            ) || record.user;
            scoreMap[user] ??= {
                verified: [],
                completed: [],
                progressed: [],
            };
            const { completed, progressed } = scoreMap[user];
            const percent = Number(record.percent);
            (percent >= 100 ? completed : progressed).push({
                rank: rank + 1,
                path: level.path,
                level: level.name,
                percent,
                hz: record.hz,
                cbf: record.cbf,
                mobile: record.mobile,
                score: score(rank + 1, percent, level.percentToQualify),
                link: record.link,
            });
        });
    });

    // Wrap in extra Object containing the user and total score
    const res = Object.entries(scoreMap).map(([user, scores]) => {
        const { verified, completed, progressed } = scores;
        const total = [verified, completed, progressed]
            .flat()
            .reduce((prev, cur) => prev + cur.score, 0);

        return {
            user,
            nation: profiles[user.toLowerCase()]?.nation ?? null,
            profile: profiles[user.toLowerCase()] ?? null,
            total: round(total),
            ...scores,
        };
    });

    // creator credits (no points): publisher or creator of a list level
    for (const entry of res) entry.created = createdBy(list, entry.user, canonical);

    // packs every player has fully beaten -> bonus points
    for (const entry of res) entry.packs = [];
    for (const pack of resolvePacks(packs, list, res)) {
        for (const entry of pack.completedBy) {
            const points = Number(pack.points) || 0;
            entry.packs.push({ id: pack.id, name: pack.name, color: pack.color, points });
            entry.total = round(entry.total + points);
        }
    }

    // Sort by total score
    return [res.sort((a, b) => b.total - a.total), errs, list];
}

/** Regions a tournament can take place in ("world" = World Tournament). */
export const REGIONS = [
    { key: 'world', name: 'World' },
    { key: 'north_america', name: 'North America' },
    { key: 'south_america', name: 'South America' },
    { key: 'europe', name: 'Europe' },
    { key: 'africa', name: 'Africa' },
    { key: 'asia', name: 'Asia' },
    { key: 'oceania', name: 'Oceania' },
];

export function regionName(key) {
    return REGIONS.find((r) => r.key === key)?.name ?? key;
}

/** All tournaments, oldest first. */
export async function fetchTournaments() {
    const sb = await getSupabase();
    if (!sb) return [];
    try {
        return await fetchAll((from, to) =>
            sb.from('tournaments').select('*').order('starts_at').order('id').range(from, to),
        );
    } catch (e) {
        console.error('Failed to load tournaments.', e);
        return [];
    }
}
