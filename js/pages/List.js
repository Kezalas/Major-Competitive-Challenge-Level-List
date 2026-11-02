import { store } from "../main.js";
import { auth } from "../auth.js";
import { embed, hzLabel, podium } from "../util.js";
import { faceFile } from "../faces.js";
import { isLegacy, minPercentFor, score, MAIN_LIST_SIZE, POINT_RANKS, PROGRESS_RANKS } from "../score.js";
import { fetchEditors, fetchList } from "../content.js";

import Spinner from "../components/Spinner.js";
import Flag from "../components/Flag.js";
import PlayerLink from "../components/PlayerLink.js";
import LevelAuthors from "../components/List/LevelAuthors.js";

const roleIconMap = {
    owner: "crown",
    admin: "user-gear",
    helper: "user-shield",
    dev: "code",
    trial: "user-lock",
};

export default {
    components: { Spinner, LevelAuthors, Flag, PlayerLink },
    template: `
        <main v-if="loading">
            <Spinner></Spinner>
        </main>
        <main v-else class="page-list">
            <div class="list-container">
                <div class="list-search">
                    <input v-model.trim="search" type="search" placeholder="Search level, ID, creator…" aria-label="Search level">
                    <p v-if="search" class="type-label-sm muted">{{ visible.length }} result{{ visible.length === 1 ? '' : 's' }}</p>
                </div>
                <p v-if="search && visible.length === 0" class="muted list-search__empty">No level found.</p>
                <table class="list" v-if="list">
                    <template v-for="[[level, err], i] in visible">
                    <tr v-if="i === firstLegacyVisible" class="legacy-divider">
                        <td colspan="2">
                            <div class="legacy-divider__line"><span class="type-label-lg">Legacy</span></div>
                        </td>
                    </tr>
                    <tr :class="{ 'legacy-row': isLegacy(i + 1) }">
                        <td class="rank" :class="podium(i + 1)">
                            <p v-if="!isLegacy(i + 1)" class="type-label-lg">#{{ i + 1 }}</p>
                            <p v-else class="type-label-lg" :title="'#' + (i + 1)">Legacy</p>
                        </td>
                        <td class="level" :class="{ 'active': selected == i, 'error': !level }">
                            <button @click="selected = i">
                                <span class="type-label-lg">{{ level?.name || \`Error (\${err}.json)\` }}</span>
                            </button>
                        </td>
                    </tr>
                    </template>
                </table>
            </div>
            <div class="level-container">
                <div class="level" v-if="level">
                    <p v-if="isLegacy(selected + 1)" class="legacy-banner type-label-lg">Legacy</p>
                    <h1>{{ level.name }}</h1>
                    <LevelAuthors :author="level.author" :creators="level.creators" :verifier="level.verifier"></LevelAuthors>
                    <iframe class="video" id="videoframe" :src="video" frameborder="0"></iframe>
                    <ul class="stats">
                        <li>
                            <div class="type-title-sm">Points when completed</div>
                            <p>{{ score(selected + 1, 100, level.percentToQualify) }}</p>
                        </li>
                        <li>
                            <div class="type-title-sm">ID</div>
                            <p>{{ level.id }}</p>
                        </li>
                        <li>
                            <div class="type-title-sm">Password</div>
                            <p>{{ level.password || 'Free to Copy' }}</p>
                        </li>
                        <li>
                            <div class="type-title-sm">Difficulty</div>
                            <img v-if="face" :src="face" height="96" alt="Difficulty">
                            <p v-else>N/A</p>
                        </li>
                    </ul>
                    <h2>Records</h2>
                    <p v-if="minPercent != null"><strong>{{ minPercent }}%</strong> or better to qualify</p>
                    <p v-else>This level <strong>does not accept</strong> new records.</p>
                    <router-link v-if="!isLegacy(selected + 1) && auth.enabled" class="type-label-lg link submit-link" :to="{ path: '/submit', query: { level: level.path } }">Submit a record for this level</router-link>
                    <table class="records">
                        <tr v-for="record in level.records" class="record">
                            <td class="percent">
                                <p>{{ record.percent }}%</p>
                            </td>
                            <td class="user">
                                <span class="type-label-lg"><PlayerLink :name="record.user"><Flag :code="record.nation"></Flag></PlayerLink></span>
                            </td>
                            <td class="video-link">
                                <a v-if="record.link" :href="record.link" target="_blank" class="type-label-md link">Video</a>
                            </td>
                            <td class="mobile">
                                <img v-if="record.mobile" :src="\`/assets/phone-landscape\${store.dark ? '-dark' : ''}.svg\`" alt="Mobile">
                            </td>
                            <td class="hz">
                                <p>{{ hzLabel(record) }}</p>
                            </td>
                        </tr>
                    </table>
                </div>
                <div v-else class="level" style="height: 100%; justify-content: center; align-items: center;">
                    <p>(ノಠ益ಠ)ノ彡┻━┻</p>
                </div>
            </div>
            <div class="meta-container">
                <div class="meta">
                    <div class="errors" v-show="errors.length > 0">
                        <p class="error" v-for="error of errors">{{ error }}</p>
                    </div>
                    <div class="og">
                        <p class="type-label-md">Website layout made by <a href="https://tsl.pages.dev/" target="_blank">TheShittyList</a></p>
                    </div>
                    <template v-if="editors">
                        <h3>List Editors</h3>
                        <ol class="editors">
                            <li v-for="editor in editors">
                                <img :src="\`/assets/\${roleIconMap[editor.role]}\${store.dark ? '-dark' : ''}.svg\`" :alt="editor.role">
                                <a v-if="editor.link" class="type-label-lg link" target="_blank" :href="editor.link">{{ editor.name }}</a>
                                <p v-else>{{ editor.name }}</p>
                            </li>
                        </ol>
                    </template>
                    <h3>Submission Requirements</h3>
                    <p>
                        Achieved the record without using hacks (however, FPS bypass is allowed, up to 360fps)
                    </p>
                    <p>
                        Achieved the record on the level that is listed on the site. Please check the level ID before you submit a record
                    </p>
                    <p>
                        Have either source audio or clicks/taps in the video. Edited audio only does not count
                    </p>
                    <p>
                        The recording must have a previous attempt and entire death animation shown before the completion, unless the completion is on the first attempt. Everyplay records are exempt from this
                    </p>
                    <p>
                        The recording must also show the player hit the endwall, or the completion will be invalidated.
                    </p>
                    <p>
                        Do not use secret routes or bug routes
                    </p>
                    <p>
                        Do not use easy modes, only a record of the unmodified level qualifies
                    </p>
                    <p>
                        Levels #1 - #{{ PROGRESS_RANKS }} accept progress records from the percentage shown on the level, levels #{{ PROGRESS_RANKS + 1 }} - #{{ MAIN_LIST_SIZE }} only 100%. Only the top {{ POINT_RANKS }} give points
                    </p>
                    <p>
                        Levels below #{{ MAIN_LIST_SIZE }} are on the Legacy List: they are locked and do not accept records anymore
                    </p>
                </div>
            </div>
        </main>
    `,
    data: () => ({
        list: [],
        editors: [],
        loading: true,
        selected: 0,
        search: '',
        errors: [],
        roleIconMap,
        store,
        auth,
        MAIN_LIST_SIZE,
        POINT_RANKS,
        PROGRESS_RANKS,
    }),
    watch: {
        "$route.query.level"(path) {
            this.selectPath(path);
        },
    },
    computed: {
        /** index of the first Legacy level that is currently shown (for the divider) */
        firstLegacyVisible() {
            return this.visible.find(([, i]) => isLegacy(i + 1))?.[1] ?? -1;
        },
        /** [[level, err], index] pairs matching the search (rank numbers stay the same) */
        visible() {
            const all = (this.list ?? []).map((entry, i) => [entry, i]);
            const q = this.search.toLowerCase();
            if (!q) return all;
            return all.filter(([[level], i]) => {
                if (!level) return false;
                const hay = [
                    level.name,
                    String(level.id ?? ''),
                    level.author,
                    level.verifier,
                    ...(level.creators ?? []),
                    '#' + (i + 1),
                ].join(' ').toLowerCase();
                return hay.includes(q);
            });
        },
        minPercent() {
            return minPercentFor(this.selected + 1, this.level?.percentToQualify);
        },
        face() {
            return faceFile(this.level?.rating, this.level?.difficulty);
        },
        level() {
            return this.list?.[this.selected]?.[0] ?? null;
        },
        video() {
            if (!this.level.showcase) {
                return embed(this.level.verification);
            }

            return embed(
                this.toggledShowcase
                    ? this.level.showcase
                    : this.level.verification
            );
        },
    },
    async mounted() {
        // Hide loading spinner
        this.list = await fetchList();
        this.editors = await fetchEditors();

        // Error handling
        if (!this.list) {
            this.errors = [
                "Failed to load list. Retry in a few minutes or notify list staff.",
            ];
        } else {
            this.errors.push(
                ...this.list
                    .filter(([_, err]) => err)
                    .map(([_, err]) => {
                        return `Failed to load level. (${err}.json)`;
                    })
            );
            if (!this.editors) {
                this.errors.push("Failed to load list editors.");
            }
        }

        // /#/?level=<path> opens that level (used by links on player pages)
        this.selectPath(this.$route.query.level);

        this.loading = false;
        if (this.selected > 0) {
            this.$nextTick(() =>
                document.querySelector(".list .level.active")?.scrollIntoView({ block: "center" })
            );
        }
    },
    methods: {
        isLegacy,
        podium,
        selectPath(path) {
            if (!path || !this.list) return;
            const i = this.list.findIndex(([l]) => l?.path === path);
            if (i !== -1) this.selected = i;
        },
        embed,
        score,
        hzLabel,
    },
};
