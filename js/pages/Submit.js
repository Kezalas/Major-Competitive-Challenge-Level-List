import { auth } from '../auth.js';
import { fetchList } from '../content.js';
import { getSupabase, friendlyError } from '../supabase.js';
import { embed } from '../util.js';

import Spinner from '../components/Spinner.js';
/** Legacy levels (below #150) are locked and not offered here. */
import { MAIN_LIST_SIZE as ACCEPTING_RANKS, minPercentFor } from '../score.js';

export default {
    components: { Spinner },
    template: `
        <main v-if="loading">
            <Spinner></Spinner>
        </main>
        <main v-else class="page-form">
            <div class="form-card form-card--wide">
                <h1>Submit a record</h1>
                <p class="type-label-md muted">
                    Submitting as <strong>{{ auth.profile?.username }}</strong>.
                    Please read the submission requirements on the list page first.
                    You can follow the status on your <router-link to="/account" class="link">account page</router-link>.
                </p>

                <div v-if="sent" class="form-success">
                    <p>Record for <strong>{{ sent }}</strong> submitted! It is now waiting for review.</p>
                    <div class="row">
                        <button class="btn" @click="reset"><span class="type-label-lg">Submit another</span></button>
                        <router-link class="btn btn--secondary" to="/account"><span class="type-label-lg">My records</span></router-link>
                    </div>
                </div>

                <form v-else class="form" @submit.prevent="submit">
                    <label class="field">
                        <span class="type-label-lg">Level</span>
                        <input v-model.trim="filter" type="search" placeholder="Search by name or ID…">
                        <select v-model="levelPath" required size="6">
                            <option v-for="l in filteredLevels" :value="l.path">#{{ l.rank }} {{ l.name }} ({{ l.id }})</option>
                        </select>
                        <span class="hint" v-if="selectedLevel">
                            Selected: <strong>#{{ selectedLevel.rank }} {{ selectedLevel.name }}</strong> by {{ selectedLevel.author }}, ID {{ selectedLevel.id }}.
                            Make sure you beat exactly this ID.
                        </span>
                        <span class="hint warn" v-if="myBest != null">
                            You already have {{ myBest }}% on this level on the list.{{ myBest >= 100 ? '' : ' You can submit a better percentage.' }}
                        </span>
                    </label>

                    <label class="field">
                        <span class="type-label-lg">Video link</span>
                        <input v-model.trim="video" type="url" required placeholder="https://youtu.be/…">
                        <span class="hint">YouTube (unlisted is fine). Must show the end of the level, see requirements.</span>
                    </label>
                    <iframe v-if="videoEmbed" class="video-preview" :src="videoEmbed" frameborder="0" allowfullscreen></iframe>

                    <label class="field">
                        <span class="type-label-lg">Raw footage <span class="muted">(optional)</span></span>
                        <input v-model.trim="rawFootage" type="url" placeholder="Google Drive / Mega / … link">
                        <span class="hint">Recommended for Extreme Demons, staff may ask for it.</span>
                    </label>

                    <label class="field">
                        <span class="type-label-lg">Percent</span>
                        <input v-model.number="percent" type="number" :min="minPercent" max="100" step="1" required :disabled="minPercent === 100">
                        <span class="hint" v-if="selectedLevel">
                            {{ minPercent === 100 ? 'This level only accepts completions (100%).' : 'Progress from ' + minPercent + '% counts on this level.' }}
                        </span>
                    </label>

                    <div class="row">
                        <label class="field">
                            <span class="type-label-lg">FPS / Hz <span v-if="cbf" class="muted">(optional with CBF)</span></span>
                            <input v-model.number="hz" type="number" min="1" max="1000" :required="!cbf" placeholder="240">
                        </label>
                        <label class="check" title="Click Between Frames">
                            <input v-model="cbf" type="checkbox">
                            <span class="type-label-lg">CBF</span>
                        </label>
                        <label class="check">
                            <input v-model="mobile" type="checkbox">
                            <span class="type-label-lg">Played on mobile</span>
                        </label>
                    </div>

                    <label class="field">
                        <span class="type-label-lg">Comments <span class="muted">(optional)</span></span>
                        <textarea v-model.trim="comments" maxlength="1000" rows="3" placeholder="Anything the reviewers should know? Add a placement opinion if you have one"></textarea>
                    </label>

                    <p v-if="error" class="form-error">{{ error }}</p>

                    <button class="btn" type="submit" :disabled="busy || !levelPath">
                        <span class="type-label-lg">{{ busy ? 'Submitting…' : 'Submit' }}</span>
                    </button>
                </form>
            </div>
        </main>
    `,
    data: () => ({
        auth,
        loading: true,
        levels: [],
        filter: '',
        levelPath: '',
        video: '',
        rawFootage: '',
        percent: 100,
        hz: null,
        mobile: false,
        cbf: false,
        comments: '',
        busy: false,
        error: '',
        sent: '',
    }),
    computed: {
        filteredLevels() {
            const q = this.filter.toLowerCase();
            if (!q) return this.levels;
            return this.levels.filter(
                (l) =>
                    l.name.toLowerCase().includes(q) ||
                    String(l.id).includes(q) ||
                    l.path === this.levelPath,
            );
        },
        selectedLevel() {
            return this.levels.find((l) => l.path === this.levelPath) ?? null;
        },
        minPercent() {
            return this.selectedLevel ? minPercentFor(this.selectedLevel.rank, this.selectedLevel.percentToQualify) : 100;
        },
        /** best percentage the player already has on the selected level (or null) */
        myBest() {
            const me = auth.profile?.username?.toLowerCase();
            const r = me && this.selectedLevel?.records?.find((x) => x.user.toLowerCase() === me);
            return r ? Number(r.percent) : null;
        },
        videoEmbed() {
            return /youtu\.?be/.test(this.video) ? embed(this.video) : '';
        },
    },
    watch: {
        minPercent(min) {
            if (min === 100 || this.percent < min) this.percent = 100;
        },
    },
    async mounted() {
        const list = (await fetchList()) ?? [];
        this.levels = list
            .map(([level], i) => level && { ...level, rank: i + 1 })
            .filter((l) => l && l.rank <= ACCEPTING_RANKS);
        const pre = this.$route.query.level;
        if (pre && this.levels.some((l) => l.path === pre)) this.levelPath = pre;
        this.loading = false;
    },
    methods: {
        reset() {
            Object.assign(this, {
                sent: '',
                levelPath: '',
                video: '',
                rawFootage: '',
                percent: 100,
                comments: '',
                error: '',
            });
        },
        async submit() {
            const level = this.selectedLevel;
            if (!level) return;
            if (!(this.percent >= this.minPercent && this.percent <= 100)) {
                this.error = `Records on this level need at least ${this.minPercent}%.`;
                return;
            }
            if (this.myBest != null && this.percent <= this.myBest) {
                this.error = `You already have ${this.myBest}% on this level. Only better records can be submitted.`;
                return;
            }
            this.busy = true;
            this.error = '';
            try {
                const sb = await getSupabase();
                const { error } = await sb.from('submissions').insert({
                    level_path: level.path,
                    level_name: level.name,
                    level_id: level.id != null ? String(level.id) : null,
                    video: this.video,
                    raw_footage: this.rawFootage || null,
                    percent: this.percent,
                    hz: this.hz || null,
                    cbf: this.cbf,
                    mobile: this.mobile,
                    comments: this.comments || null,
                });
                if (error) throw error;
                this.sent = level.name;
            } catch (e) {
                this.error = friendlyError(e);
            } finally {
                this.busy = false;
            }
        },
    },
};
