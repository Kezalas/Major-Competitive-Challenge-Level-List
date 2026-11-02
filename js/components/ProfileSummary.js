import { auth } from '../auth.js';
import { countryName } from '../countries.js';
import { getThumbnailFromId, getYoutubeIdFromUrl, hzLabel, localize, playerRoute, points } from '../util.js';

import Flag from './Flag.js';

/**
 * Banner, name, stats and pinned records of a player.
 * Used full-size on /player/<name> and compact on the leaderboard.
 */
export default {
    components: { Flag },
    props: {
        name: { type: String, required: true },
        entry: { type: Object, default: null },
        rank: { type: Number, default: null },
        profile: { type: Object, default: null },
        compact: { type: Boolean, default: false },
        /** creator credits; defaults to entry.created */
        created: { type: Array, default: null },
    },
    template: `
        <div class="profile-summary" :class="{ 'profile-summary--compact': compact }">
            <div class="player-banner" :class="{ 'player-banner--image': profile?.banner_url && !bannerFailed }" :style="{ background: bannerBackground }">
                <img v-if="profile?.banner_url && !bannerFailed" :src="profile.banner_url" alt="" @error="bannerFailed = true" referrerpolicy="no-referrer">
            </div>

            <div class="player-head">
                <div>
                    <h1 class="player-name">
                        <Flag :code="profile?.nation"></Flag>{{ displayName }}
                    </h1>
                    <p class="type-label-md muted player-sub">
                        <span v-if="profile && profile.role !== 'user'" class="badge badge--staff">{{ profile.role }}</span>
                        <span v-if="profile?.nation">{{ countryName(profile.nation) }}</span>
                        <span v-if="profile?.gd_verified && profile.gd_username" class="gd-name" title="Geometry Dash account (confirmed by staff)">GD: {{ profile.gd_username }}</span>
                        <span v-if="profile">Joined {{ new Date(profile.created_at).toLocaleDateString() }}</span>
                        <span v-else>No account on this site</span>
                    </p>
                </div>
                <router-link v-if="compact" class="btn" :to="playerRoute(displayName)"><span class="type-label-lg">Full profile</span></router-link>
                <router-link v-else-if="isMe" class="btn btn--secondary" to="/account"><span class="type-label-lg">Edit profile</span></router-link>
            </div>
            <p v-if="profile?.bio" class="player-bio" :class="{ 'player-bio--clamp': compact }">{{ profile.bio }}</p>

            <ul class="account-stats player-stats">
                <li><span class="type-title-sm">Rank</span><p>{{ rank ? '#' + rank : 'N/A' }}</p></li>
                <li><span class="type-title-sm">Points</span><p>{{ localize(entry?.total ?? 0) }}</p></li>
                <li><span class="type-title-sm">Completed</span><p>{{ entry?.completed.length ?? 0 }}</p></li>
                <li v-if="entry?.progressed?.length"><span class="type-title-sm">Progressed</span><p>{{ entry.progressed.length }}</p></li>
                <li><span class="type-title-sm">Verified</span><p>{{ entry?.verified.length ?? 0 }}</p></li>
                <li><span class="type-title-sm">Created</span><p>{{ createdCount }}</p></li>
            </ul>

            <div v-if="entry?.packs?.length" class="pack-badges">
                <router-link v-for="p in entry.packs" class="pack-badge" :style="{ '--pack': p.color }" to="/packs" :title="'+' + points(p.points) + ' points'">{{ p.name }} <span class="muted">+{{ points(p.points) }}</span></router-link>
            </div>

            <template v-if="pinned.length">
                <h2>Pinned</h2>
                <div class="pinned-grid">
                    <a v-for="p in pinned" class="pinned-card" :href="p.link" target="_blank">
                        <img v-if="thumb(p.link)" :src="thumb(p.link)" alt="">
                        <div class="pinned-card__body">
                            <span class="type-label-sm muted">#{{ p.rank }} {{ p.kind }}</span>
                            <span class="type-label-lg">{{ p.level }}</span>
                            <span class="type-label-sm muted">{{ ['+' + localize(p.score), p.percent != null ? p.percent + '%' : '', hzLabel(p)].filter(Boolean).join(', ') }}</span>
                        </div>
                    </a>
                </div>
            </template>
        </div>
    `,
    data: () => ({ bannerFailed: false }),
    watch: {
        profile() {
            this.bannerFailed = false;
        },
    },
    computed: {
        createdCount() {
            return (this.created ?? this.entry?.created ?? []).length;
        },
        displayName() {
            return this.profile?.username ?? this.entry?.user ?? this.name;
        },
        isMe() {
            return Boolean(this.profile && auth.profile?.id === this.profile.id);
        },
        bannerBackground() {
            const c = this.profile?.banner_color || '#0043dc';
            return `linear-gradient(135deg, ${c}, #1c1b1f)`;
        },
        pinned() {
            if (!this.entry || !this.profile?.pinned_levels?.length) return [];
            return this.profile.pinned_levels
                .map((path) => {
                    const c = this.entry.completed.find((s) => s.path === path);
                    if (c) return { ...c, kind: 'Completion' };
                    const v = this.entry.verified.find((s) => s.path === path);
                    if (v) return { ...v, kind: 'Verification' };
                    const pr = this.entry.progressed?.find((s) => s.path === path);
                    return pr ? { ...pr, kind: 'Progress' } : null;
                })
                .filter(Boolean);
        },
    },
    methods: {
        localize,
        points,
        hzLabel,
        countryName,
        playerRoute,
        thumb(link) {
            const id = link ? getYoutubeIdFromUrl(link) : '';
            return id ? getThumbnailFromId(id) : '';
        },
    },
};
