import { auth } from '../auth.js';
import { REGIONS, fetchDbLevels, fetchList, fetchPacks, fetchTournaments, isDatabaseMode, regionName } from '../content.js';
import { getSupabase, fetchAll, friendlyError } from '../supabase.js';
import { embed, hzLabel, playerRoute } from '../util.js';
import { PROGRESS_RANKS, minPercentFor, score } from '../score.js';

import Spinner from '../components/Spinner.js';
import Flag from '../components/Flag.js';
import PlayerLink from '../components/PlayerLink.js';
import { faceFile, ratingOptions, difficultyOptions } from '../faces.js';

/** ISO timestamp -> value for <input type="datetime-local"> (local time) */
function toLocalInput(iso) {
    const d = iso ? new Date(iso) : new Date(Date.now() + 7 * 86400000);
    if (!iso) d.setHours(18, 0, 0, 0);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function emptyTournamentForm() {
    return { name: '', region: 'europe', starts_at: toLocalInput(null), size: 16, winner: '', link: '' };
}

function tournamentToForm(t) {
    return {
        name: t.name,
        region: t.region,
        starts_at: toLocalInput(t.starts_at),
        size: t.size,
        winner: t.winner ?? '',
        link: t.link ?? '',
    };
}

function emptyPackForm() {
    return { name: '', description: '', color: '#444444', points: 0, position: 0, levels: [] };
}

function emptyLevelForm() {
    return {
        level_id: null,
        placement: 1,
        name: '',
        author: '',
        verifier: '',
        creators: '',
        verification: '',
        showcase: '',
        rating: '',
        difficulty: '',
        password: '',
        percent_to_qualify: 100,
    };
}

const SELECT =
    '*, player:profiles!submissions_user_id_fkey(username, nation, created_at), reviewer:profiles!submissions_reviewer_id_fkey(username)';

const ARCHIVE_LIMIT = 300;

function editable(s) {
    return {
        video: s.video,
        raw_footage: s.raw_footage ?? '',
        percent: s.percent,
        hz: s.hz,
        mobile: s.mobile,
        cbf: s.cbf ?? false,
        reviewer_note: s.reviewer_note ?? '',
    };
}

export default {
    components: { Spinner, Flag, PlayerLink },
    template: `
        <main v-if="loading">
            <Spinner></Spinner>
        </main>
        <main v-else class="page-review">
            <h1 class="review-title">Staff</h1>
            <div class="tabs review-tabs">
                <button class="tab" :class="{ selected: tab === 'active' }" @click="switchTab('active')"><span class="type-label-lg">Active ({{ active.length }})</span></button>
                <button class="tab" :class="{ selected: tab === 'archived' }" @click="switchTab('archived')"><span class="type-label-lg">Archived</span></button>
                <button class="tab" :class="{ selected: tab === 'manual' }" @click="switchTab('manual')"><span class="type-label-lg">+ Manual entry</span></button>
                <button v-if="auth.isAdmin" class="tab" :class="{ selected: tab === 'levels' }" @click="switchTab('levels')"><span class="type-label-lg">Levels</span></button>
                <button v-if="auth.isAdmin" class="tab" :class="{ selected: tab === 'packs' }" @click="switchTab('packs')"><span class="type-label-lg">Packs</span></button>
                <button class="tab" :class="{ selected: tab === 'tournaments' }" @click="switchTab('tournaments')"><span class="type-label-lg">Tournaments</span></button>
                <button v-if="auth.isAdmin" class="tab" :class="{ selected: tab === 'users' }" @click="switchTab('users')"><span class="type-label-lg">Users &amp; roles</span></button>
            </div>
            <p v-if="error" class="form-error review-error">{{ error }}</p>

            <!-- Admins: add levels to the list -->
            <div v-if="tab === 'levels'" class="review-box review-box--single review-box--levels">
                <form class="form" @submit.prevent="saveLevel">
                    <h2>{{ editingPath ? 'Edit level' : 'Add a level' }}</h2>
                    <p class="muted type-label-md">
                        Changes go live on the list immediately. Placement = rank on the list; everything in between moves by one.
                        <template v-if="!dbMode"><br><strong>The JSON levels are not imported yet.</strong> Run <code>supabase/import_json_levels.sql</code> to manage every level here.</template>
                    </p>
                    <div class="row">
                        <label class="field">
                            <span class="type-label-lg">Level ID</span>
                            <input v-model.trim="levelForm.level_id" type="text" inputmode="numeric" maxlength="32" required :disabled="!!editingPath && !dbMode">
                        </label>
                        <label class="field">
                            <span class="type-label-lg">Placement</span>
                            <input v-model.number="levelForm.placement" type="number" min="1" :max="maxPlacement" required>
                        </label>
                    </div>
                    <p v-if="duplicateLevel" class="hint warn">Careful: ID {{ levelForm.level_id }} is already used by #{{ duplicateLevel.rank }} {{ duplicateLevel.name }}.</p>
                    <p v-if="placementPreview" class="hint">{{ placementPreview }}</p>
                    <label class="field">
                        <span class="type-label-lg">Name</span>
                        <input v-model.trim="levelForm.name" maxlength="64" required>
                    </label>
                    <div class="row">
                        <label class="field">
                            <span class="type-label-lg">Publisher</span>
                            <input v-model.trim="levelForm.author" maxlength="48" required>
                        </label>
                        <label class="field">
                            <span class="type-label-lg">Verifier</span>
                            <input v-model.trim="levelForm.verifier" maxlength="48" required>
                        </label>
                    </div>
                    <label class="field">
                        <span class="type-label-lg">Creators <span class="muted">(comma separated, leave empty if only the publisher)</span></span>
                        <input v-model="levelForm.creators" placeholder="Name1, Name2">
                    </label>
                    <label class="field">
                        <span class="type-label-lg">Verification video</span>
                        <input v-model.trim="levelForm.verification" type="url" required placeholder="https://youtu.be/…">
                    </label>
                    <label class="field">
                        <span class="type-label-lg">Showcase video <span class="muted">(optional)</span></span>
                        <input v-model.trim="levelForm.showcase" type="url">
                    </label>
                    <div class="row">
                        <label class="field">
                            <span class="type-label-lg">Rating</span>
                            <select v-model="levelForm.rating">
                                <option value="">N/A</option>
                                <option v-for="r in ratingOptions" :value="r">{{ r }}</option>
                            </select>
                        </label>
                        <label class="field">
                            <span class="type-label-lg">Difficulty</span>
                            <select v-model="levelForm.difficulty">
                                <option value="">N/A</option>
                                <option v-for="d in difficultyOptions" :value="d">{{ d }} demon</option>
                            </select>
                        </label>
                        <img v-if="formFace" :src="formFace" class="face-preview" alt="">
                        <span v-else class="face-preview face-preview--na">N/A</span>
                    </div>
                    <div class="row">
                        <label class="field">
                            <span class="type-label-lg">Password <span class="muted">(optional)</span></span>
                            <input v-model.trim="levelForm.password" maxlength="64" placeholder="Free To Copy">
                        </label>
                        <label class="field">
                            <span class="type-label-lg">Percent to qualify</span>
                            <input v-model.number="levelForm.percent_to_qualify" type="number" min="1" max="100" required>
                        </label>
                    </div>
                    <p class="hint">Progress records only count on #1 - #{{ PROGRESS_RANKS }}; below that every record needs 100%.</p>
                    <p v-if="levelsMsg" class="form-success">{{ levelsMsg }}</p>
                    <div class="row">
                        <button class="btn" type="submit" :disabled="busy"><span class="type-label-lg">{{ editingPath ? 'Save level' : 'Add level' }}</span></button>
                        <button v-if="editingPath" type="button" class="btn btn--secondary" @click="resetLevelForm()"><span class="type-label-lg">Cancel</span></button>
                    </div>
                </form>

                <h2>{{ dbMode ? 'All levels' : 'Levels added on the website' }} ({{ manageable.length }})</h2>
                <input v-if="dbMode" v-model.trim="levelFilter" type="search" class="user-search" placeholder="Search level…">
                <p v-if="!manageable.length" class="muted">None yet.</p>
                <table v-else class="user-table">
                    <tr v-for="l in filteredManageable">
                        <td class="user-name">
                            <span class="type-label-lg">#{{ l.rank }} {{ l.name }}</span>
                            <span class="type-label-sm muted"> ID {{ l.id }}</span>
                        </td>
                        <td class="user-role">
                            <button class="link-btn" :disabled="busy" @click="editLevel(l)"><span class="type-label-md">Edit</span></button>
                        </td>
                        <td class="user-role">
                            <button class="link-btn danger" :disabled="busy" @click="deleteLevel(l)"><span class="type-label-md">Remove</span></button>
                        </td>
                    </tr>
                </table>
            </div>

            <!-- Staff: tournaments -->
            <div v-else-if="tab === 'tournaments'" class="review-box review-box--single review-box--levels">
                <form class="form" @submit.prevent="saveTournament">
                    <h2>{{ editingTournament ? 'Edit tournament' : 'Schedule a tournament' }}</h2>
                    <p class="muted type-label-md">Shown on the public Tournaments page right away. Region "World" makes it a World Tournament (countdown at the top of the page).</p>
                    <label class="field">
                        <span class="type-label-lg">Name</span>
                        <input v-model.trim="tournamentForm.name" maxlength="64" required placeholder="MCCLL Europe Cup #1">
                    </label>
                    <div class="row">
                        <label class="field">
                            <span class="type-label-lg">Region</span>
                            <select v-model="tournamentForm.region" required>
                                <option v-for="r in REGIONS" :value="r.key">{{ r.name }}</option>
                            </select>
                        </label>
                        <label class="field">
                            <span class="type-label-lg">Date &amp; time <span class="muted">(your local time)</span></span>
                            <input v-model="tournamentForm.starts_at" type="datetime-local" required>
                        </label>
                        <label class="field pack-pos-field">
                            <span class="type-label-lg">Size</span>
                            <input v-model.number="tournamentForm.size" type="number" min="2" max="4096" required title="Number of players">
                        </label>
                    </div>
                    <div class="row">
                        <label class="field">
                            <span class="type-label-lg">Winner <span class="muted">(optional, after it ended)</span></span>
                            <input v-model.trim="tournamentForm.winner" maxlength="48">
                        </label>
                        <label class="field">
                            <span class="type-label-lg">Link <span class="muted">(optional, bracket / stream)</span></span>
                            <input v-model.trim="tournamentForm.link" type="url">
                        </label>
                    </div>
                    <p v-if="tournamentsMsg" class="form-success">{{ tournamentsMsg }}</p>
                    <div class="row">
                        <button class="btn" type="submit" :disabled="busy"><span class="type-label-lg">{{ editingTournament ? 'Save tournament' : 'Add tournament' }}</span></button>
                        <button v-if="editingTournament" type="button" class="btn btn--secondary" @click="resetTournamentForm()"><span class="type-label-lg">Cancel</span></button>
                    </div>
                </form>

                <h2>Tournaments ({{ tournaments.length }})</h2>
                <p v-if="!tournaments.length" class="muted">Nothing scheduled yet.</p>
                <table v-else class="user-table">
                    <tr v-for="t in tournamentsNewestFirst" :class="{ 'tourney-next': t.id === nextTournamentId, 'tourney-past': isPast(t) }">
                        <td class="user-name">
                            <span class="type-label-md muted">{{ date(t.starts_at) }}<template v-if="t.id === nextTournamentId"> (next)</template></span><br>
                            <span class="type-label-lg">{{ t.name }}</span>
                            <span class="type-label-sm muted"> {{ regionName(t.region) }}, {{ t.size }} players<template v-if="t.winner">, won by {{ t.winner }}</template></span>
                        </td>
                        <td class="user-role">
                            <button class="link-btn" :disabled="busy" @click="editTournament(t)"><span class="type-label-md">Edit</span></button>
                        </td>
                        <td class="user-role">
                            <button class="link-btn danger" :disabled="busy" @click="deleteTournament(t)"><span class="type-label-md">Delete</span></button>
                        </td>
                    </tr>
                </table>
            </div>

            <!-- Admins: packs -->
            <div v-else-if="tab === 'packs'" class="review-box review-box--single review-box--levels">
                <form class="form" @submit.prevent="savePack">
                    <h2>{{ editingPack ? 'Edit pack' : 'Create a pack' }}</h2>
                    <div class="row">
                        <label class="field">
                            <span class="type-label-lg">Name</span>
                            <input v-model.trim="packForm.name" maxlength="32" required>
                        </label>
                        <label class="field pack-color-field">
                            <span class="type-label-lg">Colour</span>
                            <input v-model="packForm.color" type="color" class="color-input">
                        </label>
                        <label class="field pack-pos-field">
                            <span class="type-label-lg">Points</span>
                            <input v-model.number="packForm.points" type="number" min="0" max="10000" step="0.001" required>
                        </label>
                        <label class="field pack-pos-field">
                            <span class="type-label-lg">Order</span>
                            <input v-model.number="packForm.position" type="number" title="Lower numbers are shown first">
                        </label>
                    </div>
                    <label class="field">
                        <span class="type-label-lg">Description <span class="muted">(optional)</span></span>
                        <textarea v-model="packForm.description" rows="2" maxlength="300"></textarea>
                    </label>
                    <div class="field">
                        <span class="type-label-lg">Levels <span class="muted">({{ packForm.levels.length }}/50)</span></span>
                        <p v-if="packLevelNames.length" class="pack-badges">
                            <span v-for="l in packLevelNames" class="pack-badge" :style="{ '--pack': packForm.color }">#{{ l.rank }} {{ l.name }}</span>
                        </p>
                        <input v-model.trim="packLevelFilter" type="search" placeholder="Search level…">
                        <div class="pin-list">
                            <label v-for="l in packLevelOptions" class="check">
                                <input type="checkbox" :value="l.path" v-model="packForm.levels" :disabled="!packForm.levels.includes(l.path) && packForm.levels.length >= 50">
                                <span class="type-label-md">#{{ l.rank }} {{ l.name }}</span>
                            </label>
                        </div>
                    </div>
                    <p class="hint">
                        Bonus points for beating every level of the pack (added to the leaderboard score).
                        <template v-if="packSuggestion">Suggestion: 10 % of the levels' points = {{ packSuggestion }}
                            <button type="button" class="link-btn" @click="packForm.points = packSuggestion"><span class="type-label-sm">use</span></button></template>
                    </p>
                    <p v-if="packsMsg" class="form-success">{{ packsMsg }}</p>
                    <div class="row">
                        <button class="btn" type="submit" :disabled="busy || !packForm.levels.length"><span class="type-label-lg">{{ editingPack ? 'Save pack' : 'Create pack' }}</span></button>
                        <button v-if="editingPack" type="button" class="btn btn--secondary" @click="resetPackForm()"><span class="type-label-lg">Cancel</span></button>
                    </div>
                </form>

                <h2>Packs ({{ packs.length }})</h2>
                <p v-if="!packs.length" class="muted">None yet.</p>
                <table v-else class="user-table">
                    <tr v-for="p in packs">
                        <td class="user-name">
                            <span class="pack-badge" :style="{ '--pack': p.color }">{{ p.name }}</span>
                            <span class="type-label-sm muted"> {{ p.levels.length }} levels, +{{ p.points }} points, order {{ p.position }}</span>
                        </td>
                        <td class="user-role">
                            <button class="link-btn" :disabled="busy" @click="editPack(p)"><span class="type-label-md">Edit</span></button>
                        </td>
                        <td class="user-role">
                            <button class="link-btn danger" :disabled="busy" @click="deletePack(p)"><span class="type-label-md">Delete</span></button>
                        </td>
                    </tr>
                </table>
            </div>

            <!-- Admins: give accounts reviewer/admin rights -->
            <div v-else-if="tab === 'users'" class="review-box review-box--single review-box--users">
                <h2>Users &amp; roles</h2>
                <p class="muted type-label-md">
                    <strong>Reviewer</strong>: can accept/reject records and add manual entries.
                    <strong>Admin</strong>: additionally manages roles and can delete submissions.
                    You cannot change your own role.
                </p>
                <input v-model.trim="userFilter" type="search" class="user-search" placeholder="Search username…">
                <div class="row row--center user-filter">
                    <label class="check"><input v-model="staffOnly" type="checkbox"><span class="type-label-md">Only show staff</span></label>
                    <label class="check"><input v-model="gdPendingOnly" type="checkbox"><span class="type-label-md">GD accounts to confirm ({{ gdPendingCount }})</span></label>
                    <span class="muted type-label-md">{{ filteredUsers.length }} of {{ users.length }} accounts</span>
                </div>
                <p v-if="usersLoading" class="muted">Loading…</p>
                <table v-else class="user-table">
                    <tr v-for="u in filteredUsers.slice(0, 200)">
                        <td class="user-name">
                            <span class="type-label-lg"><PlayerLink :name="u.username"><Flag :code="u.nation"></Flag></PlayerLink></span>
                            <span class="type-label-sm muted"> joined {{ new Date(u.created_at).toLocaleDateString() }}</span>
                            <span v-if="u.gd_username" class="type-label-sm gd-line">
                                GD: <strong>{{ u.gd_username }}</strong>
                                <span class="badge" :class="u.gd_verified ? 'badge--accepted' : 'badge--pending'">{{ u.gd_verified ? 'confirmed' : 'waiting' }}</span>
                                <button class="link-btn" :disabled="busy" @click="setGdVerified(u, !u.gd_verified)"><span class="type-label-sm">{{ u.gd_verified ? 'Unconfirm' : 'Confirm' }}</span></button>
                            </span>
                        </td>
                        <td>
                            <button v-if="u.banner_url || u.bio" class="link-btn danger" :disabled="busy" @click="clearCustomisation(u)" title="Remove banner image and bio"><span class="type-label-md">Clear banner/bio</span></button>
                        </td>
                        <td class="user-role">
                            <select :value="u.role" :disabled="busy || u.id === auth.profile?.id" @change="setRole(u, $event)">
                                <option value="user">User</option>
                                <option value="reviewer">Reviewer</option>
                                <option value="admin">Admin</option>
                            </select>
                        </td>
                    </tr>
                </table>
                <p v-if="filteredUsers.length > 200" class="muted type-label-md">Showing the first 200. Search to narrow it down.</p>
                <p v-if="usersMsg" class="form-success">{{ usersMsg }}</p>
            </div>

            <!-- Manual entry: for records from the old Google Form or added by staff -->
            <div v-else-if="tab === 'manual'" class="review-box review-box--single">
                <form class="form" @submit.prevent="addManual">
                    <h2>Add a record by hand</h2>
                    <p class="muted type-label-md">For players without an account (e.g. the old Google-Form backlog). If the player has an account, let them submit it themselves so it shows up on their profile.</p>
                    <label class="field">
                        <span class="type-label-lg">Player name</span>
                        <input v-model.trim="manual.player_name" maxlength="48" required>
                    </label>
                    <label class="field">
                        <span class="type-label-lg">Level</span>
                        <select v-model="manual.level_path" required>
                            <option v-for="l in levels" :value="l.path">#{{ l.rank }} {{ l.name }} ({{ l.id }})</option>
                        </select>
                    </label>
                    <label class="field">
                        <span class="type-label-lg">Video link</span>
                        <input v-model.trim="manual.video" type="url" required>
                    </label>
                    <label class="field">
                        <span class="type-label-lg">Raw footage</span>
                        <input v-model.trim="manual.raw_footage" type="url">
                    </label>
                    <label class="field">
                        <span class="type-label-lg">Percent</span>
                        <input v-model.number="manual.percent" type="number" min="1" max="100" required>
                    </label>
                    <div class="row">
                        <label class="field"><span class="type-label-lg">Hz</span><input v-model.number="manual.hz" type="number" min="1" max="1000"></label>
                        <label class="check"><input v-model="manual.mobile" type="checkbox"><span class="type-label-lg">Mobile</span></label>
                        <label class="check"><input v-model="manual.cbf" type="checkbox"><span class="type-label-lg">CBF</span></label>
                    </div>
                    <label class="field">
                        <span class="type-label-lg">Status</span>
                        <select v-model="manual.status">
                            <option value="accepted">Accepted (goes on the list right away)</option>
                            <option value="pending">Pending (review later)</option>
                        </select>
                    </label>
                    <p v-if="manualMsg" class="form-success">{{ manualMsg }}</p>
                    <button class="btn" type="submit" :disabled="busy"><span class="type-label-lg">Add record</span></button>
                </form>
            </div>

            <div v-else class="review-box">
                <ul class="review-list">
                    <li v-if="current.length === 0" class="muted review-empty">No submissions.</li>
                    <li v-for="s in current">
                        <button :class="{ active: selected?.id === s.id }" @click="select(s)">
                            <span class="type-label-lg">Submission #{{ s.id }}</span>
                            <span class="type-label-md">{{ s.level_name }}</span>
                            <span class="type-label-sm muted">By {{ name(s) }}<template v-if="tab === 'archived'"> ({{ s.status }})</template></span>
                        </button>
                    </li>
                </ul>

                <div v-if="selected" class="review-detail">
                    <div class="review-detail__side">
                        <a :href="selected.video" target="_blank">
                            <img v-if="thumb" :src="thumb" class="review-thumb" alt="">
                        </a>
                        <p class="type-label-md">Status: <span class="badge" :class="'badge--' + selected.status">{{ selected.status }}</span></p>
                        <template v-if="selected.status === 'pending'">
                            <button class="btn btn--accept" :disabled="busy" @click="setStatus('accepted')"><span class="type-label-lg">Accept</span></button>
                            <button class="btn btn--reject" :disabled="busy" @click="setStatus('rejected')"><span class="type-label-lg">Reject</span></button>
                        </template>
                        <template v-else>
                            <p class="type-label-sm muted">by {{ selected.reviewer?.username || '?' }}<br>{{ date(selected.reviewed_at) }}</p>
                            <button class="btn btn--secondary" :disabled="busy" @click="setStatus('pending')"><span class="type-label-lg">Back to pending</span></button>
                        </template>
                        <button class="btn btn--secondary" :disabled="busy || !dirty" @click="save()"><span class="type-label-lg">Save edits</span></button>
                        <button v-if="auth.isAdmin" class="link-btn danger" :disabled="busy" @click="remove()"><span class="type-label-md">Delete</span></button>
                    </div>

                    <div class="review-detail__main">
                        <h2>Submission #{{ selected.id }}</h2>
                        <p class="type-label-md">
                            Submitted by
                            <strong><PlayerLink :name="name(selected)"><Flag :code="selected.player?.nation"></Flag></PlayerLink></strong>
                            <span v-if="!selected.user_id" class="muted">&nbsp;(manual entry)</span>
                            on {{ date(selected.created_at) }}
                        </p>
                        <h3>
                            <span v-if="levelInfo">(#{{ levelInfo.rank }})</span>
                            {{ selected.level_name }}
                            <span v-if="levelInfo" class="muted type-label-lg">by {{ levelInfo.author }}</span>
                        </h3>
                        <p class="type-label-md">
                            ID: <strong>{{ selected.level_id ?? 'N/A' }}</strong>
                            <span v-if="levelInfo && String(levelInfo.id) !== String(selected.level_id)" class="warn"> (list says {{ levelInfo.id }})</span>
                            <span v-if="!levelInfo" class="warn"> (level is not on the list)</span>
                            <span v-else-if="Number(edit.percent) < levelMinPercent" class="warn"> (needs at least {{ levelMinPercent }}% on this rank)</span>
                        </p>
                        <p v-if="duplicate" class="form-info">This player already has a record on this level on the list.</p>

                        <iframe v-if="videoEmbed" class="video-preview" :src="videoEmbed" frameborder="0" allowfullscreen></iframe>

                        <div class="form">
                            <label class="field">
                                <span class="type-label-lg">Video</span>
                                <div class="row row--center"><input v-model.trim="edit.video" type="url"><a :href="edit.video" target="_blank" class="link type-label-md">open</a></div>
                            </label>
                            <label class="field">
                                <span class="type-label-lg">Raw footage</span>
                                <div class="row row--center"><input v-model.trim="edit.raw_footage" type="url" placeholder="none"><a v-if="edit.raw_footage" :href="edit.raw_footage" target="_blank" class="link type-label-md">open</a></div>
                            </label>
                            <label class="field">
                                <span class="type-label-lg">Percent</span>
                                <input v-model.number="edit.percent" type="number" min="1" max="100">
                            </label>
                            <div class="row">
                                <label class="field"><span class="type-label-lg">Hz</span><input v-model.number="edit.hz" type="number" min="1" max="1000"></label>
                                <label class="check"><input v-model="edit.mobile" type="checkbox"><span class="type-label-lg">Mobile</span></label>
                                <label class="check"><input v-model="edit.cbf" type="checkbox"><span class="type-label-lg">CBF</span></label>
                            </div>
                            <div class="field">
                                <span class="type-label-lg">Player comments</span>
                                <p class="comment-box">{{ selected.comments || 'None' }}</p>
                            </div>
                            <label class="field">
                                <span class="type-label-lg">Note to player <span class="muted">(shown on their account, e.g. reject reason)</span></span>
                                <textarea v-model.trim="edit.reviewer_note" rows="2" maxlength="1000"></textarea>
                            </label>
                        </div>
                    </div>
                </div>
                <div v-else class="review-detail review-detail--empty muted">
                    <p>Select a submission.</p>
                </div>
            </div>
        </main>
    `,
    data: () => ({
        auth,
        loading: true,
        busy: false,
        error: '',
        tab: 'active',
        active: [],
        archived: [],
        levels: [],
        selected: null,
        edit: {},
        manual: {
            player_name: '',
            level_path: '',
            video: '',
            raw_footage: '',
            percent: 100,
            hz: null,
            mobile: false,
            cbf: false,
            status: 'accepted',
        },
        manualMsg: '',
        users: [],
        usersLoading: false,
        userFilter: '',
        staffOnly: false,
        gdPendingOnly: false,
        usersMsg: '',
        levelForm: emptyLevelForm(),
        dbMode: false,
        levelFilter: '',
        packs: [],
        packForm: emptyPackForm(),
        editingPack: null,
        packLevelFilter: '',
        packsMsg: '',
        tournaments: [],
        tournamentForm: emptyTournamentForm(),
        editingTournament: null,
        tournamentsMsg: '',
        REGIONS,
        PROGRESS_RANKS,
        editingPath: null,
        levelsMsg: '',
        ratingOptions,
        difficultyOptions,
    }),
    computed: {
        manageable() {
            return this.dbMode ? this.levels : this.levels.filter((l) => l.fromDatabase);
        },
        filteredManageable() {
            const q = this.levelFilter.toLowerCase();
            if (!q) return this.manageable;
            return this.manageable.filter((l) => `${l.name} ${l.id} #${l.rank}`.toLowerCase().includes(q));
        },
        packLevelOptions() {
            const q = this.packLevelFilter.toLowerCase();
            return this.levels.filter(
                (l) => this.packForm.levels.includes(l.path) || !q || `${l.name} ${l.id} #${l.rank}`.toLowerCase().includes(q),
            );
        },
        tournamentsNewestFirst() {
            return [...this.tournaments].reverse();
        },
        nextTournamentId() {
            const now = Date.now();
            return this.tournaments.find((t) => new Date(t.starts_at).getTime() > now)?.id ?? null;
        },
        levelMinPercent() {
            return this.levelInfo ? minPercentFor(this.levelInfo.rank, this.levelInfo.percentToQualify) ?? 100 : 1;
        },
        packSuggestion() {
            const total = this.packLevelNames.reduce((sum, l) => sum + score(l.rank, 100, l.percentToQualify), 0);
            return total ? Math.round(total * 0.1 * 1000) / 1000 : 0;
        },
        packLevelNames() {
            return this.packForm.levels
                .map((p) => this.levels.find((l) => l.path === p))
                .filter(Boolean);
        },
        maxPlacement() {
            return this.levels.length + (this.editingPath ? 0 : 1);
        },
        duplicateLevel() {
            const id = String(this.levelForm.level_id || '');
            if (!id) return null;
            return this.levels.find((l) => String(l.id) === id && l.path !== this.editingPath) ?? null;
        },
        placementPreview() {
            const n = Number(this.levelForm.placement);
            if (!n) return '';
            const others = this.levels.filter((l) => l.path !== this.editingPath);
            const below = others[n - 1];
            const p = Math.min(n, others.length + 1);
            return below
                ? `Will be #${p}, directly above #${p} ${below.name} (which becomes #${p + 1}).`
                : `Will be #${p}, at the bottom of the list.`;
        },
        formFace() {
            return faceFile(this.levelForm.rating, this.levelForm.difficulty);
        },
        gdPendingCount() {
            return this.users.filter((u) => u.gd_username && !u.gd_verified).length;
        },
        filteredUsers() {
            const q = this.userFilter.toLowerCase();
            const order = { admin: 0, reviewer: 1, user: 2 };
            return this.users
                .filter((u) => !this.gdPendingOnly || (u.gd_username && !u.gd_verified))
                .filter((u) => (!this.staffOnly || u.role !== 'user') && (!q || `${u.username} ${u.gd_username ?? ''}`.toLowerCase().includes(q)))
                .sort((a, b) => order[a.role] - order[b.role] || a.username.localeCompare(b.username));
        },
        current() {
            return this.tab === 'archived' ? this.archived : this.active;
        },
        levelInfo() {
            return this.levels.find((l) => l.path === this.selected?.level_path) ?? null;
        },
        duplicate() {
            if (this.selected?.status !== 'pending') return false;
            const n = this.name(this.selected).toLowerCase();
            return Boolean(
                this.levelInfo?.records?.some((r) => r.user.toLowerCase() === n),
            );
        },
        videoEmbed() {
            return /youtu\.?be/.test(this.edit.video ?? '') ? embed(this.edit.video) : '';
        },
        thumb() {
            const e = this.videoEmbed;
            const id = e && e.split('/embed/')[1];
            return id ? `https://img.youtube.com/vi/${id}/mqdefault.jpg` : '';
        },
        dirty() {
            if (!this.selected) return false;
            return JSON.stringify(this.edit) !== JSON.stringify(editable(this.selected));
        },
    },
    async mounted() {
        await Promise.all([this.loadLevels(), this.load()]);
        this.loading = false;
        if (this.active[0]) this.select(this.active[0]);
    },
    methods: {
        hzLabel,
        playerRoute,
        async loadLevels() {
            const [list, dbLevels] = await Promise.all([fetchList(), fetchDbLevels()]);
            this.dbMode = isDatabaseMode(dbLevels);
            this.levels = (list ?? [])
                .map(([level], i) => level && { ...level, rank: i + 1 })
                .filter(Boolean);
        },
        /** unique path for a new level, e.g. gd-12345 (or gd-12345-2) */
        freePath(id) {
            const base = /^\d+$/.test(id) ? `gd-${id}` : `lvl-${id.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 40) || Date.now()}`;
            let path = base;
            for (let n = 2; this.levels.some((l) => l.path === path); n++) path = `${base}-${n}`;
            return path;
        },
        /** after "Edit": jump back up to the form and focus its first field */
        scrollToForm() {
            this.$nextTick(() => {
                const main = this.$el;
                const form = main.querySelector('.review-box--single form');
                main.scrollTo({ top: 0 });
                form?.querySelector('input:not([disabled]), select')?.focus({ preventScroll: true });
            });
        },
        isPast(t) {
            return new Date(t.starts_at).getTime() <= Date.now();
        },
        regionName,
        async loadTournaments() {
            this.tournaments = (await fetchTournaments()).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
        },
        resetTournamentForm() {
            this.editingTournament = null;
            this.tournamentForm = emptyTournamentForm();
        },
        editTournament(t) {
            this.tournamentsMsg = '';
            this.editingTournament = t.id;
            this.tournamentForm = tournamentToForm(t);
            this.scrollToForm();
        },
        async saveTournament() {
            const f = this.tournamentForm;
            const startsAt = new Date(f.starts_at);
            if (Number.isNaN(startsAt.getTime())) {
                this.error = 'Please enter a valid date and time.';
                return;
            }
            const row = {
                name: f.name,
                region: f.region,
                starts_at: startsAt.toISOString(),
                size: Math.round(Number(f.size)),
                winner: f.winner || null,
                link: f.link || null,
            };
            this.busy = true;
            this.error = '';
            this.tournamentsMsg = '';
            try {
                const sb = await getSupabase();
                const { error } = this.editingTournament
                    ? await sb.from('tournaments').update(row).eq('id', this.editingTournament)
                    : await sb.from('tournaments').insert(row);
                if (error) throw error;
                const msg = `${this.editingTournament ? 'Saved' : 'Scheduled'} ${row.name} (${regionName(row.region)}, ${this.date(row.starts_at)}).`;
                await this.loadTournaments();
                this.resetTournamentForm();
                this.tournamentsMsg = msg;
            } catch (e) {
                this.error = friendlyError(e);
            } finally {
                this.busy = false;
            }
        },
        async deleteTournament(t) {
            if (!confirm(`Delete the tournament ${t.name}?`)) return;
            this.busy = true;
            const sb = await getSupabase();
            const { error } = await sb.from('tournaments').delete().eq('id', t.id);
            this.busy = false;
            if (error) {
                this.error = friendlyError(error);
                return;
            }
            await this.loadTournaments();
            if (this.editingTournament === t.id) this.resetTournamentForm();
            this.tournamentsMsg = `Deleted ${t.name}.`;
        },
        async loadPacks() {
            this.packs = await fetchPacks();
            this.resetPackForm();
        },
        resetPackForm() {
            this.editingPack = null;
            this.packForm = emptyPackForm();
            this.packLevelFilter = '';
        },
        editPack(p) {
            this.packsMsg = '';
            this.editingPack = p.id;
            this.packForm = {
                name: p.name,
                description: p.description ?? '',
                color: p.color,
                points: Number(p.points) || 0,
                position: p.position,
                // drop levels that are no longer on the list
                levels: p.levels.filter((path) => this.levels.some((l) => l.path === path)),
            };
            this.scrollToForm();
        },
        async savePack() {
            const f = this.packForm;
            // keep pack levels in list order
            const order = new Map(this.levels.map((l) => [l.path, l.rank]));
            const row = {
                name: f.name,
                description: f.description.trim() || null,
                color: f.color,
                position: Number(f.position) || 0,
                points: Math.max(0, Number(f.points) || 0),
                levels: [...f.levels].sort((a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9)),
            };
            this.busy = true;
            this.error = '';
            this.packsMsg = '';
            try {
                const sb = await getSupabase();
                const { error } = this.editingPack
                    ? await sb.from('packs').update(row).eq('id', this.editingPack)
                    : await sb.from('packs').insert(row);
                if (error) throw error;
                const msg = `${this.editingPack ? 'Saved' : 'Created'} pack ${row.name}.`;
                await this.loadPacks();
                this.packsMsg = msg;
            } catch (e) {
                this.error = friendlyError(e);
            } finally {
                this.busy = false;
            }
        },
        async deletePack(p) {
            if (!confirm(`Delete the pack ${p.name}?`)) return;
            this.busy = true;
            const sb = await getSupabase();
            const { error } = await sb.from('packs').delete().eq('id', p.id);
            this.busy = false;
            if (error) {
                this.error = friendlyError(error);
                return;
            }
            await this.loadPacks();
            this.packsMsg = `Deleted pack ${p.name}.`;
        },
        resetLevelForm() {
            this.editingPath = null;
            this.levelForm = emptyLevelForm();
            this.levelForm.placement = this.levels.length + 1;
        },
        editLevel(l) {
            this.levelsMsg = '';
            this.editingPath = l.path;
            this.levelForm = {
                level_id: l.id,
                placement: l.rank,
                name: l.name,
                author: l.author,
                verifier: l.verifier,
                creators: (l.creators ?? []).join(', '),
                verification: l.verification,
                showcase: l.showcase ?? '',
                rating: l.rating ?? '',
                difficulty: l.difficulty ?? '',
                password: l.password ?? '',
                percent_to_qualify: Number(l.percentToQualify) || 100,
            };
            this.scrollToForm();
        },
        async saveLevel() {
            const f = this.levelForm;
            const row = {
                name: f.name,
                author: f.author,
                verifier: f.verifier,
                creators: f.creators.split(',').map((c) => c.trim()).filter(Boolean),
                verification: f.verification,
                showcase: f.showcase || null,
                rating: f.rating || null,
                difficulty: f.difficulty || null,
                password: f.password || null,
                percent_to_qualify: Math.min(100, Math.max(1, Math.round(Number(f.percent_to_qualify) || 100))),
                placement: Math.max(1, Math.round(f.placement)),
            };
            this.busy = true;
            this.error = '';
            this.levelsMsg = '';
            try {
                const sb = await getSupabase();
                const id = String(f.level_id).trim();
                let path = this.editingPath;
                let res;
                if (path) {
                    res = await sb.from('levels').update({ ...row, level_id: id }).eq('path', path);
                } else {
                    path = this.freePath(id);
                    res = await sb.from('levels').insert({ ...row, path, level_id: id });
                }
                if (res.error) throw res.error;
                if (this.dbMode) {
                    // placement = rank: shift the others
                    const moved = await sb.rpc('move_level', { p_path: path, p_position: row.placement });
                    if (moved.error) throw moved.error;
                }
                const msg = `${this.editingPath ? 'Saved' : 'Added'} ${row.name} at #${row.placement}.`;
                await this.loadLevels();
                this.resetLevelForm();
                this.levelsMsg = msg;
            } catch (e) {
                this.error = e.code === '23505' ? 'This level ID was already added.' : friendlyError(e);
            } finally {
                this.busy = false;
            }
        },
        async deleteLevel(l) {
            if (!confirm(`Remove #${l.rank} ${l.name} from the list? Its records stay in the database but are no longer shown.`)) return;
            this.busy = true;
            this.error = '';
            const sb = await getSupabase();
            let { error } = await sb.from('levels').delete().eq('path', l.path);
            if (!error && this.dbMode) ({ error } = await sb.rpc('renumber_levels'));
            this.busy = false;
            if (error) {
                this.error = friendlyError(error);
                return;
            }
            await this.loadLevels();
            this.resetLevelForm();
            this.levelsMsg = `Removed ${l.name}.`;
        },
        async loadUsers() {
            this.usersLoading = true;
            try {
                const sb = await getSupabase();
                this.users = await fetchAll((from, to) =>
                    sb.from('profiles')
                        .select('id, username, nation, role, created_at, banner_url, bio, gd_username, gd_verified')
                        .order('created_at')
                        .range(from, to),
                );
            } catch (e) {
                this.error = friendlyError(e);
            } finally {
                this.usersLoading = false;
            }
        },
        async updateProfile(u, patch) {
            this.busy = true;
            this.error = '';
            this.usersMsg = '';
            try {
                const sb = await getSupabase();
                const { data, error } = await sb
                    .from('profiles')
                    .update(patch)
                    .eq('id', u.id)
                    .select('id, username, nation, role, created_at, banner_url, bio, gd_username, gd_verified')
                    .single();
                if (error) throw error;
                Object.assign(u, data);
                return data;
            } catch (e) {
                this.error = friendlyError(e);
                return null;
            } finally {
                this.busy = false;
            }
        },
        async setRole(u, event) {
            const role = event.target.value;
            if (role === 'admin' && !confirm(`Make ${u.username} an ADMIN? Admins can change everyone's roles.`)) {
                event.target.value = u.role;
                return;
            }
            const data = await this.updateProfile(u, { role });
            if (!data || data.role !== role) {
                event.target.value = u.role;
                if (data) this.error = 'Role could not be changed.';
                return;
            }
            this.usersMsg = `${u.username} is now ${role}.`;
        },
        async setGdVerified(u, value) {
            if (value && !confirm(`Confirm that ${u.username} really is "${u.gd_username}" in Geometry Dash? Records, verifications and creator credits under that name will count for this account.`)) return;
            const data = await this.updateProfile(u, { gd_verified: value });
            if (data) this.usersMsg = value ? `${u.username} is now linked to GD account ${u.gd_username}.` : `Removed the GD link of ${u.username}.`;
        },
        async clearCustomisation(u) {
            if (!confirm(`Remove banner image and bio of ${u.username}?`)) return;
            const data = await this.updateProfile(u, { banner_url: null, bio: null });
            if (data) this.usersMsg = `Cleared banner and bio of ${u.username}.`;
        },
        name(s) {
            return s?.player?.username ?? s?.player_name ?? '?';
        },
        date(iso) {
            return iso ? new Date(iso).toLocaleString() : '';
        },
        async load() {
            this.error = '';
            try {
                const sb = await getSupabase();
                const [a, b] = await Promise.all([
                    sb.from('submissions').select(SELECT).eq('status', 'pending').order('created_at', { ascending: true }),
                    sb.from('submissions').select(SELECT).neq('status', 'pending').order('reviewed_at', { ascending: false }).limit(ARCHIVE_LIMIT),
                ]);
                if (a.error) throw a.error;
                if (b.error) throw b.error;
                this.active = a.data;
                this.archived = b.data;
            } catch (e) {
                this.error = friendlyError(e);
            }
        },
        switchTab(tab) {
            this.tab = tab;
            this.manualMsg = '';
            this.usersMsg = '';
            this.levelsMsg = '';
            if (tab === 'users') this.loadUsers();
            else if (tab === 'levels') this.resetLevelForm();
            else if (tab === 'packs') this.loadPacks();
            else if (tab === 'tournaments') {
                this.tournamentsMsg = '';
                this.resetTournamentForm();
                this.loadTournaments();
            }
            else if (tab !== 'manual') {
                // refresh, new submissions may have arrived in the meantime
                this.select(this.current[0] ?? null);
                this.load().then(() => {
                    const keep = this.current.find((s) => s.id === this.selected?.id);
                    if (!keep) this.select(this.current[0] ?? null);
                    else if (!this.dirty) this.select(keep);
                });
            }
        },
        select(s) {
            this.selected = s;
            this.edit = s ? editable(s) : {};
        },
        changes() {
            return {
                video: this.edit.video,
                raw_footage: this.edit.raw_footage || null,
                percent: this.edit.percent,
                hz: this.edit.hz || null,
                mobile: this.edit.mobile,
                cbf: this.edit.cbf,
                reviewer_note: this.edit.reviewer_note || null,
            };
        },
        async update(patch) {
            this.busy = true;
            this.error = '';
            try {
                const sb = await getSupabase();
                const { data, error } = await sb
                    .from('submissions')
                    .update(patch)
                    .eq('id', this.selected.id)
                    .select(SELECT)
                    .single();
                if (error) throw error;
                return data;
            } catch (e) {
                this.error = friendlyError(e);
                return null;
            } finally {
                this.busy = false;
            }
        },
        async save() {
            const row = await this.update(this.changes());
            if (!row) return;
            for (const listName of ['active', 'archived']) {
                const i = this[listName].findIndex((s) => s.id === row.id);
                if (i !== -1) this[listName][i] = row;
            }
            this.select(row);
        },
        async setStatus(status) {
            const row = await this.update({ ...this.changes(), status });
            if (!row) return;
            const from = this.tab === 'archived' ? this.archived : this.active;
            const idx = from.findIndex((s) => s.id === row.id);
            from.splice(idx, 1);
            if (status === 'pending') this.active.push(row);
            else this.archived.unshift(row);
            // continue with the next submission in the same tab
            this.select(from[Math.min(idx, from.length - 1)] ?? null);
        },
        async remove() {
            if (!confirm(`Delete submission #${this.selected.id} permanently?`)) return;
            this.busy = true;
            const sb = await getSupabase();
            const { error } = await sb.from('submissions').delete().eq('id', this.selected.id);
            this.busy = false;
            if (error) {
                this.error = friendlyError(error);
                return;
            }
            const id = this.selected.id;
            this.active = this.active.filter((s) => s.id !== id);
            this.archived = this.archived.filter((s) => s.id !== id);
            this.select(this.current[0] ?? null);
        },
        async addManual() {
            const level = this.levels.find((l) => l.path === this.manual.level_path);
            if (!level) return;
            this.busy = true;
            this.error = '';
            this.manualMsg = '';
            try {
                const sb = await getSupabase();
                const { data, error } = await sb
                    .from('submissions')
                    .insert({
                        user_id: null,
                        player_name: this.manual.player_name,
                        level_path: level.path,
                        level_name: level.name,
                        level_id: level.id != null ? String(level.id) : null,
                        video: this.manual.video,
                        raw_footage: this.manual.raw_footage || null,
                        percent: this.manual.percent,
                        hz: this.manual.hz || null,
                        mobile: this.manual.mobile,
                        cbf: this.manual.cbf,
                        status: this.manual.status,
                    })
                    .select(SELECT)
                    .single();
                if (error) throw error;
                if (data.status === 'pending') this.active.push(data);
                else this.archived.unshift(data);
                this.manualMsg = `Added ${data.player_name} on ${data.level_name} (${data.status}).`;
                Object.assign(this.manual, { player_name: '', video: '', raw_footage: '', percent: 100 });
            } catch (e) {
                this.error = friendlyError(e);
            } finally {
                this.busy = false;
            }
        },
    },
};
