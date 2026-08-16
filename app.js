// Short Circuit — the shell around the circuit-lock engine.
//
// The engine (engine.js) is lifted intact from Manny the Mole; this file
// is the game around it: screens, storage, the daily lock and its streak,
// the 24-lock campaign with medals, and the DOM renderer for the board.
// Everything platform-shaped (CrazyGames SDK, GameVolt SDK) is guarded so
// the same file runs identically from a bare file:// open.

const SC_KEYS = Object.freeze({
    bests: 'short-circuit:bests',
    daily: 'short-circuit:daily',
    seen: 'short-circuit:lock-seen',
    stats: 'short-circuit:stats',
    trophies: 'short-circuit:trophies',
});

// Every counter the box keeps. Merged over whatever is stored, so a
// player from an older version starts new meters at zero, not NaN.
const SC_STAT_ZEROES = Object.freeze({
    solves: 0,          // locks solved, campaign and daily alike
    dailySolves: 0,
    attempts: 0,        // circuits started
    resets: 0,          // restart presses
    taps: 0,            // conductor presses
    swaps: 0,           // swaps banked from solved locks
    seconds: 0,         // total time spent on the puzzle screen
    fastest: 0,
    totalSolveSeconds: 0,
    duels: 0,           // live duels finished
    duelWins: 0,
    duelRounds: 0,      // duel rounds played
    duelRoundWins: 0,
    slams: 0,           // breaker slams
    misfires: 0,        // slams on a broken circuit
});

// GameVolt house standard: 31 trophies — 15 bronze, 10 silver, 5 gold
// and one platinum that unlocks itself when every other is earned.
// `when` reads a snapshot: st = stats, standing = campaign medals/locks,
// daily = streak info, ctx = facts about the solve that just happened.
const SC_TROPHIES = [
    // bronze (15)
    { id: 'first-spark', tier: 'bronze', name: 'FIRST SPARK', desc: 'Close your first circuit', when: s => s.st.solves >= 1 },
    { id: 'three-open', tier: 'bronze', name: 'THREE OPEN', desc: 'Open three campaign locks', when: s => s.standing.solvedLocks >= 3 },
    { id: 'six-open', tier: 'bronze', name: 'SIX OPEN', desc: 'Open six campaign locks', when: s => s.standing.solvedLocks >= 6 },
    { id: 'day-one', tier: 'bronze', name: 'DAY ONE', desc: 'Solve a daily lock', when: s => s.st.dailySolves >= 1 },
    { id: 'three-days', tier: 'bronze', name: 'THREE DAYS LIVE', desc: 'Reach a 3-day daily streak', when: s => s.daily.bestStreak >= 3 },
    { id: 'podium', tier: 'bronze', name: 'ON THE PODIUM', desc: 'Earn any medal time', when: s => s.medalTotal >= 1 },
    { id: 'medal-drawer', tier: 'bronze', name: 'MEDAL DRAWER', desc: 'Earn five medal times', when: s => s.medalTotal >= 5 },
    { id: 'busy-fingers', tier: 'bronze', name: 'BUSY FINGERS', desc: 'Press 100 conductors', when: s => s.st.taps >= 100 },
    { id: 'switchboard', tier: 'bronze', name: 'SWITCHBOARD', desc: 'Bank 50 swaps', when: s => s.st.swaps >= 50 },
    { id: 'through-gold', tier: 'bronze', name: 'ROUTED THROUGH GOLD', desc: 'Beat a lock with welded conductors', when: s => s.ctx.won && s.ctx.anchors > 0 },
    { id: 'big-board', tier: 'bronze', name: 'THE BIG BOARD', desc: 'Solve a 6×6 circuit', when: s => s.ctx.won && s.ctx.size >= 6 },
    { id: 'worn-open', tier: 'bronze', name: 'WORN BUT OPEN', desc: 'Win a lock after a restart', when: s => s.ctx.won && s.ctx.resets > 0 },
    { id: 'hands-on-keys', tier: 'bronze', name: 'HANDS ON KEYS', desc: 'Solve a lock on the keyboard', when: s => s.ctx.won && s.ctx.viaKeyboard },
    { id: 'schooled', tier: 'bronze', name: 'SCHOOLED', desc: 'Finish the teaching circuit', when: s => s.ctx.won && s.ctx.teaching },
    { id: 'shift-worker', tier: 'bronze', name: 'SHIFT WORKER', desc: '15 minutes in the box', when: s => s.st.seconds >= 900 },
    // silver (10)
    { id: 'halfway-in', tier: 'silver', name: 'HALFWAY IN', desc: 'Open twelve campaign locks', when: s => s.standing.solvedLocks >= 12 },
    { id: 'deep-panels', tier: 'silver', name: 'DEEP PANELS', desc: 'Open eighteen campaign locks', when: s => s.standing.solvedLocks >= 18 },
    { id: 'week-live', tier: 'silver', name: 'ONE WEEK LIVE', desc: 'Reach a 7-day daily streak', when: s => s.daily.bestStreak >= 7 },
    { id: 'golden-touch', tier: 'silver', name: 'GOLDEN TOUCH', desc: 'Earn a gold medal time', when: s => s.standing.medals.gold >= 1 },
    { id: 'shinework', tier: 'silver', name: 'SHINEWORK', desc: 'Five silver-or-better medals', when: s => s.standing.medals.gold + s.standing.medals.silver >= 5 },
    { id: 'ten-flat', tier: 'silver', name: 'TEN FLAT', desc: 'Solve a lock in under 10 seconds', when: s => s.st.fastest > 0 && s.st.fastest < 10 },
    { id: 'first-blood', tier: 'silver', name: 'FIRST BLOOD', desc: 'Win a live duel', when: s => s.st.duelWins >= 1 },
    { id: 'trigger-finger', tier: 'silver', name: 'TRIGGER FINGER', desc: 'Slam the breaker 25 times', when: s => s.st.slams >= 25 },
    { id: 'regular', tier: 'silver', name: 'REGULAR', desc: 'Solve ten daily locks', when: s => s.st.dailySolves >= 10 },
    { id: 'long-shift', tier: 'silver', name: 'THE LONG SHIFT', desc: 'An hour in the box', when: s => s.st.seconds >= 3600 },
    // gold (5)
    { id: 'all-panels', tier: 'gold', name: 'ALL PANELS OPEN', desc: 'Clear all 24 campaign locks', when: s => s.standing.solvedLocks >= 24 },
    { id: 'gilded-dozen', tier: 'gold', name: 'GILDED DOZEN', desc: 'Twelve gold medal times', when: s => s.standing.medals.gold >= 12 },
    { id: 'month-live', tier: 'gold', name: 'A MONTH LIVE', desc: 'Reach a 30-day daily streak', when: s => s.daily.bestStreak >= 30 },
    { id: 'duelist', tier: 'gold', name: 'DUELIST', desc: 'Win ten live duels', when: s => s.st.duelWins >= 10 },
    { id: 'five-flat', tier: 'gold', name: 'FIVE FLAT', desc: 'Solve a lock in under 5 seconds', when: s => s.st.fastest > 0 && s.st.fastest < 5 },
    // platinum (1)
    { id: 'master', tier: 'platinum', name: 'MASTER ELECTRICIAN', desc: 'Unlock every other trophy', when: () => false },
];

const SC_TIER_ORDER = ['bronze', 'silver', 'gold', 'platinum'];
const SC_TIER_META = {
    bronze: { label: 'BRONZE', color: '#cd7f32' },
    silver: { label: 'SILVER', color: '#c9d3e0' },
    gold: { label: 'GOLD', color: '#ffd23f' },
    platinum: { label: 'PLATINUM', color: '#7df9ff' },
};

// All saves go through one door. On CrazyGames that door is the SDK's
// data module — a localStorage-shaped store that follows the player's
// CrazyGames account across devices (plain localStorage everywhere else,
// and the module itself falls back to local when the player is logged
// out). The SDK is initialised before the game constructs, so the
// backend is stable by first read.
const scStore = {
    backend() {
        return cgSdk()?.data ?? null;
    },
    get(key) {
        try {
            const cloud = this.backend();
            return cloud ? cloud.getItem(key) : localStorage.getItem(key);
        } catch { return null; }
    },
    set(key, value) {
        try {
            const cloud = this.backend();
            if (cloud) { cloud.setItem(key, value); return; }
        } catch { /* fall through to local */ }
        try { localStorage.setItem(key, value); } catch { /* still playable */ }
    },
};

// A throw inside one action must not stop the next press from being
// heard, so dispatch and the frame loop are fenced and failures kept.
const scFaults = [];
function scFault(where, err) {
    scFaults.push(`${where}: ${err?.message ?? err}`);
    if (scFaults.length > 12) scFaults.shift();
    console.warn('[short-circuit] fault in', where, err);
}
window.scFaults = () => [...scFaults];

function cgSdk() {
    return window.CrazyGames?.SDK ?? null;
}

