import { auth, loadProfile, signOut } from '../auth.js';
import { countries } from '../countries.js';
import { fetchLeaderboard } from '../content.js';
import { getSupabase, friendlyError } from '../supabase.js';
import { hzLabel, localize, playerRoute } from '../util.js';

import Flag from '../components/Flag.js';

const USERNAME_RE = /^[A-Za-z0-9_.-]{3,24}$/;

export default {
    components: { Flag },
    template: `
        <main class="page-form page-account">
            <div class="account-grid">
                <!-- Profile -->
                <section class="form-card">
                    <h1 class="account-title">
                        <Flag :code="auth.profile?.nation"></Flag>
                        {{ auth.profile?.username }}
                    </h1>
                    <router-link class="type-label-md link" :to="playerRoute(auth.profile?.username || '')">View my public profile</router-link>
                    <p class="type-label-md muted">
                        <span v-if="auth.profile?.role !== 'user'" class="badge badge--staff">{{ auth.profile?.role }}</span>
                        {{ auth.user?.email }}
                    </p>
                    <ul class="account-stats" v-if="stats">
                        <li><span class="type-title-sm">Rank</span><p>{{ stats.rank ? '#' + stats.rank : 'N/A' }}</p></li>
                        <li><span class="type-title-sm">Points</span><p>{{ localize(stats.total) }}</p></li>
                        <li><span class="type-title-sm">Records</span><p>{{ stats.completed }}</p></li>
                    </ul>

                    <p v-if="auth.recovery" class="form-info">You opened a password reset link. Set your new password below.</p>

                    <form class="form" @submit.prevent="saveProfile">
                        <h2>Profile</h2>
                        <label class="field">
                            <span class="type-label-lg">Username</span>
                            <input v-model.trim="username" type="text" maxlength="24" required>
                            <span class="hint">Shown on the list and leaderboard. Records you got through this site follow a rename; records added by hand before keep the old name.</span>
                        </label>
                        <label class="field">
                            <span class="type-label-lg">Nation</span>
                            <div class="row row--center">
                                <select v-model="nation">
                                    <option value="">None</option>
                                    <option v-for="c in countries" :value="c.code">{{ c.name }}</option>
                                </select>
                                <Flag :code="nation"></Flag>
                            </div>
                        </label>
                        <label class="field">
                            <span class="type-label-lg">Geometry Dash account <span class="muted">(optional)</span></span>
                            <div class="row row--center">
                                <input v-model.trim="gdUsername" type="text" maxlength="32" placeholder="Your GD username">
                                <span v-if="auth.profile?.gd_username && gdUsername === auth.profile.gd_username" class="badge" :class="auth.profile.gd_verified ? 'badge--accepted' : 'badge--pending'">
                                    {{ auth.profile.gd_verified ? 'confirmed' : 'waiting' }}
                                </span>
                            </div>
                            <span class="hint">
                                Levels you created or verified and records listed under this name are added to your account
                                once staff confirmed it's really you (e.g. ask on Discord). Changing it needs a new confirmation.
                            </span>
                        </label>

                        <label class="field">
                            <span class="type-label-lg">Bio <span class="muted">(optional)</span></span>
                            <textarea v-model="bio" rows="3" maxlength="300" placeholder="A few words about you"></textarea>
                            <span class="hint">{{ bio.length }}/300</span>
                        </label>

                        <div class="field">
                            <span class="type-label-lg">Banner</span>
                            <div class="banner-preview" :class="{ 'banner-preview--image': bannerUrl && !bannerFailed }" :style="{ background: 'linear-gradient(135deg, ' + bannerColor + ', #1c1b1f)' }">
                                <img v-if="bannerUrl && !bannerFailed" :src="bannerUrl" alt="" @error="bannerFailed = true" referrerpolicy="no-referrer">
                            </div>
                            <div class="row row--center">
                                <input v-model.trim="bannerUrl" type="url" placeholder="https://… image link (optional)" @input="bannerFailed = false">
                                <input v-model="bannerColor" type="color" class="color-input" title="Banner colour">
                            </div>
                            <span class="hint" :class="{ warn: bannerFailed }">
                                {{ bannerFailed ? 'This image could not be loaded. Use a direct image link (ending in .png/.jpg/.gif).' : 'Direct link to an image (https), e.g. from imgur. Without image the colour is used. Inappropriate banners get removed.' }}
                            </span>
                        </div>

                        <div class="field">
                            <span class="type-label-lg">Pinned records <span class="muted">({{ pinned.length }}/3)</span></span>
                            <p v-if="!pinOptions.length" class="hint">Once you have records on the list you can pin up to 3 of them to your profile.</p>
                            <div v-else class="pin-list">
                                <label v-for="o in pinOptions" class="check">
                                    <input type="checkbox" :value="o.path" v-model="pinned" :disabled="!pinned.includes(o.path) && pinned.length >= 3">
                                    <span class="type-label-md">#{{ o.rank }} {{ o.level }} <span class="muted">({{ o.kind }})</span></span>
                                </label>
                            </div>
                        </div>

                        <p v-if="profileMsg" :class="profileOk ? 'form-success' : 'form-error'">{{ profileMsg }}</p>
                        <button class="btn" type="submit" :disabled="busy"><span class="type-label-lg">Save profile</span></button>
                    </form>

                    <form class="form" @submit.prevent="changePassword">
                        <h2>Password</h2>
                        <label class="field">
                            <span class="type-label-lg">New password</span>
                            <input v-model="password" type="password" minlength="6" autocomplete="new-password" required>
                        </label>
                        <label class="field">
                            <span class="type-label-lg">Repeat new password</span>
                            <input v-model="password2" type="password" minlength="6" autocomplete="new-password" required>
                        </label>
                        <p v-if="passwordMsg" :class="passwordOk ? 'form-success' : 'form-error'">{{ passwordMsg }}</p>
                        <button class="btn" type="submit" :disabled="busy"><span class="type-label-lg">Change password</span></button>
                    </form>

                    <div class="row">
                        <button class="btn btn--secondary" @click="logout"><span class="type-label-lg">Log out</span></button>
                    </div>
                </section>

                <!-- Records -->
                <section class="form-card form-card--wide">
                    <div class="row row--between">
                        <h2>My submissions</h2>
                        <router-link class="btn" to="/submit"><span class="type-label-lg">Submit record</span></router-link>
                    </div>
                    <div class="tabs">
                        <button v-for="t in tabs" class="tab" :class="{ selected: tab === t.key }" @click="tab = t.key">
                            <span class="type-label-lg">{{ t.label }} ({{ count(t.key) }})</span>
                        </button>
                    </div>
                    <p v-if="loadingSubs" class="muted">Loading…</p>
                    <p v-else-if="subsError" class="form-error">{{ subsError }}</p>
                    <p v-else-if="visibleSubs.length === 0" class="muted">Nothing here yet.</p>
                    <ul v-else class="submission-list">
                        <li v-for="s in visibleSubs" class="submission-item">
                            <div class="submission-item__main">
                                <span class="type-label-lg">{{ s.level_name }}</span>
                                <span class="badge" :class="'badge--' + s.status">{{ s.status }}</span>
                            </div>
                            <div class="submission-item__meta type-label-md muted">
                                <a :href="s.video" target="_blank" class="link">Video</a>
                                <span>{{ s.percent }}%</span>
                                <span v-if="hzLabel(s)">{{ hzLabel(s) }}</span>
                                <span v-if="s.mobile">Mobile</span>
                                <span>Submitted {{ date(s.created_at) }}</span>
                                <span v-if="s.reviewed_at">Reviewed {{ date(s.reviewed_at) }}</span>
                            </div>
                            <p v-if="s.reviewer_note" class="submission-item__note"><strong>Reviewer:</strong> {{ s.reviewer_note }}</p>
                            <button v-if="s.status === 'pending'" class="link-btn danger" @click="withdraw(s)"><span class="type-label-md">Withdraw</span></button>
                        </li>
                    </ul>
                </section>
            </div>
        </main>
    `,
    data: () => ({
        auth,
        countries,
        username: '',
        nation: '',
        password: '',
        password2: '',
        busy: false,
        profileMsg: '',
        profileOk: false,
        passwordMsg: '',
        passwordOk: false,
        subs: [],
        loadingSubs: true,
        subsError: '',
        tab: 'pending',
        tabs: [
            { key: 'pending', label: 'Pending' },
            { key: 'accepted', label: 'Accepted' },
            { key: 'rejected', label: 'Rejected' },
        ],
        stats: null,
        entry: null,
        bio: '',
        bannerUrl: '',
        bannerColor: '#0043dc',
        bannerFailed: false,
        pinned: [],
        gdUsername: '',
    }),
    computed: {
        pinOptions() {
            if (!this.entry) return [];
            return [
                ...this.entry.verified.map((v) => ({ ...v, kind: 'verified' })),
                ...this.entry.completed.map((c) => ({ ...c, kind: 'completed' })),
                ...this.entry.progressed.map((c) => ({ ...c, kind: c.percent + '%' })),
            ].sort((a, b) => a.rank - b.rank);
        },
        visibleSubs() {
            return this.subs.filter((s) => s.status === this.tab);
        },
    },
    watch: {
        'auth.profile': {
            immediate: true,
            handler(p) {
                this.username = p?.username ?? '';
                this.nation = p?.nation ?? '';
                this.bio = p?.bio ?? '';
                this.bannerUrl = p?.banner_url ?? '';
                this.bannerColor = p?.banner_color ?? '#0043dc';
                this.pinned = [...(p?.pinned_levels ?? [])];
                this.gdUsername = p?.gd_username ?? '';
            },
        },
    },
    async mounted() {
        await this.loadSubs();
        if (this.subs.length && !this.count('pending')) this.tab = 'accepted';
        this.loadStats();
    },
    methods: {
        localize,
        hzLabel,
        playerRoute,
        date(iso) {
            return new Date(iso).toLocaleDateString();
        },
        count(status) {
            return this.subs.filter((s) => s.status === status).length;
        },
        async loadSubs() {
            this.loadingSubs = true;
            this.subsError = '';
            try {
                const sb = await getSupabase();
                const { data, error } = await sb
                    .from('submissions')
                    .select('*')
                    .eq('user_id', auth.user.id)
                    .order('created_at', { ascending: false });
                if (error) throw error;
                this.subs = data;
            } catch (e) {
                this.subsError = friendlyError(e);
            } finally {
                this.loadingSubs = false;
            }
        },
        async loadStats() {
            const name = auth.profile?.username?.toLowerCase();
            if (!name) return;
            const [board] = await fetchLeaderboard();
            const i = board.findIndex((e) => e.user.toLowerCase() === name);
            this.entry = i === -1 ? null : board[i];
            this.stats =
                i === -1
                    ? { rank: null, total: 0, completed: 0 }
                    : {
                          rank: i + 1,
                          total: board[i].total,
                          completed: board[i].completed.length + board[i].progressed.length,
                      };
        },
        async saveProfile() {
            this.profileMsg = '';
            if (this.gdUsername && !/^[A-Za-z0-9 _.-]{1,32}$/.test(this.gdUsername)) {
                this.profileOk = false;
                this.profileMsg = 'GD usernames may only contain letters, numbers, spaces and _ . -';
                return;
            }
            if (!USERNAME_RE.test(this.username)) {
                this.profileOk = false;
                this.profileMsg = 'Usernames need 3 - 24 characters: letters, numbers, _ . and -';
                return;
            }
            this.busy = true;
            try {
                const sb = await getSupabase();
                const { error } = await sb
                    .from('profiles')
                    .update({
                        username: this.username,
                        nation: this.nation || null,
                        bio: this.bio.trim() || null,
                        banner_url: this.bannerUrl || null,
                        banner_color: this.bannerColor,
                        pinned_levels: this.pinned.slice(0, 3),
                        gd_username: this.gdUsername || null,
                    })
                    .eq('id', auth.user.id);
                if (error) throw error;
                await loadProfile();
                this.profileOk = true;
                this.profileMsg = 'Saved.';
            } catch (e) {
                this.profileOk = false;
                this.profileMsg = friendlyError(e);
            } finally {
                this.busy = false;
            }
        },
        async changePassword() {
            this.passwordMsg = '';
            if (this.password !== this.password2) {
                this.passwordOk = false;
                this.passwordMsg = 'The passwords do not match.';
                return;
            }
            this.busy = true;
            try {
                const sb = await getSupabase();
                const { error } = await sb.auth.updateUser({ password: this.password });
                if (error) throw error;
                this.password = this.password2 = '';
                auth.recovery = false;
                this.passwordOk = true;
                this.passwordMsg = 'Password changed.';
            } catch (e) {
                this.passwordOk = false;
                this.passwordMsg = friendlyError(e);
            } finally {
                this.busy = false;
            }
        },
        async withdraw(s) {
            if (!confirm(`Withdraw your submission for ${s.level_name}?`)) return;
            const sb = await getSupabase();
            const { error } = await sb.from('submissions').delete().eq('id', s.id);
            if (error) {
                alert(friendlyError(error));
                return;
            }
            this.subs = this.subs.filter((x) => x.id !== s.id);
        },
        async logout() {
            await signOut();
            this.$router.push('/');
        },
    },
};
