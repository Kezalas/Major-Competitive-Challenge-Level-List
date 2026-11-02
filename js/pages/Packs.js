import { auth } from '../auth.js';
import { fetchLeaderboard, fetchPacks, resolvePacks } from '../content.js';
import { isConfigured } from '../supabase.js';
import { localize, points } from '../util.js';

import Spinner from '../components/Spinner.js';

/** All packs with their levels and bonus points. */
export default {
    components: { Spinner },
    template: `
        <main v-if="loading">
            <Spinner></Spinner>
        </main>
        <main v-else class="page-packs">
            <div class="packs-page">
                <h1>Packs</h1>
                <p class="muted">Beat every level of a pack to earn its bonus points.</p>
                <p v-if="!packs.length" class="muted">{{ configured ? 'No packs yet.' : 'Packs need the Supabase setup.' }}</p>
                <div class="packs-grid">
                    <section v-for="pack in packs" class="pack-card" :class="{ 'pack-card--done': isDone(pack) }" :style="{ '--pack': pack.color }">
                        <div class="pack-card__head">
                            <h2 class="pack-card__name" :title="pack.name">{{ pack.name }}</h2>
                            <span class="pack-card__points type-label-lg">+{{ points(pack.points) }}</span>
                        </div>
                        <p v-if="pack.description" class="pack-card__desc muted">{{ pack.description }}</p>
                        <ol class="pack-levels">
                            <li v-for="l in pack.levels" :class="{ done: myPaths.has(l.path) }">
                                <span class="pack-levels__rank type-label-md">#{{ l.rank }}</span>
                                <router-link class="type-label-lg" :to="{ path: '/', query: { level: l.path } }">{{ l.name }}</router-link>
                                <span v-if="myPaths.has(l.path)" class="pack-levels__check" title="You beat this level">✓</span>
                            </li>
                        </ol>
                        <p v-if="isDone(pack)" class="pack-card__status pack-card__status--done type-label-lg">
                            Completed (+{{ points(pack.points) }} points earned)
                        </p>
                        <p v-else-if="me" class="pack-card__status type-label-md muted">
                            {{ doneCount(pack) }}/{{ pack.levels.length }} beaten
                        </p>
                    </section>
                </div>
            </div>
        </main>
    `,
    data: () => ({ loading: true, packs: [], board: [], configured: isConfigured, auth }),
    computed: {
        /** leaderboard entry of the logged-in player */
        me() {
            const name = auth.profile?.username?.toLowerCase();
            return name ? this.board.find((e) => e.user.toLowerCase() === name) ?? null : null;
        },
        myPaths() {
            return new Set(this.me ? [...this.me.completed, ...this.me.verified].map((s) => s.path) : []);
        },
    },
    async mounted() {
        const [packs, [board, , list]] = await Promise.all([fetchPacks(), fetchLeaderboard()]);
        this.board = board;
        this.packs = resolvePacks(packs, list, board);
        this.loading = false;
        await this.$nextTick();
        // fonts load late and the window can be resized -> measure again
        this.fitNames();
        document.fonts?.ready.then(() => this.fitNames());
        this.onResize = () => this.fitNames();
        window.addEventListener('resize', this.onResize);
    },
    unmounted() {
        window.removeEventListener('resize', this.onResize);
    },
    methods: {
        localize,
        points,
        /**
         * Shrink each pack name until it fits on one line
         * (measured, so it works for any name and card width).
         */
        fitNames() {
            for (const el of this.$el.querySelectorAll?.('.pack-card__name') ?? []) {
                let size = 1.6;
                el.style.fontSize = size + 'rem';
                while (el.scrollWidth > el.clientWidth + 1 && size > 0.8) {
                    size = Math.round((size - 0.05) * 100) / 100;
                    el.style.fontSize = size + 'rem';
                }
            }
        },
        isDone(pack) {
            return Boolean(this.me && pack.completedBy.includes(this.me));
        },
        doneCount(pack) {
            return pack.levels.filter((l) => this.myPaths.has(l.path)).length;
        },
    },
};