class ShortCircuit {
    constructor() {
        this.engine = new SafePuzzleEngine();
        this.sound = new CircuitSound();
        this.screen = 'title';
        this.bests = this.loadJson(SC_KEYS.bests);
        this.daily = this.loadJson(SC_KEYS.daily);
        this.stats = Object.assign({}, SC_STAT_ZEROES,
            this.loadJson(SC_KEYS.stats));
        this.usesKeyboard = false;
        this.focusBoardOnRender = false;
        this.duel = null;               // live-duel state while in Versus
        this.duelHudText = '';
        this.trophies = this.loadJson(SC_KEYS.trophies);
        this.lastAdAt = performance.now();   // ingen annons direkt vid boot
        this.solvesSinceAd = 0;
        this.trophyQueue = [];
        this.trophyShowing = false;
        this.lockResets = 0;            // restarts on the current board
        this.lastResult = null;
        this.activeDaily = null;         // dateKey while a daily is live
        this.renderedRevision = -1;
        this.pipeCells = [];
        this.weldRefusalRendered = undefined;
        this.lastRefusalTone = undefined;
        this.reducedMotion = window.matchMedia?.(
            '(prefers-reduced-motion: reduce)'
        )?.matches === true;

        this.dom = Object.fromEntries([
            'screenTitle', 'screenSelect', 'screenPuzzle', 'screenWon',
            'screenStats', 'statsBody',
            'screenVersus', 'versusCode', 'versusJoinInput', 'versusStatus',
            'versusInvite',
            'versusHud', 'versusScore', 'versusRival',
            'titleFirst', 'titleDaily', 'trophyCount', 'trophyBody',
            'screenTrophies',
            'titleDailyNote', 'muteButton', 'dailyRow', 'campaignRows',
            'puzzleEyebrow', 'puzzleDifficulty', 'puzzleTitle', 'puzzleCopy',
            'puzzleBody', 'puzzleStatus', 'puzzleActions',
            'puzzleWonEyebrow', 'puzzleWonTitle', 'puzzleWonBest',
            'puzzleWonTime', 'puzzleWonStats', 'puzzleWonActions',
        ].map(id => [id, document.getElementById(id)]));

        document.addEventListener('click', event => {
            const button = event.target.closest?.('[data-action]');
            if (!button || button.disabled) return;
            try {
                this.dispatch(button);
            } catch (err) {
                scFault('action:' + button.dataset.action, err);
            }
        });
        document.addEventListener('keydown', event => {
            try {
                this.handleKey(event);
            } catch (err) {
                scFault('key:' + event.key, err);
            }
        });

        this.dom.versusJoinInput?.addEventListener('input', () => {
            const el = this.dom.versusJoinInput;
            el.value = el.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        });

        this.syncMute();
        this.syncTitleNote();
        // The platform's own mute sits on top of the user's: the site
        // button silences the game without touching the saved preference.
        const cgGame = cgSdk()?.game;
        if (cgGame?.settings) {
            const applyPlatform = settings => {
                this.sound.platformMuted = settings?.muteAudio === true;
            };
            try {
                applyPlatform(cgGame.settings);
                cgGame.addSettingsChangeListener?.(applyPlatform);
            } catch { /* platform optional, always */ }
        }
        this.gameVoltInit();
        this.checkTrophies({}, { silent: true });
        this.initNet();
        this.cgMultiplayerInit();
        this.initBackdrop();

        this.lastFrame = performance.now();
        const loop = now => {
            const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
            this.lastFrame = now;
            try {
                this.update(dt);
                this.drawBackdrop(dt);
            } catch (err) {
                scFault('frame:' + this.screen, err);
            }
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }

    /**
     * A one-shot full-screen effect: the surge of a solved circuit, the
     * brown-out of a blown one. Re-adding the class mid-run restarts it.
     */
    fx(name) {
        const overlay = document.getElementById('fxOverlay');
        if (!overlay) return;
        overlay.classList.remove('is-surge', 'is-brownout');
        void overlay.offsetWidth;
        overlay.classList.add(name);
        clearTimeout(this.fxTimer);
        this.fxTimer = setTimeout(
            () => overlay.classList.remove('is-surge', 'is-brownout'),
            900
        );
    }

    // ── keyboard play ──

    /**
     * Arrows walk the board or the menu, Enter and Space press whatever
     * holds focus, R restarts the lock, Escape backs out. Focus only
     * starts moving once a key is actually used, so touch players never
     * see a stray focus ring.
     */
    handleKey(event) {
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        const key = event.key;

        if (key === 'Escape') {
            // Mid-duel, Escape must never forfeit by accident — the
            // Forfeit button is a deliberate press.
            if (this.duel?.started) return;
            if (this.screen === 'puzzle') this.leavePuzzle();
            else if (this.screen === 'select') this.showTitle();
            else if (this.screen === 'stats') this.showTitle();
            else if (this.screen === 'trophies') this.showTitle();
            else if (this.screen === 'versus') {
                window.SCNet?.leave();
                this.cgLeftRoom();
                this.duel = null;
                this.showTitle();
            }
            return;
        }

        const isArrow = key === 'ArrowLeft' || key === 'ArrowRight' ||
            key === 'ArrowUp' || key === 'ArrowDown';
        const isPress = key === 'Enter' || key === ' ';
        if (!isArrow && !isPress && key !== 'r' && key !== 'R') return;
        this.usesKeyboard = true;

        if (key === 'r' || key === 'R') {
            if (this.screen === 'puzzle') {
                this.dom.puzzleActions
                    .querySelector('[data-action="puzzle-reset"]')?.click();
                event.preventDefault();
            }
            return;
        }

        if (this.screen === 'puzzle') {
            if (isArrow) {
                if (this.moveBoardFocus(key)) event.preventDefault();
            } else if (!this.focusIsInteractive()) {
                // A bare Enter parks the cursor on the IN conductor;
                // the next press starts playing.
                if (this.focusBoardCell(null)) event.preventDefault();
            }
            return;
        }

        if (isArrow) {
            if (this.moveMenuFocus(key)) event.preventDefault();
        } else if (!this.focusIsInteractive()) {
            if (this.focusPrimary()) event.preventDefault();
        }
    }

    focusIsInteractive() {
        const el = document.activeElement;
        return !!el && el !== document.body &&
            (el.tagName === 'BUTTON' || el.tagName === 'A');
    }

    /** Move focus one cell across the board, clamped at the edges. */
    moveBoardFocus(key) {
        const cells = this.pipeCells;
        if (!cells?.length) return false;
        const active = document.activeElement;
        if (!active?.classList?.contains('puzzle-pipe-cell')) {
            return this.focusBoardCell(null);
        }
        const size = this.engine.state?.size ||
            Math.round(Math.sqrt(cells.length));
        let index = Number(active.dataset.value);
        const x = index % size;
        if (key === 'ArrowLeft' && x > 0) index -= 1;
        else if (key === 'ArrowRight' && x < size - 1) index += 1;
        else if (key === 'ArrowUp' && index - size >= 0) index -= size;
        else if (key === 'ArrowDown' && index + size < cells.length) {
            index += size;
        }
        cells[index]?.focus();
        return true;
    }

    /** Focus a board cell; null means the IN conductor. */
    focusBoardCell(index) {
        const cells = this.pipeCells;
        if (!cells?.length) return false;
        const state = this.engine.state;
        const fallback = state ? state.sourceY * state.size : 0;
        const cell = cells[index ?? fallback] ?? cells[0];
        if (!cell || cell.disabled) return false;
        cell.focus();
        return true;
    }

    /** After a rebuild the old cell is gone; put focus back where it was. */
    restoreBoardFocus(index) {
        const cell = this.pipeCells[index];
        if (cell && !cell.disabled) {
            cell.focus();
            return;
        }
        // The board went dead under the cursor (failed or solved):
        // hand focus to the actions so Enter means "Try again".
        this.dom.puzzleActions.querySelector('button')?.focus();
    }

    /** Walk focus through the visible panel's buttons, wrapping. */
    moveMenuFocus(key) {
        const panel = document.querySelector('.screen-panel:not([hidden])');
        if (!panel) return false;
        const items = Array.from(
            panel.querySelectorAll('button:not(:disabled), a[href]')
        ).filter(el => el.offsetParent !== null);
        if (!items.length) return false;
        const forward = key === 'ArrowDown' || key === 'ArrowRight';
        const current = items.indexOf(document.activeElement);
        const index = current === -1 ?
            (forward ? 0 : items.length - 1) :
            (current + (forward ? 1 : -1) + items.length) % items.length;
        items[index].focus();
        return true;
    }

    focusPrimary() {
        const panel = document.querySelector('.screen-panel:not([hidden])');
        const target = panel?.querySelector('.menu-button--primary') ??
            panel?.querySelector('button:not(:disabled), a[href]');
        if (!target) return false;
        target.focus();
        return true;
    }

    // ── the live duel ──
    //
    // Same board, live rival, first to three rounds. The twist: solving
    // the circuit is not enough — only slamming the breaker stops your
    // clock, and the current then surges to verify the route. Slam on a
    // broken circuit and the round is lost on the spot. Transport is
    // net.js (Supabase Realtime broadcast, Spinburn-style room codes).

    initNet() {
        const net = window.SCNet;
        if (!net) return;
        net.on('opponentJoined', () => {
            try { this.duelConnected(); } catch (err) { scFault('duel:join', err); }
        });
        net.on('left', () => {
            try { this.duelRivalLeft(); } catch (err) { scFault('duel:left', err); }
        });
        net.on('msg', p => {
            try { this.duelMessage(p.t, p.d || {}); } catch (err) { scFault('duel:' + p.t, err); }
        });
    }

    netSend(type, payload) {
        try { window.SCNet?.send(type, payload); } catch { /* best effort */ }
    }

    // ── CrazyGames multiplayer glue: room data + invite links ──

    /** Tell the platform about our room so its invite UI can work. */
    cgRoom(joinable) {
        const d = this.duel;
        try {
            cgSdk()?.game?.updateRoom?.({
                roomId: d?.code ?? null,
                isJoinable: joinable === true,
                inviteParams: d ? { roomId: d.code } : undefined,
            });
        } catch { /* platform optional, always */ }
    }

    cgLeftRoom() {
        try { cgSdk()?.game?.leftRoom?.(); } catch { /* optional */ }
    }

    async cgCopyInvite() {
        const d = this.duel;
        const game = cgSdk()?.game;
        if (!d?.code || !game?.inviteLink) return;
        try {
            const link = this.duelInviteLink ?? await Promise.resolve(
                game.inviteLink({ roomId: d.code })
            );
            try { await navigator.clipboard.writeText(link); } catch { }
            this.dom.versusStatus.textContent =
                'Invite link copied — send it to a rival!';
        } catch {
            this.dom.versusStatus.textContent =
                'Could not build the invite link.';
        }
    }

    /**
     * Invite-driven arrivals: a click on an invite link joins that room
     * directly, and an instant-multiplayer launch hosts one — the party
     * leader lands in a joinable location with the code up.
     */
    cgMultiplayerInit() {
        const game = cgSdk()?.game;
        if (!game) return;
        try {
            game.addJoinRoomListener?.(params => {
                try {
                    const code = String(params?.roomId ?? '').trim();
                    if (code) this.duelJoinByInvite(code);
                } catch (err) {
                    scFault('cg:join', err);
                }
            });
        } catch { /* optional */ }
        let inviteCode = null;
        try { inviteCode = game.getInviteParam?.('roomId'); } catch { }
        if (inviteCode) {
            this.duelJoinByInvite(String(inviteCode));
        } else if (game.isInstantMultiplayer === true) {
            this.showVersus();
            this.duelHost();
        }
    }

    duelJoinByInvite(code) {
        this.showVersus();
        this.dom.versusJoinInput.value =
            code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
        this.duelJoin();
    }

    showVersus() {
        this.engine.clear();
        this.activeDaily = null;
        this.duel = null;
        this.duelHudText = '';
        this.dom.versusCode.hidden = true;
        this.dom.versusInvite.hidden = true;
        this.dom.versusStatus.textContent = window.SCNet ?
            '' : 'Versus needs net.js — reload the page.';
        this.setScreen('versus');
        window.SCNet?.preload();
    }

    duelHost() {
        if (!window.SCNet) return;
        this.dom.versusStatus.textContent = 'Opening a room…';
        SCNet.host().then(code => {
            this.duel = this.freshDuel('host', code);
            this.dom.versusCode.textContent = code;
            this.dom.versusCode.hidden = false;
            this.dom.versusInvite.hidden = !cgSdk()?.game?.inviteLink;
            this.cgRoom(true);
            // Mint the invite link the moment the room exists: the copy
            // button answers instantly, and the platform sees the API in
            // use as soon as anyone hosts.
            this.duelInviteLink = null;
            try {
                Promise.resolve(cgSdk()?.game?.inviteLink?.({ roomId: code }))
                    .then(link => { this.duelInviteLink = link ?? null; })
                    .catch(() => { /* optional */ });
            } catch { /* optional */ }
            this.dom.versusStatus.textContent =
                'Share the code — waiting for a rival…';
        }).catch(() => {
            this.dom.versusStatus.textContent =
                'No connection to the duel service. Try again on gamevolt.io.';
        });
    }

    duelJoin() {
        if (!window.SCNet) return;
        const code = this.dom.versusJoinInput.value.trim();
        if (code.length !== 4) {
            this.dom.versusStatus.textContent = 'A room code is four characters.';
            return;
        }
        this.dom.versusStatus.textContent = `Knocking on room ${code}…`;
        SCNet.join(code).then(() => {
            this.duel = this.freshDuel('guest', code);
        }).catch(() => {
            this.dom.versusStatus.textContent =
                'No connection to the duel service. Try again on gamevolt.io.';
        });
    }

    freshDuel(role, code) {
        return {
            role, code,
            bestOf: 5, seeds: [], entries: [],
            round: 0, myScore: 0, rivalScore: 0,
            phase: 'lobby',
            slammed: false, slamTime: 0,
            myResult: null, rivalResult: null,
            rivalPct: 0, rivalSlammed: false,
            deadline: 0, progressSentAt: 0, lastPctSent: -1,
            myRematch: false, rivalRematch: false,
            started: false,
        };
    }

    duelConnected() {
        const d = this.duel;
        if (!d) return;
        this.sound.playConfirm();
        if (d.role === 'host') {
            this.cgRoom(false);        // 1v1: rummet är fullt nu
            this.dom.versusStatus.textContent = 'Rival connected — dealing the boards…';
            this.duelSetupMatch();
        } else {
            this.dom.versusStatus.textContent = 'Connected — waiting for the boards…';
        }
    }

    /** Host only: pick seeds and locks for the match, tell the guest. */
    duelSetupMatch() {
        const d = this.duel;
        const base = Date.now() >>> 0;
        d.seeds = Array.from({ length: 9 }, (_, i) =>
            this.engine.hashSeed(`${d.code}:${base}:${i}`) >>> 0);
        d.entries = [3, 5, 7, 8, 9];    // locks 4, 6, 8, 9, 10 — a rising curve
        d.myScore = 0; d.rivalScore = 0;
        d.myRematch = false; d.rivalRematch = false;
        this.netSend('setup', {
            seeds: d.seeds, entries: d.entries, bestOf: d.bestOf,
        });
    }

    duelMessage(type, data) {
        const d = this.duel;
        if (!d) return;
        if (type === 'setup' && d.role === 'guest') {
            d.seeds = (data.seeds || []).map(Number);
            d.entries = (data.entries || []).map(Number);
            d.bestOf = Number(data.bestOf) || 5;
            d.myScore = 0; d.rivalScore = 0;
            d.myRematch = false; d.rivalRematch = false;
            this.netSend('setup-ok', {});
            return;
        }
        if (type === 'setup-ok' && d.role === 'host') {
            this.netSend('go', { round: 0 });
            this.startDuelRound(0);
            return;
        }
        if (type === 'go' && d.role === 'guest') {
            this.startDuelRound(Number(data.round) || 0);
            return;
        }
        if (type === 'progress') {
            d.rivalPct = Math.max(0, Math.min(100, Number(data.pct) || 0));
            return;
        }
        if (type === 'slam') {
            d.rivalSlammed = true;
            this.sound.playClank();
            return;
        }
        if (type === 'result') {
            d.rivalResult = {
                won: data.won === true,
                time: Number(data.time) || 0,
            };
            if (d.rivalResult.won && !d.myResult) d.deadline = d.rivalResult.time;
            this.duelResolveRound();
            return;
        }
        if (type === 'rematch') {
            d.rivalRematch = true;
            this.duelMaybeRematch();
        }
    }

    startDuelRound(round) {
        const d = this.duel;
        if (!d || !d.seeds.length) return;
        d.round = round;
        d.phase = 'playing';
        d.started = true;
        d.slammed = false; d.slamTime = 0;
        d.myResult = null; d.rivalResult = null;
        d.rivalPct = 0; d.rivalSlammed = false;
        d.deadline = 0; d.lastPctSent = -1; d.progressSentAt = 0;
        const entry = LOCK_CAMPAIGN[d.entries[round % d.entries.length]];
        const seed = (d.seeds[round % d.seeds.length] + round * 7919) >>> 0;
        this.activeDaily = null;
        this.engine.start('pipes', entry.lock, seed, { balance: entry });
        this.stats.duelRounds += 1;
        this.saveStats();
        this.enterPuzzle();
    }

    /** The button the whole mode is named for. */
    duelSlam() {
        const d = this.duel;
        const state = this.engine.state;
        if (!d || d.phase !== 'playing' || d.slammed || !state) return;
        if (state.solved || state.phase === 'failed' ||
            state.flowPhase === 'failed') return;
        d.slammed = true;
        d.slamTime = Math.round(state.elapsed * 10) / 10;
        this.stats.slams += 1;
        this.saveStats();
        this.checkTrophies({});
        this.netSend('slam', {});
        this.renderedRevision = -1;     // rebuild: the board goes hands-off
        if (this.engine.isPipeRouteComplete(state)) {
            // Verified. The clock stands and the surge races to OUT.
            state.flowStep = Math.min(state.flowStep || 1, 0.05);
            this.engine.refreshPipeFastForward(state);
            this.sound.playSurge();
        } else {
            // The whole mode in one sentence: slam a broken circuit
            // and the round is lost on the spot. This is set synchronously,
            // so the update() transition hook never sees it — handle the
            // fallout here.
            this.engine.failPipeFlow(state,
                'Breaker slammed on a broken circuit — the round is lost.');
            this.stats.misfires += 1;
            this.saveStats();
            this.fx('is-brownout');
            this.sound.playCircuitFail();
            const time = d.slamTime;
            setTimeout(() => {
                if (this.duel === d) {
                    this.duelFinishRound({ won: false, time });
                }
            }, 1100);
        }
        this.syncDuelHud();
    }

    /** My board reached an outcome: solved (won) or blown (lost). */
    duelFinishRound(result) {
        const d = this.duel;
        if (!d || d.phase !== 'playing' || d.myResult) return;
        d.myResult = result;
        this.netSend('result', {
            round: d.round, won: result.won, time: result.time,
        });
        this.duelResolveRound();
    }

    /**
     * Round scoring, computed identically on both sides:
     * a lost board hands the round over instantly; two solved boards
     * compare times (tie goes to the host — deterministic, and the
     * host earned it by making the room).
     */
    duelResolveRound() {
        const d = this.duel;
        if (!d || d.phase !== 'playing') return;
        const mine = d.myResult;
        const theirs = d.rivalResult;
        if (mine && !mine.won) {
            return this.duelApplyRound('rival',
                mine.beaten ? 'Rival’s time stood.' :
                d.slammed ? 'You slammed a broken circuit.' :
                    'Your circuit blew.');
        }
        if (theirs && !theirs.won) {
            return this.duelApplyRound('me', 'Rival’s circuit blew.');
        }
        if (mine && theirs) {
            if (mine.time === theirs.time) {
                return this.duelApplyRound(
                    d.role === 'host' ? 'me' : 'rival',
                    `Dead heat at ${mine.time.toFixed(1)}s — tie goes to the host.`);
            }
            const winner = mine.time < theirs.time ? 'me' : 'rival';
            return this.duelApplyRound(winner,
                `${mine.time.toFixed(1)}s vs rival’s ${theirs.time.toFixed(1)}s.`);
        }
        // One solved result alone: wait for the other side (or the deadline).
    }

    duelApplyRound(winner, note) {
        const d = this.duel;
        d.phase = 'roundEnd';
        this.engine.clear();
        if (winner === 'me') {
            d.myScore += 1;
            this.stats.duelRoundWins += 1;
            this.saveStats();
            this.checkTrophies({});
        } else if (winner === 'rival') {
            d.rivalScore += 1;
        }
        const target = Math.ceil(d.bestOf / 2);
        if (d.myScore >= target || d.rivalScore >= target) {
            return this.duelMatchEnd();
        }
        this.renderDuelRound(winner, note);
        this.setScreen('won');
        if (this.usesKeyboard) this.focusPrimary();
        if (d.role === 'host') {
            setTimeout(() => {
                if (this.duel !== d || d.phase !== 'roundEnd') return;
                const next = d.round + 1;
                this.netSend('go', { round: next });
                this.startDuelRound(next);
            }, 3200);
        }
    }

    duelMatchEnd() {
        const d = this.duel;
        d.phase = 'matchEnd';
        const won = d.myScore > d.rivalScore;
        this.stats.duels += 1;
        if (won) this.stats.duelWins += 1;
        this.saveStats();
        this.checkTrophies({});
        if (won) { this.fx('is-surge'); this.sound.playTriumph(); }
        else { this.sound.playCircuitFail(); }
        this.renderDuelMatch(won,
            `${d.myScore} — ${d.rivalScore} over ${d.round + 1} rounds.`);
        this.setScreen('won');
        if (this.usesKeyboard) this.focusPrimary();
    }

    duelMaybeRematch() {
        const d = this.duel;
        if (!d || d.phase !== 'matchEnd' || !d.myRematch || !d.rivalRematch) return;
        if (d.role === 'host') this.duelSetupMatch();
        else this.dom.puzzleWonTime.textContent = 'Rematch! Dealing new boards…';
    }

    duelRivalLeft() {
        const d = this.duel;
        if (!d) return;
        if (!d.started) {
            this.dom.versusStatus.textContent = 'Rival left the room.';
            return;
        }
        if (d.phase === 'matchEnd' || d.phase === 'gone') {
            d.phase = 'gone';
            this.dom.puzzleWonTime.textContent = 'Rival pulled the plug.';
            return;
        }
        d.phase = 'gone';
        this.cgLeftRoom();
        this.engine.clear();
        this.stats.duels += 1;
        this.stats.duelWins += 1;
        this.saveStats();
        this.renderDuelMatch(true, 'Rival pulled the plug — the match is yours.');
        this.setScreen('won');
    }

    duelForfeit() {
        const d = this.duel;
        window.SCNet?.leave();
        this.cgLeftRoom();
        if (d && d.started && d.phase !== 'matchEnd' && d.phase !== 'gone') {
            this.stats.duels += 1;    // a forfeit counts as a finished duel
            this.saveStats();
        }
        this.duel = null;
        this.engine.clear();
        this.syncDuelHud();
        this.showTitle();
    }

    renderDuelRound(winner, note) {
        const d = this.duel;
        this.dom.puzzleWonEyebrow.textContent = `Live duel · Room ${d.code}`;
        this.dom.puzzleWonTitle.textContent =
            winner === 'me' ? 'Round yours!' :
            winner === 'rival' ? 'Round lost' : 'Double blowout';
        this.dom.puzzleWonBest.textContent =
            `${d.myScore} — ${d.rivalScore} · first to ${Math.ceil(d.bestOf / 2)}`;
        this.dom.puzzleWonTime.textContent = `${note} Next round in a moment…`;
        this.dom.puzzleWonStats.replaceChildren();
        this.dom.puzzleWonActions.replaceChildren(
            this.button('Forfeit duel', 'versus-forfeit')
        );
    }

    renderDuelMatch(won, note) {
        const d = this.duel;
        this.dom.puzzleWonEyebrow.textContent = `Live duel · Room ${d.code}`;
        this.dom.puzzleWonTitle.textContent = won ? 'Match won!' : 'Match lost';
        this.dom.puzzleWonBest.textContent = note;
        this.dom.puzzleWonTime.textContent = won ?
            'The junction box is yours.' : 'The rival routed you this time.';
        this.dom.puzzleWonStats.replaceChildren();
        this.dom.puzzleWonActions.replaceChildren();
        if (d.phase !== 'gone') {
            this.dom.puzzleWonActions.append(
                this.button('Rematch', 'versus-rematch', { primary: true })
            );
        }
        this.dom.puzzleWonActions.append(
            this.button('Leave duel', 'versus-forfeit')
        );
    }

    syncDuelHud() {
        const d = this.duel;
        if (!this.dom.versusHud) return;
        if (!d || !d.started) {
            this.dom.versusHud.hidden = true;
            this.duelHudText = '';
            return;
        }
        const target = Math.ceil(d.bestOf / 2);
        const dots = n => '●'.repeat(n) + '○'.repeat(target - n);
        const rival = d.rivalSlammed && d.phase === 'playing' ?
            '⚡ RIVAL SLAMMED THE BREAKER' :
            d.phase === 'playing' ? `RIVAL · building · ${d.rivalPct}%` :
            'RIVAL';
        const text = `YOU ${dots(d.myScore)}  ${dots(d.rivalScore)} RIVAL|${rival}`;
        if (text === this.duelHudText) return;
        this.duelHudText = text;
        this.dom.versusHud.hidden = false;
        this.dom.versusScore.textContent = text.split('|')[0];
        this.dom.versusRival.textContent = rival;
        this.dom.versusRival.classList.toggle(
            'is-slam', d.rivalSlammed && d.phase === 'playing');
    }

    /** Per-frame duel work: progress pings, the deadline, the HUD. */
    duelTick(state) {
        const d = this.duel;
        if (!d || d.phase !== 'playing' || !state) return;
        const now = performance.now();
        if (now - d.progressSentAt > 900) {
            d.progressSentAt = now;
            const placed = state.cells.filter(
                (cell, k) => cell.welded || cell.solutionIndex === k
            ).length;
            const pct = Math.round(100 * placed / state.cells.length);
            if (pct !== d.lastPctSent) {
                d.lastPctSent = pct;
                this.netSend('progress', { pct });
            }
        }
        // The rival's verified time stands: once it cannot be beaten,
        // the round is over even mid-build.
        if (d.deadline > 0 && !d.myResult && state.elapsed > d.deadline) {
            this.duelFinishRound({ won: false, time: d.deadline, beaten: true });
        }
        this.syncDuelHud();
    }

    /**
     * The backdrop: faint circuit traces etched into the dark, with a
     * few sparks wandering along them. Pure atmosphere — behind
     * everything, touching nothing.
     */
    initBackdrop() {
        this.bgCanvas = document.getElementById('bgCircuits');
        if (!this.bgCanvas) return;
        this.bgCtx = this.bgCanvas.getContext('2d');
        const build = () => {
            const w = this.bgCanvas.width = window.innerWidth;
            const h = this.bgCanvas.height = window.innerHeight;
            const seedRandom = this.engine.createRandom(
                this.engine.hashSeed(`bg:${w}x${h}`)
            );
            const makeTrace = steps => {
                const points = [{
                    x: seedRandom() * w,
                    y: seedRandom() * h,
                }];
                let horizontal = seedRandom() < 0.5;
                for (let s = 0; s < steps; s++) {
                    const last = points[points.length - 1];
                    const run = 60 + seedRandom() * 180;
                    const sign = seedRandom() < 0.5 ? -1 : 1;
                    points.push(horizontal ?
                        { x: last.x + run * sign, y: last.y } :
                        { x: last.x, y: last.y + run * sign });
                    horizontal = !horizontal;
                }
                return points;
            };
            // Two depths of copper: a dim far weave filling the dark,
            // and a near layer with solder pads that the sparks ride.
            this.bgFarTraces = Array.from({ length: 14 }, () => makeTrace(6));
            this.bgTraces = Array.from({ length: 7 }, () => makeTrace(5));
            this.bgSparks = [0, 1, 2, 3, 4].map(i => ({
                trace: i % this.bgTraces.length,
                t: (i * 0.21) % 1,
                speed: 0.05 + (i % 3) * 0.02,
            }));
            this.bgStatic = null;   // omritas
        };
        build();
        window.addEventListener('resize', build);

        // Touch anywhere on the title and the cabinet answers in kind:
        // a small burst of sparks under the finger.
        this.fxParticles = [];
        this.arcs = [];
        this.arcCountdown = 2.5;
        document.addEventListener('pointerdown', event => {
            if (this.screen !== 'title' || this.reducedMotion) return;
            this.spawnSparks(event.clientX, event.clientY);
        }, { passive: true });
    }

    spawnSparks(x, y) {
        for (let i = 0; i < 12; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 60 + Math.random() * 220;
            this.fxParticles.push({
                x, y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 40,
                life: 0.35 + Math.random() * 0.3,
                age: 0,
            });
        }
        if (this.fxParticles.length > 160) {
            this.fxParticles.splice(0, this.fxParticles.length - 160);
        }
    }

    /** A jagged arc near the logo: the box is live, and it shows. */
    spawnArc() {
        const w = this.bgCanvas.width;
        const h = this.bgCanvas.height;
        const y = h * (0.16 + Math.random() * 0.24);
        const x0 = w * (0.08 + Math.random() * 0.2);
        const x1 = w * (0.72 + Math.random() * 0.2);
        const points = [{ x: x0, y }];
        const steps = 7 + Math.floor(Math.random() * 4);
        for (let i = 1; i <= steps; i++) {
            points.push({
                x: x0 + (x1 - x0) * (i / steps),
                y: y + (Math.random() - 0.5) * 46,
            });
        }
        this.arcs.push({ points, life: 0.22, age: 0 });
    }

    /**
     * Everything in the backdrop that never moves — the pegboard holes,
     * both depths of etched traces, the solder pads — painted once per
     * resize instead of sixty times a second.
     */
    paintStatic() {
        const w = Math.max(1, this.bgCanvas.width);
        const h = Math.max(1, this.bgCanvas.height);
        const layer = document.createElement('canvas');
        layer.width = w;
        layer.height = h;
        const ctx = layer.getContext('2d');

        const grid = 34;
        ctx.fillStyle = 'rgba(148, 200, 220, 0.07)';
        for (let x = grid / 2; x < w; x += grid) {
            for (let y = grid / 2; y < h; y += grid) {
                ctx.fillRect(x - 0.6, y - 0.6, 1.2, 1.2);
            }
        }

        const stroke = points => {
            ctx.beginPath();
            points.forEach((pt, i) =>
                i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y));
            ctx.stroke();
        };

        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(115, 232, 246, 0.08)';
        this.bgFarTraces.forEach(stroke);

        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(115, 232, 246, 0.16)';
        this.bgTraces.forEach(stroke);

        this.bgTraces.forEach((points, traceIndex) => {
            points.forEach((pt, i) => {
                const amber = (traceIndex * 3 + i) % 5 === 0;
                ctx.lineWidth = 1.4;
                ctx.strokeStyle = amber ?
                    'rgba(255, 205, 92, 0.34)' : 'rgba(115, 232, 246, 0.30)';
                ctx.beginPath();
                ctx.arc(pt.x, pt.y, 3.4, 0, Math.PI * 2);
                ctx.stroke();
                ctx.fillStyle = amber ?
                    'rgba(255, 205, 92, 0.55)' : 'rgba(115, 232, 246, 0.42)';
                ctx.beginPath();
                ctx.arc(pt.x, pt.y, 1.2, 0, Math.PI * 2);
                ctx.fill();
            });
        });

        this.bgStatic = layer;
    }

