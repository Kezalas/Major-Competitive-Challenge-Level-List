import { createdBy, fetchLeaderboard, fetchProfiles, makeCanonical } from '../content.js';
import { localize, playerRoute } from '../util.js';
import { MAIN_LIST_SIZE } from '../score.js';

import Spinner from '../components/Spinner.js';
import ProfileSummary from '../components/ProfileSummary.js';

/** Public profile of a player (works for accounts and for names that only exist in the JSON data). */
export default {
    components: { Spinner, ProfileSummary },
    template: `
        <main v-if="loading">
            <Spinner></Spinner>
        </main>
        <main v-else class="page-player">
            <div v-if="!entry && !profile && !created.length" class="player-page">
                <h1>Player not found</h1>
                <p class="muted">Nobody called “{{ name }}” is on the leaderboard or has an account.</p>
                <router-link class="link" to="/leaderboard">Back to the leaderboard</router-link>
            </div>
            <div v-else class="player-page">
                <ProfileSummary :name="name" :entry="entry" :rank="rank" :profile="profile" :created="created"></ProfileSummary>

                <template v-if="entry">
                    <h2 v-if="entry.verified.length">Verified ({{ entry.verified.length }})</h2>
                    <table class="table player-table" v-if="entry.verified.length">
                        <tr v-for="s in entry.verified">
                            <td class="rank"><p :title="'#' + s.rank">{{ s.rank > MAIN_LIST_SIZE ? 'Legacy' : '#' + s.rank }}</p></td>
                            <td class="level"><router-link class="type-label-lg" :to="{ path: '/', query: { level: s.path } }">{{ s.level }}</router-link></td>
                            <td><a class="type-label-md link" :href="s.link" target="_blank">Video</a></td>
                            <td class="score"><p>{{ s.rank > MAIN_LIST_SIZE ? '0' : '+' + localize(s.score) }}</p></td>
                        </tr>
                    </table>
                    <h2 v-if="entry.completed.length">Completed ({{ entry.completed.length }})</h2>
                    <table class="table player-table" v-if="entry.completed.length">
                        <tr v-for="s in entry.completed">
                            <td class="rank"><p :title="'#' + s.rank">{{ s.rank > MAIN_LIST_SIZE ? 'Legacy' : '#' + s.rank }}</p></td>
                            <td class="level"><router-link class="type-label-lg" :to="{ path: '/', query: { level: s.path } }">{{ s.level }}</router-link></td>
                            <td><a class="type-label-md link" :href="s.link" target="_blank">Video</a></td>
                            <td class="score"><p>{{ s.rank > MAIN_LIST_SIZE ? '0' : '+' + localize(s.score) }}</p></td>
                        </tr>
                    </table>
                    <h2 v-if="entry.progressed.length">Progressed ({{ entry.progressed.length }})</h2>
                    <table class="table player-table" v-if="entry.progressed.length">
                        <tr v-for="s in entry.progressed">
                            <td class="rank"><p :title="'#' + s.rank">{{ s.rank > MAIN_LIST_SIZE ? 'Legacy' : '#' + s.rank }}</p></td>
                            <td class="level"><router-link class="type-label-lg" :to="{ path: '/', query: { level: s.path } }">{{ s.percent }}% {{ s.level }}</router-link></td>
                            <td><a class="type-label-md link" :href="s.link" target="_blank">Video</a></td>
                            <td class="score"><p>{{ s.rank > MAIN_LIST_SIZE ? '0' : '+' + localize(s.score) }}</p></td>
                        </tr>
                    </table>
                </template>
                <p v-else class="muted">No records on the list yet.</p>

                <template v-if="created.length">
                    <h2>Created ({{ created.length }})</h2>
                    <table class="table player-table">
                        <tr v-for="s in created">
                            <td class="rank"><p :title="'#' + s.rank">{{ s.rank > MAIN_LIST_SIZE ? 'Legacy' : '#' + s.rank }}</p></td>
                            <td class="level"><router-link class="type-label-lg" :to="{ path: '/', query: { level: s.path } }">{{ s.level }}</router-link></td>
                            <td><a class="type-label-md link" :href="s.link" target="_blank">Video</a></td>
                            <td class="score"></td>
                        </tr>
                    </table>
                </template>
            </div>
        </main>
    `,
    data: () => ({
        MAIN_LIST_SIZE,
        loading: true,
        board: [],
        profile: null,
        created: [],
    }),
    computed: {
        name() {
            return String(this.$route.params.name ?? '');
        },
        rank() {
            const i = this.board.findIndex((e) => e.user.toLowerCase() === this.name.toLowerCase());
            return i === -1 ? null : i + 1;
        },
        entry() {
            return this.rank ? this.board[this.rank - 1] : null;
        },
    },
    watch: {
        name() {
            this.load();
        },
    },
    mounted() {
        this.load();
    },
    methods: {
        localize,
        async load() {
            this.loading = true;
            const [[board, , list], profiles] = await Promise.all([fetchLeaderboard(), fetchProfiles()]);
            const canonical = makeCanonical(profiles);
            const target = canonical(this.name);
            if (target !== this.name && target.toLowerCase() !== this.name.toLowerCase()) {
                // a confirmed GD name -> show the account it belongs to
                this.$router.replace(playerRoute(target));
                return;
            }
            this.board = board;
            this.profile = profiles[target.toLowerCase()] ?? null;
            this.created = createdBy(list, target, canonical);
            this.loading = false;
        },
    },
};
