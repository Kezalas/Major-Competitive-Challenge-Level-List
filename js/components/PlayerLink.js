import { playerRoute } from '../util.js';

/** A player's name, linking to their public profile page. */
export default {
    props: { name: { type: String, required: true } },
    template: `<router-link class="player-link" :to="playerRoute(name)"><slot></slot>{{ name }}</router-link>`,
    methods: { playerRoute },
};
