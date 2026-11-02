import { countryName } from '../countries.js';

/** Small country flag (images from flagcdn.com, emoji flags don't render on Windows). */
export default {
    props: { code: { type: String, default: '' } },
    template: `
        <img
            v-if="code"
            class="flag"
            :src="'https://flagcdn.com/w40/' + code.toLowerCase() + '.png'"
            :alt="code"
            :title="countryName(code)"
            loading="lazy"
        >
    `,
    methods: { countryName },
};
