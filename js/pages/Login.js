import { auth, authReady, loadProfile, siteUrl } from '../auth.js';
import { getSupabase, friendlyError } from '../supabase.js';

const USERNAME_RE = /^[A-Za-z0-9_.-]{3,24}$/;

export default {
    template: `
        <main class="page-form">
            <div class="form-card">
                <div class="tabs">
                    <button class="tab" :class="{ selected: mode === 'login' }" @click="setMode('login')"><span class="type-label-lg">Log in</span></button>
                    <button class="tab" :class="{ selected: mode === 'register' }" @click="setMode('register')"><span class="type-label-lg">Create account</span></button>
                </div>

                <p v-if="!auth.enabled" class="form-error">
                    Accounts are not set up yet (missing Supabase config).
                </p>
                <p v-if="auth.notice" class="form-info">{{ auth.notice }}</p>
                <p v-if="error" class="form-error">{{ error }}</p>
                <p v-if="info" class="form-success">{{ info }}</p>

                <!-- Log in -->
                <form v-if="mode === 'login'" class="form" @submit.prevent="login">
                    <h1>Log in</h1>
                    <label class="field">
                        <span class="type-label-lg">Email</span>
                        <input v-model.trim="email" type="email" autocomplete="email" required>
                    </label>
                    <label class="field">
                        <span class="type-label-lg">Password</span>
                        <input v-model="password" type="password" autocomplete="current-password" required>
                    </label>
                    <button class="btn" type="submit" :disabled="busy || !auth.enabled">
                        <span class="type-label-lg">{{ busy ? 'Logging in…' : 'Log in' }}</span>
                    </button>
                    <button type="button" class="link-btn" @click="setMode('forgot')"><span class="type-label-md">Forgot password?</span></button>
                </form>

                <!-- Register -->
                <form v-else-if="mode === 'register'" class="form" @submit.prevent="register">
                    <h1>Create account</h1>
                    <label class="field">
                        <span class="type-label-lg">Username</span>
                        <input v-model.trim="username" type="text" autocomplete="username" maxlength="24" required placeholder="Your in-game name">
                        <span class="hint">3 - 24 characters: letters, numbers, _ . and -. This name appears on the list.</span>
                    </label>
                    <label class="field">
                        <span class="type-label-lg">Email</span>
                        <input v-model.trim="email" type="email" autocomplete="email" required>
                        <span class="hint">Only used for logging in. Never shown publicly.</span>
                    </label>
                    <label class="field">
                        <span class="type-label-lg">Password</span>
                        <input v-model="password" type="password" autocomplete="new-password" minlength="6" required>
                    </label>
                    <label class="field">
                        <span class="type-label-lg">Repeat password</span>
                        <input v-model="password2" type="password" autocomplete="new-password" minlength="6" required>
                    </label>
                    <button class="btn" type="submit" :disabled="busy || !auth.enabled">
                        <span class="type-label-lg">{{ busy ? 'Creating…' : 'Create account' }}</span>
                    </button>
                </form>

                <!-- Forgot password -->
                <form v-else class="form" @submit.prevent="forgot">
                    <h1>Reset password</h1>
                    <label class="field">
                        <span class="type-label-lg">Email</span>
                        <input v-model.trim="email" type="email" autocomplete="email" required>
                    </label>
                    <button class="btn" type="submit" :disabled="busy || !auth.enabled">
                        <span class="type-label-lg">Send reset link</span>
                    </button>
                    <button type="button" class="link-btn" @click="setMode('login')"><span class="type-label-md">Back to log in</span></button>
                </form>
            </div>
        </main>
    `,
    data: () => ({
        auth,
        mode: 'login',
        email: '',
        password: '',
        password2: '',
        username: '',
        busy: false,
        error: '',
        info: '',
    }),
    async mounted() {
        if (this.$route.query.mode === 'register') this.mode = 'register';
        await authReady();
        if (auth.user) this.done();
    },
    methods: {
        setMode(mode) {
            this.mode = mode;
            this.error = '';
            this.info = '';
        },
        done() {
            const target = this.$route.query.redirect;
            this.$router.replace(
                typeof target === 'string' && target.startsWith('/')
                    ? target
                    : '/account',
            );
        },
        async login() {
            this.busy = true;
            this.error = '';
            auth.notice = '';
            try {
                const sb = await getSupabase();
                const { data, error } = await sb.auth.signInWithPassword({
                    email: this.email,
                    password: this.password,
                });
                if (error) throw error;
                auth.session = data.session;
                await loadProfile();
                this.done();
            } catch (e) {
                this.error = friendlyError(e);
            } finally {
                this.busy = false;
            }
        },
        async register() {
            this.error = '';
            this.info = '';
            if (!USERNAME_RE.test(this.username)) {
                this.error = 'Usernames need 3 - 24 characters: letters, numbers, _ . and -';
                return;
            }
            if (this.password !== this.password2) {
                this.error = 'The passwords do not match.';
                return;
            }
            this.busy = true;
            try {
                const sb = await getSupabase();

                // Username free? (case-insensitive; escape LIKE wildcards)
                const pattern = this.username.replace(/[\\%_]/g, (c) => '\\' + c);
                const { data: taken, error: takenError } = await sb
                    .from('profiles')
                    .select('id')
                    .ilike('username', pattern)
                    .limit(1);
                if (takenError) throw takenError;
                if (taken.length > 0) {
                    this.error = 'This username is already taken.';
                    return;
                }

                const { data, error } = await sb.auth.signUp({
                    email: this.email,
                    password: this.password,
                    options: {
                        data: { username: this.username },
                        emailRedirectTo: siteUrl(),
                    },
                });
                if (error) throw error;

                if (data.session) {
                    // "Confirm email" is turned off in Supabase -> logged in right away
                    auth.session = data.session;
                    await loadProfile();
                    this.done();
                } else {
                    this.info =
                        'Account created! We sent you an email. Click the link in it to confirm your account, then log in here. (Check your spam folder.)';
                    this.mode = 'login';
                    this.password = '';
                    this.password2 = '';
                }
            } catch (e) {
                this.error = friendlyError(e);
            } finally {
                this.busy = false;
            }
        },
        async forgot() {
            this.busy = true;
            this.error = '';
            this.info = '';
            try {
                const sb = await getSupabase();
                const { error } = await sb.auth.resetPasswordForEmail(
                    this.email,
                    { redirectTo: siteUrl() },
                );
                if (error) throw error;
                this.info =
                    'If an account with this email exists, a reset link is on its way. Open it in this browser.';
            } catch (e) {
                this.error = friendlyError(e);
            } finally {
                this.busy = false;
            }
        },
    },
};
