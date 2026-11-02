import routes from './routes.js';
import { auth, authReady, initAuth } from './auth.js';
import { GOOGLE_FORM_URL } from './config.js';

function readDark() {
    try {
        const v = JSON.parse(localStorage.getItem('dark'));
        return v === null ? true : Boolean(v);
    } catch {
        return true;
    }
}

export const store = Vue.reactive({
    // dark is the default look; the button switches to the light theme
    dark: readDark(),
    toggleDark() {
        this.dark = !this.dark;
        try {
            localStorage.setItem('dark', JSON.stringify(this.dark));
        } catch {
            /* storage blocked */
        }
    },
});

const app = Vue.createApp({
    data: () => ({ store, auth, GOOGLE_FORM_URL }),
});
const router = VueRouter.createRouter({
    history: VueRouter.createWebHashHistory(),
    routes,
});

// Pages that need an account (meta.auth) or staff rights (meta.staff)
router.beforeEach(async (to) => {
    if (!to.meta.auth && !to.meta.staff) return true;
    await authReady();
    if (!auth.enabled) return '/';
    if (!auth.user) return { path: '/login', query: { redirect: to.fullPath } };
    if (to.meta.staff && !auth.isStaff) return '/account';
    return true;
});

app.use(router);

app.mount('#app');

initAuth(router);