    drawBackdrop(dt) {
        const ctx = this.bgCtx;
        if (!ctx || !this.bgTraces) return;
        const w = this.bgCanvas.width;
        const h = this.bgCanvas.height;
        ctx.clearRect(0, 0, w, h);

        // ett långsamt andande sken bakom väven: skåpet har ström
        if (!this.reducedMotion) {
            this.bgGlowPhase = (this.bgGlowPhase || 0) + dt * 0.5;
            const breath = 0.5 + 0.5 * Math.sin(this.bgGlowPhase);
            const glow = ctx.createRadialGradient(
                w * 0.5, h * 0.24, 0,
                w * 0.5, h * 0.24, Math.max(w, h) * 0.55
            );
            glow.addColorStop(0, `rgba(115, 232, 246, ${0.045 + 0.035 * breath})`);
            glow.addColorStop(1, 'rgba(115, 232, 246, 0)');
            ctx.fillStyle = glow;
            ctx.fillRect(0, 0, w, h);
        }

        if (!this.bgStatic) this.paintStatic();
        ctx.drawImage(this.bgStatic, 0, 0);

        if (this.reducedMotion) return;
        this.bgSparks.forEach(spark => {
            // Ornament heals itself: a spark in a bad state restarts
            // rather than ever costing a frame.
            if (!Number.isFinite(spark.t)) spark.t = 0;
            spark.t += dt * spark.speed;
            if (spark.t >= 1) {
                spark.t = 0;
                spark.trace = (spark.trace + 1) % this.bgTraces.length;
            }
            const points = this.bgTraces[spark.trace];
            if (!points || points.length < 2) { spark.trace = 0; return; }
            const eased = spark.t * (points.length - 1);
            const index = Math.max(
                0, Math.min(points.length - 2, Math.floor(eased))
            );
            const local = eased - index;
            const a = points[index];
            const b = points[index + 1];
            if (!a || !b) { spark.t = 0; return; }
            const x = a.x + (b.x - a.x) * local;
            const y = a.y + (b.y - a.y) * local;
            const glow = ctx.createRadialGradient(x, y, 0, x, y, 26);
            glow.addColorStop(0, 'rgba(255, 205, 92, 0.28)');
            glow.addColorStop(1, 'rgba(255, 205, 92, 0)');
            ctx.fillStyle = glow;
            ctx.beginPath();
            ctx.arc(x, y, 26, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = 'rgba(255, 236, 180, 0.85)';
            ctx.beginPath();
            ctx.arc(x, y, 1.6, 0, Math.PI * 2);
            ctx.fill();
        });

        // gnistregnet från tryck
        this.fxParticles = this.fxParticles.filter(pt => {
            pt.age += dt;
            if (pt.age >= pt.life) return false;
            pt.x += pt.vx * dt;
            pt.y += pt.vy * dt;
            pt.vy += 500 * dt;
            const fade = 1 - pt.age / pt.life;
            ctx.fillStyle = `rgba(255, ${205 + Math.floor(40 * fade)}, 110, ${0.9 * fade})`;
            ctx.fillRect(pt.x - 1, pt.y - 1, 2.4, 2.4);
            return true;
        });

        // blixtbågarna över titeln, med slumpad paus emellan
        if (this.screen === 'title') {
            this.arcCountdown -= dt;
            if (this.arcCountdown <= 0) {
                this.spawnArc();
                this.arcCountdown = 3.5 + Math.random() * 5;
            }
        }
        this.arcs = this.arcs.filter(arc => {
            arc.age += dt;
            if (arc.age >= arc.life) return false;
            const fade = 1 - arc.age / arc.life;
            ctx.lineWidth = 1.6;
            ctx.strokeStyle = `rgba(190, 240, 255, ${0.55 * fade})`;
            ctx.shadowColor = 'rgba(115, 232, 246, 0.8)';
            ctx.shadowBlur = 10;
            ctx.beginPath();
            arc.points.forEach((pt, i) =>
                i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y));
            ctx.stroke();
            ctx.shadowBlur = 0;
            return true;
        });
    }

