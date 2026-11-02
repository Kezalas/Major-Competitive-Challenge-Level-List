import { REGIONS, fetchTournaments, regionName } from '../content.js';
import { isConfigured } from '../supabase.js';
import { CONTINENT_PATHS, MAP_HEIGHT, MAP_WIDTH } from '../worldmap.js';

import Spinner from '../components/Spinner.js';
import PlayerLink from '../components/PlayerLink.js';

/** Where the marker (number of upcoming tournaments + name) sits on the map. */
const MARKERS = {
    north_america: { x: 215, y: 165 },
    south_america: { x: 335, y: 335 },
    europe: { x: 520, y: 118 },
    africa: { x: 548, y: 285 },
    asia: { x: 735, y: 175 },
    oceania: { x: 868, y: 392 },
};

const CONTINENTS = REGIONS.filter((r) => r.key !== 'world').map((r) => ({
    ...r,
    path: CONTINENT_PATHS[r.key],
    marker: MARKERS[r.key],
}));

const pad = (n) => String(n).padStart(2, '0');

/** World map with upcoming tournaments per continent, history per continent, World Tournament countdown. */
export default {
    components: { Spinner, PlayerLink },
    template: `
        <main v-if="loading">
            <Spinner></Spinner>
        </main>
        <main v-else class="page-tournaments">
            <div class="tournaments-page">
                <section class="tourney-hero">
                    <p class="tourney-hero__label type-label-lg">World Tournament Countdown</p>
                    <template v-if="nextWorld">
                        <div class="countdown" role="timer" :aria-label="'Starts in ' + countdown.d + ' days ' + countdown.h + ' hours ' + countdown.m + ' minutes'">
                            <div class="countdown__part"><span class="countdown__num">{{ countdown.d }}</span><span class="countdown__unit">Days</span></div>
                            <div class="countdown__part"><span class="countdown__num">{{ countdown.h }}</span><span class="countdown__unit">Hours</span></div>
                            <div class="countdown__part"><span class="countdown__num">{{ countdown.m }}</span><span class="countdown__unit">Minutes</span></div>
                            <div class="countdown__part"><span class="countdown__num">{{ countdown.s }}</span><span class="countdown__unit">Seconds</span></div>
                        </div>
                        <h2 class="tourney-hero__name">{{ nextWorld.name }}</h2>
                        <p class="tourney-hero__meta type-label-md">
                            <span>{{ fmtDate(nextWorld.starts_at, true) }}</span>
                            <span>{{ nextWorld.size }} players</span>
                            <a v-if="nextWorld.link" class="link" :href="nextWorld.link" target="_blank">Details</a>
                        </p>
                    </template>
                    <p v-else class="tourney-hero__empty">No World Tournament scheduled yet. Stay tuned!</p>
                </section>

                <section class="tourney-map-card">
                    <div class="region-chips" role="tablist" aria-label="Region">
                        <button class="region-chip" :class="{ selected: !region }" @click="select(null)"><span class="type-label-md">All upcoming</span></button>
                        <button v-for="r in REGIONS" class="region-chip" :class="{ selected: region === r.key }" @click="select(r.key)">
                            <span class="type-label-md">{{ r.name }}</span>
                            <span v-if="upcomingCount(r.key)" class="region-chip__count">{{ upcomingCount(r.key) }}</span>
                        </button>
                    </div>
                    <svg class="world-map" :viewBox="'0 0 ' + MAP_WIDTH + ' ' + MAP_HEIGHT" role="img" aria-label="World map, click a continent">
                        <g v-for="c in CONTINENTS" class="continent"
                           :class="{ 'continent--selected': region === c.key, 'continent--active': upcomingCount(c.key) > 0, 'continent--dim': region && region !== c.key }"
                           @click="select(region === c.key ? null : c.key)">
                            <title>{{ c.name }}: {{ upcomingCount(c.key) }} upcoming</title>
                            <path :d="c.path"></path>
                        </g>
                        <g v-for="c in CONTINENTS" class="map-marker" :class="{ 'map-marker--selected': region === c.key }"
                           :transform="'translate(' + c.marker.x + ' ' + c.marker.y + ')'" @click="select(region === c.key ? null : c.key)">
                            <rect class="map-marker__bg" :x="-labelWidth(c) / 2" y="-15" :width="labelWidth(c)" height="30" rx="15"></rect>
                            <text class="map-marker__text" text-anchor="middle" y="5">{{ c.name }}<tspan v-if="upcomingCount(c.key)" class="map-marker__count" dx="6">{{ upcomingCount(c.key) }}</tspan></text>
                        </g>
                    </svg>
                    <p class="muted type-label-sm tourney-map-hint">Click a continent to see its upcoming tournaments and its history. Times are shown in your local time.</p>
                </section>

                <p v-if="!configured" class="muted">Tournaments need the Supabase setup.</p>

                <section class="tourney-region">
                    <div class="tourney-region__head">
                        <h2>{{ region ? regionName(region) : 'Upcoming tournaments' }}</h2>
                        <button v-if="region" class="link-btn" @click="select(null)"><span class="type-label-md">Show all regions</span></button>
                    </div>

                    <h3 v-if="region">Upcoming</h3>
                    <p v-if="!shownUpcoming.length" class="muted">No tournaments planned{{ region ? ' in ' + regionName(region) : '' }} right now.</p>
                    <ul v-else class="tourney-list">
                        <li v-for="t in shownUpcoming" class="tourney-item" :class="{ 'tourney-item--world': t.region === 'world' }">
                            <div class="tourney-date">
                                <span class="tourney-date__day">{{ day(t.starts_at) }}</span>
                                <span class="tourney-date__month">{{ month(t.starts_at) }}</span>
                            </div>
                            <div class="tourney-item__body">
                                <span class="type-label-lg tourney-item__name">{{ t.name }}</span>
                                <span class="type-label-sm muted tourney-item__meta">
                                    <button v-if="!region" class="region-tag" @click="select(t.region)">{{ regionName(t.region) }}</button>
                                    <span>{{ fmtDate(t.starts_at, true) }}</span>
                                    <span>{{ t.size }} players</span>
                                    <a v-if="t.link" class="link" :href="t.link" target="_blank">Details</a>
                                </span>
                            </div>
                            <span class="tourney-item__in type-label-md">in {{ startsIn(t) }}</span>
                        </li>
                    </ul>

                    <template v-if="region">
                        <h3>History</h3>
                        <p v-if="!history.length" class="muted">No tournaments in {{ regionName(region) }} yet.</p>
                        <ul v-else class="tourney-list">
                            <li v-for="t in history" class="tourney-item tourney-item--past">
                                <div class="tourney-date">
                                    <span class="tourney-date__day">{{ day(t.starts_at) }}</span>
                                    <span class="tourney-date__month">{{ month(t.starts_at) }} {{ year(t.starts_at) }}</span>
                                </div>
                                <div class="tourney-item__body">
                                    <span class="type-label-lg tourney-item__name">{{ t.name }}</span>
                                    <span class="type-label-sm muted tourney-item__meta">
                                        <span>{{ t.size }} players</span>
                                        <a v-if="t.link" class="link" :href="t.link" target="_blank">Details</a>
                                    </span>
                                </div>
                                <span v-if="t.winner" class="tourney-item__winner type-label-md">Winner <PlayerLink :name="t.winner"></PlayerLink></span>
                            </li>
                        </ul>
                    </template>
                </section>
            </div>
        </main>
    `,
    data: () => ({
        loading: true,
        configured: isConfigured,
        tournaments: [],
        now: Date.now(),
        timer: null,
        REGIONS,
        CONTINENTS,
        MAP_WIDTH,
        MAP_HEIGHT,
    }),
    computed: {
        region() {
            const r = this.$route.query.region;
            return REGIONS.some((x) => x.key === r) ? r : null;
        },
        upcoming() {
            return this.tournaments.filter((t) => this.time(t) > this.now);
        },
        nextWorld() {
            return this.upcoming.find((t) => t.region === 'world') ?? null;
        },
        shownUpcoming() {
            return this.region ? this.upcoming.filter((t) => t.region === this.region) : this.upcoming;
        },
        /** past tournaments of the selected region, newest first */
        history() {
            return this.tournaments
                .filter((t) => t.region === this.region && this.time(t) <= this.now)
                .reverse();
        },
        countdown() {
            const ms = Math.max(0, this.time(this.nextWorld) - this.now);
            const s = Math.floor(ms / 1000);
            return {
                d: pad(Math.floor(s / 86400)),
                h: pad(Math.floor((s % 86400) / 3600)),
                m: pad(Math.floor((s % 3600) / 60)),
                s: pad(s % 60),
            };
        },
    },
    async mounted() {
        this.tournaments = (await fetchTournaments()).sort((a, b) => this.time(a) - this.time(b));
        this.loading = false;
        this.timer = setInterval(() => (this.now = Date.now()), 1000);
    },
    unmounted() {
        clearInterval(this.timer);
    },
    methods: {
        regionName,
        time(t) {
            return t ? new Date(t.starts_at).getTime() : 0;
        },
        select(key) {
            this.$router.replace({ query: key ? { region: key } : {} });
        },
        upcomingCount(key) {
            return this.upcoming.filter((t) => t.region === key).length;
        },
        labelWidth(c) {
            const n = this.upcomingCount(c.key);
            return c.name.length * 8.6 + (n ? String(n).length * 9 + 14 : 0) + 26;
        },
        fmtDate(iso, withTime) {
            return new Date(iso).toLocaleString(undefined, {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                year: 'numeric',
                ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
            });
        },
        day(iso) {
            return new Date(iso).getDate();
        },
        month(iso) {
            return new Date(iso).toLocaleString(undefined, { month: 'short' });
        },
        year(iso) {
            return new Date(iso).getFullYear();
        },
        startsIn(t) {
            const ms = this.time(t) - this.now;
            const d = Math.floor(ms / 86400000);
            const h = Math.floor((ms % 86400000) / 3600000);
            const m = Math.floor((ms % 3600000) / 60000);
            if (d > 0) return `${d}d ${h}h`;
            if (h > 0) return `${h}h ${m}m`;
            return `${Math.max(m, 1)}m`;
        },
    },
};
