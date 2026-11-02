import List from './pages/List.js';
import Leaderboard from './pages/Leaderboard.js';
import Roulette from './pages/Roulette.js';
import Login from './pages/Login.js';
import Account from './pages/Account.js';
import Submit from './pages/Submit.js';
import Staff from './pages/Staff.js';
import Packs from './pages/Packs.js';
import Tournaments from './pages/Tournaments.js';
import Player from './pages/Player.js';

export default [
    { path: '/', component: List },
    { path: '/leaderboard', component: Leaderboard },
    { path: '/roulette', component: Roulette },
    { path: '/login', component: Login },
    { path: '/account', component: Account, meta: { auth: true } },
    { path: '/submit', component: Submit, meta: { auth: true } },
    { path: '/staff', component: Staff, meta: { staff: true } },
    { path: '/review', redirect: '/staff' },
    { path: '/packs', component: Packs },
    { path: '/tournaments', component: Tournaments },
    { path: '/player/:name', component: Player },
];