    // ── storage ──

    loadJson(key) {
        try {
            const parsed = JSON.parse(scStore.get(key));
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
            return {};
        }
    }

    saveStats() {
        scStore.set(SC_KEYS.stats, JSON.stringify(this.stats));
    }

    // ── the trophy cabinet ──

    saveTrophies() {
        scStore.set(SC_KEYS.trophies, JSON.stringify(this.trophies));
    }

    trophyCount() {
        return SC_TROPHIES.filter(t => this.trophies[t.id]).length;
    }

    /** Everything a trophy condition may ask about, in one snapshot. */
    trophySnapshot(ctx) {
        const standing = this.campaignStanding();
        return {
            st: this.stats,
            standing,
            medalTotal: standing.medals.gold + standing.medals.silver +
                standing.medals.bronze,
            daily: this.getDailyInfo(),
            ctx,
        };
    }

    checkTrophies(ctx = {}, options = {}) {
        const snap = this.trophySnapshot(ctx);
        SC_TROPHIES.forEach(trophy => {
            if (this.trophies[trophy.id]) return;
            let earned = false;
            try {
                earned = trophy.when(snap) === true;
            } catch { /* a broken condition must never break play */ }
            if (earned) this.unlockTrophy(trophy.id, options);
        });
    }

    unlockTrophy(id, { silent = false } = {}) {
        if (this.trophies[id]) return false;
        const def = SC_TROPHIES.find(t => t.id === id);
        if (!def) return false;
        this.trophies[id] = Date.now();
        this.saveTrophies();
        // Cloud suppression: earned on another device → no re-toast here.
        const cloudHeld =
            window.GameVolt?.achievements?.isUnlocked?.(id) === true;
        try { window.GameVolt?.achievements?.unlock?.(id); } catch { }
        if (!silent && !cloudHeld) this.trophyToast(def);
        if (this.screen === 'trophies') this.renderTrophies();
        // The platinum takes itself once everything else is held.
        if (id !== 'master' &&
            SC_TROPHIES.every(t => t.id === 'master' || this.trophies[t.id])) {
            this.unlockTrophy('master', { silent });
        }
        return true;
    }

    trophyToast(def) {
        this.trophyQueue.push(def);
        if (!this.trophyShowing) this.nextTrophyToast();
    }

    nextTrophyToast() {
        const def = this.trophyQueue.shift();
        const el = document.getElementById('trophyToast');
        if (!def || !el) { this.trophyShowing = false; return; }
        this.trophyShowing = true;
        const meta = SC_TIER_META[def.tier];
        el.replaceChildren();
        const pokal = document.createElement('i');
        pokal.className = `tc-pokal tc-pokal--${def.tier}`;
        pokal.setAttribute('aria-hidden', 'true');
        const text = document.createElement('span');
        const label = document.createElement('b');
        label.style.color = meta.color;
        label.textContent = `TROPHY UNLOCKED · ${meta.label}`;
        const name = document.createElement('strong');
        name.textContent = def.name;
        const desc = document.createElement('small');
        desc.textContent = def.desc;
        text.append(label, name, desc);
        el.append(pokal, text);
        el.hidden = false;
        el.classList.remove('show');
        void el.offsetWidth;
        el.classList.add('show');
        if (def.tier === 'platinum') this.sound.playTriumph();
        else if (def.tier === 'gold') this.sound.playSurge();
        else this.sound.playSolveBlip();
        clearTimeout(this.trophyTimer);
        this.trophyTimer = setTimeout(() => {
            el.classList.remove('show');
            setTimeout(() => {
                if (!this.trophyQueue.length) el.hidden = true;
                this.nextTrophyToast();
            }, 400);
        }, 2600);
    }

    showTrophies() {
        this.engine.clear();
        this.activeDaily = null;
        this.checkTrophies({});          // tidströfeer kan ha mognat i tysthet
        this.renderTrophies();
        this.setScreen('trophies');
    }

    renderTrophies() {
        this.dom.trophyCount.textContent =
            `${this.trophyCount()} / ${SC_TROPHIES.length} unlocked`;
        this.dom.trophyBody.replaceChildren(...SC_TIER_ORDER.map(tier => {
            const items = SC_TROPHIES.filter(t => t.tier === tier);
            const got = items.filter(t => this.trophies[t.id]).length;
            const section = document.createElement('section');
            section.className = 'trophy-tier';
            const head = document.createElement('h3');
            head.style.color = SC_TIER_META[tier].color;
            head.textContent =
                `${SC_TIER_META[tier].label} · ${got}/${items.length}`;
            const grid = document.createElement('div');
            grid.className = 'trophy-grid';
            items.forEach(def => {
                const on = !!this.trophies[def.id];
                const card = document.createElement('div');
                card.className = 'trophy-card' + (on ? ' on' : '');
                const pokal = document.createElement('i');
                // Locked = the same cup in dead metal. A silhouette is a
                // goal; a padlock is just a padlock.
                pokal.className = `tc-pokal tc-pokal--${def.tier}` +
                    (on ? '' : ' is-locked');
                pokal.setAttribute('aria-hidden', 'true');
                const name = document.createElement('b');
                name.textContent = def.name;
                const desc = document.createElement('small');
                desc.textContent = def.desc;
                card.append(pokal, name, desc);
                grid.append(card);
            });
            section.append(head, grid);
            return section;
        }));
    }

    getBest(lock) {
        const value = this.bests[`pipes:${lock}`];
        return Number.isFinite(value) && value > 0 ? value : 0;
    }

    setBest(lock, seconds) {
        this.bests[`pipes:${lock}`] = seconds;
        scStore.set(SC_KEYS.bests, JSON.stringify(this.bests));
    }

    isLockUnlocked(lock) {
        return lock <= 1 || this.getBest(lock - 1) > 0;
    }

    hasSeenLock() {
        return scStore.get(SC_KEYS.seen) === '1';
    }

    markLockSeen() {
        scStore.set(SC_KEYS.seen, '1');
    }

    /**
     * Today's lock and where the player stands with it. A streak is
     * alive if the last solve was today or yesterday; anything older
     * starts a new count on the next solve.
     */
    getDailyInfo(now = new Date()) {
        const dateKey = dailyLockDateKey(now);
        const record = this.daily || {};
        const solvedToday = record.date === dateKey;
        const streakAlive = solvedToday ||
            record.date === dailyLockKeyBefore(dateKey);
        return {
            dateKey,
            entry: dailyLockEntry(dateKey),
            solvedToday,
            time: solvedToday && Number.isFinite(record.time) ?
                record.time : 0,
            streak: streakAlive ? (record.streak || 0) : 0,
            bestStreak: record.best || 0,
        };
    }

    // ── screens ──

    setScreen(name) {
        this.screen = name;
        this.dom.screenTitle.hidden = name !== 'title';
        this.dom.screenSelect.hidden = name !== 'select';
        this.dom.screenPuzzle.hidden = name !== 'puzzle';
        this.dom.screenWon.hidden = name !== 'won';
        this.dom.screenStats.hidden = name !== 'stats';
        this.dom.screenVersus.hidden = name !== 'versus';
        this.dom.screenTrophies.hidden = name !== 'trophies';
        this.syncDuelHud();
    }

    showTitle() {
        this.engine.clear();
        this.activeDaily = null;
        this.syncTitleNote();
        this.setScreen('title');
    }

    showSelect() {
        this.engine.clear();
        this.activeDaily = null;
        this.renderSelect();
        this.setScreen('select');
    }

    showStats() {
        this.engine.clear();
        this.activeDaily = null;
        this.renderStats();
        this.setScreen('stats');
    }

    /** Seconds → "2h 5m", "3m 12s" or "42s", whichever reads best. */
    fmtDuration(totalSeconds) {
        const s = Math.floor(Number(totalSeconds) || 0);
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        if (h > 0) return `${h}h ${m}m`;
        if (m > 0) return `${m}m ${s % 60}s`;
        return `${s}s`;
    }

    /** Campaign standing derived from the stored bests. */
    campaignStanding() {
        const medals = { gold: 0, silver: 0, bronze: 0 };
        let solvedLocks = 0;
        let bestSum = 0;
        LOCK_CAMPAIGN.forEach((entry, i) => {
            const best = this.getBest(i + 1);
            if (best <= 0) return;
            solvedLocks += 1;
            bestSum += best;
            const medal = lockMedal(entry, best);
            if (medal) medals[medal] += 1;
        });
        return { solvedLocks, medals, bestSum };
    }

    renderStats() {
        const stats = this.stats;
        const standing = this.campaignStanding();
        const info = this.getDailyInfo();
        const average = stats.solves > 0 ?
            stats.totalSolveSeconds / stats.solves : 0;

        const tile = (value, label) => {
            const stat = document.createElement('div');
            stat.className = 'stat';
            const val = document.createElement('b');
            val.className = 'stat__value';
            val.textContent = String(value);
            const cap = document.createElement('span');
            cap.className = 'stat__label';
            cap.textContent = label;
            stat.append(val, cap);
            return stat;
        };
        const group = (name, kind, tiles) => {
            const section = document.createElement('section');
            section.className = `stats-group stats-group--${kind}`;
            const heading = document.createElement('h3');
            heading.textContent = name;
            const grid = document.createElement('div');
            grid.className = 'stats-grid';
            grid.append(...tiles);
            section.append(heading, grid);
            return section;
        };

        this.dom.statsBody.replaceChildren(
            group('The campaign', 'campaign', [
                tile(`${standing.solvedLocks}/${LOCK_CAMPAIGN.length}`,
                    'locks open'),
                tile(standing.medals.gold, 'gold'),
                tile(standing.medals.silver, 'silver'),
                tile(standing.medals.bronze, 'bronze'),
                tile(standing.bestSum > 0 ?
                    this.fmtDuration(standing.bestSum) : '—',
                    'sum of bests'),
            ]),
            group('The daily lock', 'daily', [
                tile(info.streak, 'streak'),
                tile(info.bestStreak, 'best streak'),
                tile(stats.dailySolves, 'dailies solved'),
            ]),
            group('The duels', 'duel', [
                tile(stats.duelWins, 'duels won'),
                tile(stats.duels, 'duels fought'),
                tile(stats.duelRoundWins, 'rounds taken'),
                tile(stats.duelRounds, 'rounds played'),
                tile(stats.slams, 'breaker slams'),
                tile(stats.misfires, 'misfires'),
            ]),
            group('The grind', 'grind', [
                tile(stats.solves, 'locks solved'),
                tile(stats.attempts, 'circuits started'),
                tile(stats.resets, 'restarts'),
                tile(stats.taps, 'conductor taps'),
                tile(stats.swaps, 'swaps banked'),
                tile(this.fmtDuration(stats.seconds), 'time in the box'),
                tile(stats.fastest > 0 ?
                    `${stats.fastest.toFixed(1)}s` : '—', 'fastest solve'),
                tile(average > 0 ?
                    `${average.toFixed(1)}s` : '—', 'average solve'),
            ])
        );
    }

    syncTitleNote() {
        // A player who has never opened a lock gets a warm-up circuit as
        // the big button; the daily steps back until the ropes are known.
        const fresh = !this.hasSeenLock();
        if (this.dom.titleFirst) {
            this.dom.titleFirst.hidden = !fresh;
            this.dom.titleDaily.classList.toggle(
                'menu-button--primary', !fresh
            );
        }
        if (fresh) {
            this.dom.titleDailyNote.textContent =
                'New in the box? The first circuit shows you every move.';
            return;
        }
        const info = this.getDailyInfo();
        const days = `${info.streak} day${info.streak === 1 ? '' : 's'}`;
        this.dom.titleDailyNote.textContent = info.solvedToday ?
            `Daily solved in ${info.time.toFixed(1)}s · streak ${days}` :
            info.streak > 0 ?
            `Today's lock is waiting — a ${days} streak on the line` :
            'A fresh board every midnight, the same for everyone';
    }

    syncMute() {
        this.dom.muteButton.textContent =
            `Sound: ${this.sound.muted ? 'off' : 'on'}`;
    }

    // ── starting locks ──

    startLock(lock, forceTeaching = false) {
        if (
            !Number.isInteger(lock) || lock < 1 ||
            lock > LOCK_CAMPAIGN.length || !this.isLockUnlocked(lock)
        ) return false;
        const entry = LOCK_CAMPAIGN[lock - 1];
        // The very first lock ever is a lesson: its current crawls.
        // "How to play" re-runs that lesson on demand, guide and all.
        const teaching = forceTeaching || !this.hasSeenLock();
        this.activeDaily = null;
        this.engine.start('pipes', entry.lock, entry.seed, {
            teaching,
            balance: entry,
        });
        if (teaching) this.markLockSeen();
        this.enterPuzzle();
        return true;
    }

    startDaily() {
        const info = this.getDailyInfo();
        const teaching = !this.hasSeenLock();
        this.engine.start('pipes', info.entry.lock, info.entry.seed, {
            teaching,
            balance: info.entry,
        });
        if (teaching) this.markLockSeen();
        this.engine.state.dailyLock = info.dateKey;
        this.activeDaily = info.dateKey;
        this.enterPuzzle();
        return true;
    }

    enterPuzzle() {
        this.renderedRevision = -1;
        this.lockResets = 0;
        this.stats.attempts += 1;
        this.saveStats();
        this.focusBoardOnRender = this.usesKeyboard;
        this.setScreen('puzzle');
        this.sound.playConfirm();
        try { cgSdk()?.game?.gameplayStart?.(); } catch { /* optional */ }
    }

    leavePuzzle() {
        if (this.duel) return this.duelForfeit();
        if (this.engine.state?.solved) return;
        this.engine.clear();
        this.activeDaily = null;
        this.saveStats();
        this.checkTrophies({});
        try { cgSdk()?.game?.gameplayStop?.(); } catch { /* optional */ }
        this.showSelect();
    }

    // ── completing locks ──

    complete() {
        const state = this.engine.state;
        if (!state?.solved) return false;
        const seconds = Math.round(state.elapsed * 10) / 10;
        if (this.duel) {
            // A duel round: the clock stopped at the slam (or, if the
            // creep finished the job unslammed, at the solve itself).
            const time = this.duel.slammed ? this.duel.slamTime : seconds;
            this.engine.clear();
            this.fx('is-surge');
            this.sound.playSolveBlip();
            this.duelFinishRound({ won: true, time });
            if (this.duel && this.duel.phase === 'playing') {
                this.dom.puzzleStatus.textContent =
                    `Circuit verified at ${time.toFixed(1)}s — ` +
                    'waiting for the rival…';
            }
            return true;
        }
        this.stats.solves += 1;
        if (state.dailyLock) this.stats.dailySolves += 1;
        if (Number.isFinite(state.moves)) this.stats.swaps += state.moves;
        this.stats.totalSolveSeconds =
            Math.round((this.stats.totalSolveSeconds + seconds) * 10) / 10;
        if (!this.stats.fastest || seconds < this.stats.fastest) {
            this.stats.fastest = seconds;
        }
        this.saveStats();
        const winCtx = {
            won: true,
            teaching: state.teaching === true,
            size: state.size,
            anchors: state.anchors?.length ?? 0,
            resets: this.lockResets,
            viaKeyboard: this.usesKeyboard,
        };
        this.lastResult = state.dailyLock ?
            this.summariseDaily(state, seconds) :
            this.summariseCampaign(state, seconds);
        this.checkTrophies(winCtx);
        this.engine.clear();
        this.activeDaily = null;
        this.fx('is-surge');
        this.sound.playTriumph();
        try {
            cgSdk()?.game?.gameplayStop?.();
            cgSdk()?.game?.happytime?.();
        } catch { /* optional */ }
        this.renderWon();
        this.setScreen('won');
        this.celebrateBackdrop();
        this.solvesSinceAd += 1;
        this.maybeMidgameAd(winCtx.teaching);
        // Keyboard players chain locks on Enter alone.
        if (this.usesKeyboard) this.focusPrimary();
        return true;
    }

    /**
     * A midgame ad at the natural break: on the won screen, never in a
     * duel, never on the teaching board, at most every third solve and
     * three minutes apart. Sound ducks through platformMuted while the
     * ad runs, so the player's own mute choice is never overwritten.
     */
    maybeMidgameAd(teaching) {
        const sdk = cgSdk();
        if (!sdk?.ad?.requestAd || teaching || this.duel) return;
        const now = performance.now();
        if (this.solvesSinceAd < 3 || now - this.lastAdAt < 180000) return;
        this.lastAdAt = now;
        this.solvesSinceAd = 0;
        const restore = () => { this.sound.platformMuted = false; };
        try {
            sdk.ad.requestAd('midgame', {
                adStarted: () => { this.sound.platformMuted = true; },
                adFinished: restore,
                adError: restore,
            });
        } catch {
            restore();
        }
    }

    summariseCampaign(state, seconds) {
        const lock = state.difficulty;
        const entry = LOCK_CAMPAIGN[lock - 1] ?? null;
        const previous = this.getBest(lock);
        const isBest = previous === 0 || seconds < previous;
        if (isBest) this.setBest(lock, seconds);
        return {
            daily: false,
            lock,
            seconds,
            previousBest: previous,
            isBest,
            medal: entry ? lockMedal(entry, seconds) : null,
            goldTarget: entry ? entry.gold : null,
            boardSize: state.size,
            swaps: Number.isFinite(state.moves) ? state.moves : null,
            branching: state.branching === true,
        };
    }

    /**
     * A daily solve banks the streak: consecutive days chain it, a
     * missed day starts over, and a second solve the same day only
     * ever improves the time.
     */
    summariseDaily(state, seconds) {
        const dateKey = state.dailyLock;
        const record = this.daily || {};
        const sameDay = record.date === dateKey;
        const previous = sameDay && Number.isFinite(record.time) ?
            record.time : 0;
        const isBest = previous === 0 || seconds < previous;
        const streak = sameDay ?
            (record.streak || 1) :
            record.date === dailyLockKeyBefore(dateKey) ?
            (record.streak || 0) + 1 :
            1;
        const bestStreak = Math.max(record.best || 0, streak);
        this.daily = {
            date: dateKey,
            time: isBest ? seconds : previous,
            streak,
            best: bestStreak,
        };
        scStore.set(SC_KEYS.daily, JSON.stringify(this.daily));
        if (window.GameVolt) {
            try {
                GameVolt.leaderboard.submit(streak, { mode: 'daily-streak' });
            } catch { /* the board is a bonus, never a blocker */ }
        }

        const entry = dailyLockEntry(dateKey);
        return {
            daily: true,
            dateKey,
            seconds,
            previousBest: previous,
            isBest,
            streak,
            bestStreak,
            medal: lockMedal(entry, seconds),
            goldTarget: entry.gold,
            boardSize: state.size,
            swaps: Number.isFinite(state.moves) ? state.moves : null,
            branching: state.branching === true,
        };
    }

    retry() {
        const result = this.lastResult;
        if (!result) return this.showSelect();
        return result.daily ? this.startDaily() : this.startLock(result.lock);
    }

    advance() {
        const result = this.lastResult;
        if (!result || result.daily) return this.showSelect();
        if (result.lock >= LOCK_CAMPAIGN.length) return this.showSelect();
        return this.startLock(result.lock + 1);
    }

    // ── the frame ──

    update(dt) {
        if (this.screen !== 'puzzle') return;
        const state = this.engine.state;
        if (!state) return;
        // Time in the box runs whenever a board is up; it's written to
        // storage at the screen transitions, not every frame.
        this.stats.seconds += dt;

        const previousFill = state.filled.size;
        const previousPhase = state.flowPhase;

        if (this.engine.update(dt)) {
            this.startWinHold();
            return;
        }
        if (state.filled.size > previousFill) this.sound.playCircuitStep();
        if (previousPhase !== 'failed' && state.flowPhase === 'failed') {
            this.fx('is-brownout');
            this.sound.playCircuitFail();
            if (this.duel?.phase === 'playing' && !this.duel.myResult) {
                if (this.duel.slammed) {
                    this.stats.misfires += 1;
                    this.saveStats();
                }
                const elapsed = Math.round(state.elapsed * 10) / 10;
                // Let the hazard stripes land before the round turns over.
                const d = this.duel;
                setTimeout(() => {
                    if (this.duel === d) {
                        this.duelFinishRound({ won: false, time: elapsed });
                    }
                }, 1100);
            }
        }
        this.duelTick(state);

        if (this.engine.revision !== this.renderedRevision) {
            this.renderedRevision = this.engine.revision;
            this.renderPuzzle(state);
        } else {
            this.syncFlow(state);
            this.dom.puzzleStatus.textContent = state.status;
        }
    }

    /**
     * The last act of a solved board: the light races the finished route
     * one more time while the engine's completion timer runs, and the
     * won screen holds off until the wave has landed.
     */
    startWinHold() {
        if (this.winPending) return true;
        this.winPending = true;
        setTimeout(() => {
            this.winPending = false;
            try {
                this.complete();
            } catch (err) {
                scFault('win-hold', err);
            }
        }, this.reducedMotion || this.duel ? 0 : 420);
        return true;
    }

    /** Arcs and spark bursts behind the won panel: the box celebrates. */
    celebrateBackdrop() {
        if (this.reducedMotion || !this.bgCanvas) return;
        const w = this.bgCanvas.width;
        const h = this.bgCanvas.height;
        [0, 260, 620].forEach(delay => setTimeout(() => {
            if (this.screen === 'won') this.spawnArc();
        }, delay));
        [90, 340, 560, 830].forEach(delay => setTimeout(() => {
            if (this.screen !== 'won') return;
            this.spawnSparks(
                w * (0.15 + Math.random() * 0.7),
                h * (0.1 + Math.random() * 0.3)
            );
        }, delay));
    }

    // ── actions ──

    dispatch(button) {
        const action = button.dataset.action;
        if (action !== 'mute') this.sound.unlock();

        if (action === 'mute') {
            this.sound.toggleMuted();
            if (!this.sound.muted) {
                this.sound.unlock();
                this.sound.playTone(392, 523, 0.12, 0.04, 'square');
            }
            this.syncMute();
            return;
        }
        if (action === 'title') { this.sound.playConfirm(); this.showTitle(); return; }
        if (action === 'select') { this.sound.playConfirm(); this.showSelect(); return; }
        if (action === 'stats') { this.sound.playConfirm(); this.showStats(); return; }
        if (action === 'trophies') { this.sound.playConfirm(); this.showTrophies(); return; }
        if (action === 'versus') { this.sound.playConfirm(); this.showVersus(); return; }
        if (action === 'versus-host') { this.duelHost(); return; }
        if (action === 'versus-join') { this.duelJoin(); return; }
        if (action === 'versus-back') {
            this.sound.playConfirm();
            window.SCNet?.leave();
            this.cgLeftRoom();
            this.duel = null;
            this.showTitle();
            return;
        }
        if (action === 'versus-slam') { this.duelSlam(); return; }
        if (action === 'versus-invite') { this.cgCopyInvite(); return; }
        if (action === 'versus-forfeit') { this.sound.playConfirm(); this.duelForfeit(); return; }
        if (action === 'versus-rematch') {
            const d = this.duel;
            if (d && d.phase === 'matchEnd') {
                d.myRematch = true;
                this.netSend('rematch', {});
                this.dom.puzzleWonTime.textContent = 'Waiting for the rival…';
                this.duelMaybeRematch();
            }
            return;
        }
        if (action === 'first-circuit') { this.startLock(1); return; }
        if (action === 'how-to') {
            this.sound.playConfirm();
            this.startLock(1, true);
            return;
        }
        if (action === 'daily') { this.startDaily(); return; }
        if (action === 'start-lock') {
            this.startLock(Number(button.dataset.value));
            return;
        }
        if (action === 'puzzle-close') { this.sound.playConfirm(); this.leavePuzzle(); return; }
        if (action === 'won-again') { this.sound.playConfirm(); this.retry(); return; }
        if (action === 'won-next') { this.sound.playConfirm(); this.advance(); return; }
        if (action === 'won-menu') { this.sound.playConfirm(); this.showSelect(); return; }

        if (action.startsWith('puzzle-')) {
            // A slammed board is hands-off: the current has the floor.
            if (this.duel?.slammed) return;
            const handled = this.engine.action(action, button.dataset.value);
            if (!handled) return;
            if (action === 'puzzle-pipe') this.stats.taps += 1;
            if (action === 'puzzle-reset') {
                this.stats.resets += 1;
                this.lockResets += 1;
            }
            this.saveStats();
            const state = this.engine.state;
            if (state?.solved) {
                this.sound.playSolveBlip();
            } else if (
                state?.refusalTick &&
                state.refusalTick !== this.lastRefusalTone
            ) {
                // A tap on a welded conductor answers with a dead clank,
                // not the cheerful tap.
                this.lastRefusalTone = state.refusalTick;
                this.sound.playClank();
            } else {
                this.sound.playTap();
            }
        }
    }

    // ── GameVolt (present only on gamevolt.io) ──

    gameVoltInit() {
        if (!window.GameVolt) return;
        try {
            GameVolt.init('short-circuit');
            if (GameVolt.save?.registerMigration) {
                GameVolt.save.registerMigration({
                    keys: [SC_KEYS.bests, SC_KEYS.daily, SC_KEYS.seen,
                           SC_MUTE_KEY],
                    merge: (local, cloud) => cloud || local || {},
                    getScores: local => {
                        const record = local?.[SC_KEYS.daily];
                        const streak = record?.streak || 0;
                        return streak > 0 ?
                            [{ score: streak, mode: 'daily-streak' }] :
                            [];
                    },
                    getAchievements: () => [],
                });
            }
        } catch { /* the portal is a bonus, never a blocker */ }
    }

    // ── renderers ──

    button(label, action, { value = null, primary = false } = {}) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'menu-button' +
            (primary ? ' menu-button--primary' : '');
        button.dataset.action = action;
        if (value !== null) button.dataset.value = String(value);
        button.textContent = label;
        return button;
    }

    lockTraits(entry) {
        const traits = [`${entry.size}×${entry.size}`];
        if (entry.branching) traits.push('two outlets');
        else if (entry.turnChance > 0) traits.push('winding');
        if (entry.welded > 0) {
            traits.push(`${entry.welded} weld${entry.welded === 1 ? '' : 's'}`);
        }
        return traits;
    }

    renderSelect() {
        const info = this.getDailyInfo();
        const daily = document.createElement('button');
        daily.type = 'button';
        daily.className = 'puzzle-grade-row is-daily';
        daily.dataset.action = 'daily';
        const medal = info.solvedToday && info.time > 0 ?
            lockMedal(info.entry, info.time) : null;
        const traits = this.lockTraits(info.entry);
        const streakNote = info.streak > 0 ?
            `streak ${info.streak} day${info.streak === 1 ? '' : 's'}` :
            'a fresh board every midnight';
        daily.innerHTML =
            '<span class="puzzle-grade-row__nr" aria-hidden="true">☀</span>' +
            '<span class="puzzle-grade-row__main"><strong></strong><small></small></span>' +
            `<span class="puzzle-grade-row__medal ${medal ? `is-${medal}` : 'is-none'}">` +
            `${medal ? medal.toUpperCase() : (info.solvedToday ? 'CLEAR' : '')}</span>`;
        daily.querySelector('strong').textContent =
            `${this.prettyDate(info.dateKey)} · ${traits.join(' · ')}`;
        daily.querySelector('small').textContent = info.solvedToday ?
            `Solved in ${info.time.toFixed(1)}s · ${streakNote}` :
            `Gold at ${info.entry.gold}s · ${streakNote}`;
        this.dom.dailyRow.replaceChildren(daily);

        this.dom.campaignRows.replaceChildren(...LOCK_CAMPAIGN.map(entry => {
            const unlocked = this.isLockUnlocked(entry.lock);
            const best = this.getBest(entry.lock);
            const rowMedal = best > 0 ? lockMedal(entry, best) : null;
            const traits = this.lockTraits(entry);

            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'puzzle-grade-row';
            row.dataset.action = 'start-lock';
            row.dataset.value = String(entry.lock);
            row.disabled = !unlocked;
            row.classList.toggle('is-locked', !unlocked);
            row.setAttribute('aria-label', unlocked ?
                `Start lock ${entry.lock}: ${traits.join(', ')}` :
                `Lock ${entry.lock}, locked. Solve lock ${entry.lock - 1} first.`);

            const nr = document.createElement('span');
            nr.className = 'puzzle-grade-row__nr';
            nr.setAttribute('aria-hidden', 'true');
            nr.textContent = String(entry.lock);

            const main = document.createElement('span');
            main.className = 'puzzle-grade-row__main';
            const title = document.createElement('strong');
            title.textContent = traits.join(' · ');
            const sub = document.createElement('small');
            sub.textContent = unlocked ?
                (best > 0 ?
                    `Best ${best.toFixed(1)}s · gold ${entry.gold}s` :
                    `Gold at ${entry.gold}s`) :
                `Solve lock ${entry.lock - 1} first`;
            main.append(title, sub);

            const badge = document.createElement('span');
            badge.className = 'puzzle-grade-row__medal ' +
                (rowMedal ? `is-${rowMedal}` : 'is-none');
            badge.textContent = rowMedal ?
                rowMedal.toUpperCase() :
                (best > 0 ? 'CLEAR' : (unlocked ? '' : '🔒'));

            row.append(nr, main, badge);
            return row;
        }));
    }

    prettyDate(dateKey) {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const [, month, day] = String(dateKey).split('-').map(Number);
        return `${months[(month || 1) - 1]} ${day || 1}`;
    }

    renderWon() {
        const result = this.lastResult;
        if (!result) return;
        this.dom.puzzleWonEyebrow.textContent = result.daily ?
            'Daily lock' : 'Circuit lock';
        this.dom.puzzleWonTitle.textContent = 'Circuit restored';
        this.dom.puzzleWonTime.textContent = `${result.seconds.toFixed(1)}s`;
        this.dom.puzzleWonBest.textContent = result.isBest ?
            (result.previousBest > 0 ?
                `New best · was ${result.previousBest.toFixed(1)}s` :
                'First clear') :
            `Best ${result.previousBest.toFixed(1)}s`;
        this.dom.puzzleWonBest.classList.toggle('is-record', result.isBest);

        const stats = [
            result.daily ?
                ['Daily lock', this.prettyDate(result.dateKey)] :
                ['Lock', `${result.lock} of ${LOCK_CAMPAIGN.length}`],
        ];
        if (result.daily) {
            stats.push([
                'Streak',
                `${result.streak} day${result.streak === 1 ? '' : 's'}` +
                (result.bestStreak > result.streak ?
                    ` · best ${result.bestStreak}` : ''),
            ]);
        }
        if (result.medal) {
            const names = { gold: 'Gold', silver: 'Silver', bronze: 'Bronze' };
            stats.push(['Medal', names[result.medal]]);
        } else if (result.goldTarget) {
            stats.push(['Gold at', `${result.goldTarget}s`]);
        }
        if (result.boardSize) {
            stats.push([
                'Board',
                `${result.boardSize}×${result.boardSize}` +
                (result.branching ? ' · branching' : ''),
            ]);
        }
        if (result.swaps !== null) {
            stats.push(['Swaps', String(result.swaps)]);
        }
        this.dom.puzzleWonStats.replaceChildren(...stats.map(([label, value]) => {
            const row = document.createElement('p');
            row.className = 'puzzle-won__stat';
            const name = document.createElement('span');
            name.textContent = label;
            const figure = document.createElement('b');
            figure.textContent = value;
            row.append(name, figure);
            return row;
        }));

        this.dom.puzzleWonActions.replaceChildren();
        if (!result.daily && result.lock < LOCK_CAMPAIGN.length) {
            this.dom.puzzleWonActions.append(this.button(
                `Lock ${result.lock + 1}`, 'won-next', { primary: true }
            ));
        }
        this.dom.puzzleWonActions.append(
            this.button('Run it again', 'won-again'),
            this.button('Back to the locks', 'won-menu')
        );
    }

    /**
     * The IN→OUT positions of the intended solution, walked on a virtual
     * board where every conductor sits at its solutionIndex. Cells only
     * ever swap (never rotate), so connections are intrinsic to each
     * cell and the trace is exact.
     */
    solutionRoute(state) {
        if (this.routeCache?.state === state) return this.routeCache.route;
        const solved = state.cells.map((unused, position) =>
            state.cells.find(cell => cell.solutionIndex === position));
        if (solved.some(cell => !cell)) return null;
        const steps = [
            { x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 },
        ];
        const route = [];
        const visited = new Set();
        let heads = [{ index: state.sourceY * state.size, incoming: 3 }];
        for (let pass = 0; pass < state.cells.length && heads.length; pass++) {
            const next = [];
            for (const head of heads) {
                if (visited.has(head.index)) return null;
                visited.add(head.index);
                route.push(head.index);
                const connections =
                    this.engine.getPipeConnections(solved[head.index]);
                if (!connections[head.incoming]) return null;
                const x = head.index % state.size;
                const y = Math.floor(head.index / state.size);
                for (let dir = 0; dir < 4; dir++) {
                    if (!connections[dir] || dir === head.incoming) continue;
                    if (
                        x === state.size - 1 && dir === 1 &&
                        state.sinks.includes(head.index)
                    ) continue;
                    const nx = x + steps[dir].x;
                    const ny = y + steps[dir].y;
                    if (nx < 0 || nx >= state.size ||
                        ny < 0 || ny >= state.size) return null;
                    next.push({
                        index: ny * state.size + nx,
                        incoming: (dir + 2) % 4,
                    });
                }
            }
            heads = next;
        }
        this.routeCache = { state, route };
        return route;
    }

    /**
     * The teacher's pointer: on the very first board, the exact next
     * cell to press — uncover the route, then each swap pair — until
     * the circuit closes and the current takes over.
     */
    teachingGuide(state) {
        if (!state?.teaching || state.solved) return null;
        if (state.phase === 'failed' || state.flowPhase === 'failed') {
            return null;
        }
        let route;
        try {
            route = this.solutionRoute(state);
        } catch {
            return null;      // guiden får aldrig fälla brädet
        }
        if (!route) return null;
        for (const position of route) {
            const resident = state.cells[position];
            if (!resident.revealed) {
                return {
                    stage: 'uncover',
                    targets: [{ index: position, role: 'tap' }],
                };
            }
            if (resident.welded || resident.solutionIndex === position) {
                continue;
            }
            const from = state.cells.findIndex(cell =>
                cell.solutionIndex === position && !cell.welded);
            if (from < 0) return null;
            if (!state.cells[from].revealed) {
                return {
                    stage: 'uncover',
                    targets: [{ index: from, role: 'tap' }],
                };
            }
            if (state.selectedIndex === position ||
                state.selectedIndex === from) {
                return {
                    stage: 'swap',
                    targets: [{
                        index: state.selectedIndex === position ?
                            from : position,
                        role: 'swap',
                    }],
                };
            }
            // Full instruction: take THIS conductor, put it THERE.
            return {
                stage: 'swap',
                targets: [
                    { index: from, role: 'take' },
                    { index: position, role: 'put' },
                ],
            };
        }
        return { stage: 'watch', targets: [] };
    }

    /**
     * The arc from "take" to "put here": a dashed amber line drawn over
     * the board, flowing toward the destination, with an arrowhead.
     * Coordinates are read after layout, so the line lands exactly.
     */
    drawGuideLink(board, [takeCell, putCell]) {
        if (!takeCell || !putCell) return;
        const boardRect = board.getBoundingClientRect();
        if (!boardRect.width) return;
        const centre = cell => {
            const r = cell.getBoundingClientRect();
            return {
                x: r.left + r.width / 2 - boardRect.left,
                y: r.top + r.height / 2 - boardRect.top,
            };
        };
        const a = centre(takeCell);
        const b = centre(putCell);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        // kontrollpunkten viker av vinkelrätt: en båge, inte ett streck
        const bend = Math.min(34, len * 0.25);
        const cx = (a.x + b.x) / 2 - (dy / len) * bend;
        const cy = (a.y + b.y) / 2 + (dx / len) * bend;
        // pilspetsen: riktningen i bågens slut är kontrollpunkt → mål
        const tipAngle = Math.atan2(b.y - cy, b.x - cx);
        const tip = (angle, dist) => `${b.x - Math.cos(angle) * dist},` +
            `${b.y - Math.sin(angle) * dist}`;
        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS, 'svg');
        svg.classList.add('guide-link');
        svg.setAttribute('viewBox', `0 0 ${boardRect.width} ${boardRect.height}`);
        svg.setAttribute('aria-hidden', 'true');
        const path = document.createElementNS(svgNS, 'path');
        path.setAttribute('d',
            `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`);
        const head = document.createElementNS(svgNS, 'polygon');
        head.setAttribute('points', `${b.x},${b.y} ` +
            tip(tipAngle - 0.42, 13) + ' ' + tip(tipAngle + 0.42, 13));
        svg.append(path, head);
        board.append(svg);
    }

    renderPuzzle(state) {
        const duel = this.duel;
        this.dom.puzzleEyebrow.textContent = duel ? 'Live duel' :
            state.dailyLock ? 'Daily lock' : 'Circuit lock';
        const label = duel ?
            `Round ${duel.round + 1} · first to ${Math.ceil(duel.bestOf / 2)}` :
            state.dailyLock ?
            `Daily lock · ${this.prettyDate(state.dailyLock)}` :
            `Lock ${state.difficulty} of ${LOCK_CAMPAIGN.length}`;
        this.dom.puzzleDifficulty.textContent = state.teaching && !duel ?
            `${label} · slow current` : label;
        this.dom.puzzleCopy.textContent = duel ?
            'Build the route — then SLAM THE BREAKER to stop your clock. ' +
            'The surge verifies the circuit; slam a broken one and the ' +
            'round is lost.' :
            state.teaching ?
            'Your first lock, and the current crawls on this one. Swap ' +
            'conductors until a route runs from IN to OUT. The next lock ' +
            'runs at full speed.' :
            'Uncover conductors and swap them into a route from IN to ' +
            'OUT — ahead of the current.';
        this.dom.puzzleStatus.textContent = state.status;
        // Rebuilds destroy the focused cell, so note where the keyboard
        // cursor stood and put it back on the fresh board below.
        const focusedCell =
            document.activeElement?.classList?.contains('puzzle-pipe-cell') ?
                Number(document.activeElement.dataset.value) : null;
        this.dom.puzzleBody.replaceChildren();
        this.dom.puzzleActions.replaceChildren();

        const failed = state.phase === 'failed' || state.timedOut === true;
        const shell = document.createElement('div');
        shell.className = 'puzzle-pipes is-pressure-flow';
        shell.classList.toggle('is-six', state.size === 6);
        shell.classList.toggle('is-failed', failed);
        shell.classList.toggle('is-solved', state.solved);

        const labels = document.createElement('div');
        labels.className = 'puzzle-pipes__labels';
        const anchorTotal = state.anchors.length;
        const anchorsPassed = state.anchors.filter(
            anchor => state.filled.has(anchor)
        ).length;
        labels.innerHTML =
            '<strong><i aria-hidden="true"></i> INPUT</strong>' +
            (anchorTotal > 0 ?
                '<span class="puzzle-pipes__anchors">WELDS ' +
                `${anchorsPassed}/${anchorTotal}</span>` :
                '<span>CURRENT</span>') +
            '<strong>OUT <i aria-hidden="true"></i></strong>';
        shell.append(labels);

        const board = document.createElement('div');
        board.className = 'puzzle-pipes__board';
        board.style.setProperty('--pipe-size', state.size);
        const grid = document.createElement('div');
        grid.className = 'puzzle-pipes__grid';
        grid.style.setProperty('--pipe-size', state.size);
        grid.classList.toggle('is-disabled', failed);
        this.pipeCells = [];
        state.cells.forEach((cell, index) => {
            const x = index % state.size;
            const y = Math.floor(index / state.size);
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'puzzle-pipe-cell';
            button.dataset.action = 'puzzle-pipe';
            button.dataset.value = String(index);
            button.disabled = failed || state.solved ||
                this.duel?.slammed === true;
            button.classList.toggle(
                'is-covered',
                !cell.revealed && !state.filled.has(index)
            );
            button.classList.toggle(
                'is-selected', state.selectedIndex === index
            );
            button.classList.toggle('is-locked', state.filled.has(index));
            button.classList.toggle('is-welded', cell.welded === true);
            // One shake per refusal: the class rides exactly one rebuild.
            button.classList.toggle(
                'is-refused',
                state.refusedIndex === index &&
                    state.refusalTick !== this.weldRefusalRendered
            );
            button.setAttribute(
                'aria-label', this.engine.getPipeLabel(index)
            );
            button.classList.toggle('is-flowing', state.connected.has(index));
            button.classList.toggle(
                'is-source', x === 0 && y === state.sourceY
            );
            button.classList.toggle('is-sink', state.sinks.includes(index));
            if (x === 0 && y === state.sourceY && !failed && !state.solved) {
                button.classList.add('puzzle-control--primary');
            }
            if (x === 0 && y === state.sourceY) {
                const port = document.createElement('span');
                port.className = 'puzzle-pipe-port puzzle-pipe-port--in';
                port.textContent = 'IN';
                port.setAttribute('aria-hidden', 'true');
                button.append(port);
            } else if (state.sinks.includes(index)) {
                const port = document.createElement('span');
                port.className = 'puzzle-pipe-port puzzle-pipe-port--out';
                port.textContent = 'OUT';
                port.setAttribute('aria-hidden', 'true');
                button.append(port);
            }

            const pipe = document.createElement('span');
            pipe.className = `puzzle-pipe puzzle-pipe--${cell.type}`;
            pipe.style.setProperty(
                '--pipe-rotation', `${cell.rotation * 90}deg`
            );
            if (cell.type === 'tee' || cell.type === 'cross') {
                const junction = document.createElement('span');
                junction.className = 'puzzle-pipe__junction';
                junction.setAttribute('aria-hidden', 'true');
                pipe.append(junction);
            }
            button.append(pipe);

            const trailEntry = (state.trail || []).find(
                entry => entry.index === index
            );
            if (trailEntry) {
                const edgePoints = [[50, 0], [100, 50], [50, 100], [0, 50]];
                const incoming = edgePoints[trailEntry.incoming];
                const trace = document.createElementNS(
                    'http://www.w3.org/2000/svg', 'svg'
                );
                trace.classList.add('puzzle-pipe-flow-trace');
                trace.setAttribute('viewBox', '0 0 100 100');
                trace.setAttribute('aria-hidden', 'true');
                trailEntry.outgoings.forEach(direction => {
                    const outgoing = edgePoints[direction];
                    const tracePath = document.createElementNS(
                        'http://www.w3.org/2000/svg', 'path'
                    );
                    tracePath.setAttribute(
                        'd',
                        `M ${incoming[0]} ${incoming[1]} ` +
                        `L 50 50 L ${outgoing[0]} ${outgoing[1]}`
                    );
                    tracePath.setAttribute('pathLength', '1');
                    trace.append(tracePath);
                });
                button.append(trace);
                if (trailEntry.outgoings.length === 1) {
                    const flowHead = document.createElement('span');
                    flowHead.className = 'puzzle-pipe-flow-head';
                    flowHead.setAttribute('aria-hidden', 'true');
                    button.append(flowHead);
                }
            }
            if (!cell.revealed && !state.filled.has(index)) {
                const cover = document.createElement('span');
                cover.className = 'puzzle-pipe-cover';
                cover.innerHTML =
                    '<i aria-hidden="true"></i><b aria-hidden="true">?</b>';
                button.append(cover);
            }
            grid.append(button);
            this.pipeCells[index] = button;
        });
        this.weldRefusalRendered = state.refusalTick;

        const guide = this.teachingGuide(state);
        this.guidePair = null;
        if (guide) {
            const chip = { tap: 'TAP', take: 'TAKE', put: 'PUT HERE', swap: 'SWAP' };
            shell.classList.toggle('has-guide', guide.targets.length > 0);
            guide.targets.forEach(target => {
                const cell = this.pipeCells[target.index];
                if (!cell) return;
                cell.classList.add('is-guided', `is-guided--${target.role}`);
                cell.dataset.guide = chip[target.role];
            });
            if (guide.targets.length === 2) {
                this.guidePair = guide.targets.map(
                    target => this.pipeCells[target.index]
                );
            }
        }

        // Solved: the win wave rides the route order — each cell knows
        // when it is its turn to flare.
        if (state.solved) {
            (state.trail || []).forEach((entry, order) => {
                this.pipeCells[entry.index]?.style.setProperty(
                    '--fire', String(order)
                );
            });
        }

        const inTerminal = document.createElement('span');
        inTerminal.className =
            'puzzle-pipes__terminal puzzle-pipes__terminal--in';
        inTerminal.style.setProperty('--terminal-row', state.sourceY);
        inTerminal.setAttribute('aria-hidden', 'true');
        board.append(grid, inTerminal);
        state.sinks.forEach(sinkIndex => {
            const outTerminal = document.createElement('span');
            outTerminal.className =
                'puzzle-pipes__terminal puzzle-pipes__terminal--out';
            outTerminal.style.setProperty(
                '--terminal-row', Math.floor(sinkIndex / state.size)
            );
            outTerminal.setAttribute('aria-hidden', 'true');
            board.append(outTerminal);
        });

        let failureBanner = null;
        if (failed) {
            const failure = document.createElement('div');
            failure.className = 'puzzle-pipes__failure';
            failure.setAttribute('role', 'alert');
            const failureIcon = document.createElement('span');
            failureIcon.className = 'puzzle-pipes__failure-icon';
            failureIcon.textContent = '!';
            failureIcon.setAttribute('aria-hidden', 'true');
            const failureCopy = document.createElement('span');
            const failureTitle = document.createElement('strong');
            const missedWeld = state.flowBlockedReason === 'anchor';
            failureTitle.textContent = missedWeld ?
                'WELD BYPASSED' : 'CIRCUIT BROKEN';
            const failureHint = document.createElement('small');
            failureHint.textContent =
                (Number.isInteger(state.flowBlockedIndex) ?
                    (missedWeld ?
                        'The weld is marked at row ' :
                        'The break is marked at row ') +
                    `${Math.floor(state.flowBlockedIndex / state.size) + 1}` +
                    ', column ' +
                    `${state.flowBlockedIndex % state.size + 1}. ` :
                    'Study how the conductors sit before trying again. ') +
                'Same board next try — and the worn mechanism will ' +
                'run slower.';
            failureCopy.append(failureTitle, failureHint);
            failure.append(failureIcon, failureCopy);
            failureBanner = failure;
        }

        const legend = document.createElement('div');
        legend.className = 'puzzle-pipes__legend';
        legend.innerHTML = anchorTotal > 0 ?
            '<span><b>1</b> Uncover</span>' +
            '<span><b>2</b> Swap</span>' +
            '<span class="puzzle-pipes__anchors"><b>!</b> ' +
            'Gold is welded — can&#39;t move, must be on the route</span>' :
            '<span><b>1</b> Uncover</span>' +
            '<span><b>2</b> Mark</span>' +
            '<span><b>3</b> Swap</span>';
        if (failureBanner) shell.append(failureBanner);
        shell.append(legend, board);
        this.dom.puzzleBody.append(shell);
        if (this.guidePair) this.drawGuideLink(board, this.guidePair);

        if (this.duel) {
            // A duel has no restarts and no way back — only the breaker
            // and, for the defeated, the door.
            if (!failed && !state.solved && !this.duel.slammed) {
                const slam = this.button(
                    'SLAM THE BREAKER', 'versus-slam', { primary: true }
                );
                slam.classList.add('breaker', 'breaker--slam');
                this.dom.puzzleActions.append(slam);
            }
            this.dom.puzzleActions.append(
                this.button('Forfeit duel', 'versus-forfeit')
            );
        } else {
            if (failed) {
                this.dom.puzzleActions.append(
                    this.button('Try again', 'puzzle-reset', { primary: true })
                );
            } else if (!state.solved) {
                this.dom.puzzleActions.append(
                    this.button('Restart circuit', 'puzzle-reset')
                );
            }
            if (!state.solved) {
                this.dom.puzzleActions.append(
                    this.button('Back to the locks', 'puzzle-close')
                );
            }
        }
        this.syncFlow(state);

        if (this.focusBoardOnRender) {
            this.focusBoardOnRender = false;
            this.focusBoardCell(null);
        } else if (focusedCell !== null) {
            this.restoreBoardFocus(focusedCell);
        }
    }

    syncFlow(state) {
        if (!state || this.pipeCells.length === 0) return;
        const presentation = this.engine.getPipeFlowPresentation(
            state, this.reducedMotion
        );
        this.pipeCells.forEach((cell, index) => {
            cell.classList.toggle(
                'is-flowing', presentation.visible.has(index)
            );
            cell.classList.toggle(
                'is-flow-head', presentation.leading.has(index)
            );
            cell.classList.toggle(
                'is-pulse-blocked', presentation.blocked.has(index)
            );
            if (!presentation.leading.has(index)) return;

            const entry = presentation.trail.find(
                item => item.index === index
            );
            if (!entry) return;
            const edgePoints = [[50, 11], [89, 50], [50, 89], [11, 50]];
            const incoming = edgePoints[entry.incoming];
            const outgoing = edgePoints[entry.outgoings[0]];
            if (!incoming || !outgoing) return;
            const progress = Math.max(
                0, Math.min(1, Number(presentation.progress) || 0)
            );
            const legProgress = progress < 0.5 ?
                progress * 2 : (progress - 0.5) * 2;
            const from = progress < 0.5 ? incoming : [50, 50];
            const to = progress < 0.5 ? [50, 50] : outgoing;
            const x = from[0] + (to[0] - from[0]) * legProgress;
            const y = from[1] + (to[1] - from[1]) * legProgress;
            cell.style.setProperty('--flow-head-x', `${x}%`);
            cell.style.setProperty('--flow-head-y', `${y}%`);
            cell.querySelectorAll('.puzzle-pipe-flow-trace path')
                .forEach(trace => {
                    trace.style.strokeDashoffset = String(1 - progress);
                });
        });
    }
}

// ── boot ──
(async () => {
    const sdk = cgSdk();
    if (sdk?.init) {
        try {
            await Promise.race([
                sdk.init(),
                new Promise(resolve => setTimeout(resolve, 2500)),
            ]);
        } catch { /* the game does not depend on the platform */ }
        try { sdk.game?.loadingStart?.(); } catch { /* optional */ }
    }
    try {
        // On window for the test harness and the console alike.
        window.shortCircuit = new ShortCircuit();
    } catch (err) {
        scFault('boot', err);
    }
    try { sdk?.game?.loadingStop?.(); } catch { /* optional */ }
})();
