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
});

const scStore = {
    get(key) {
        try { return localStorage.getItem(key); } catch { return null; }
    },
    set(key, value) {
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
            if (event.key !== 'Escape') return;
            if (this.screen === 'puzzle') this.leavePuzzle();
            else if (this.screen === 'select') this.showTitle();
        });

        this.syncMute();
        this.syncTitleNote();
        this.gameVoltInit();
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
            const traces = [];
            const seedRandom = this.engine.createRandom(
                this.engine.hashSeed(`bg:${w}x${h}`)
            );
            for (let i = 0; i < 8; i++) {
                const points = [{
                    x: seedRandom() * w,
                    y: seedRandom() * h,
                }];
                let horizontal = seedRandom() < 0.5;
                for (let s = 0; s < 5; s++) {
                    const last = points[points.length - 1];
                    const run = 60 + seedRandom() * 180;
                    const sign = seedRandom() < 0.5 ? -1 : 1;
                    points.push(horizontal ?
                        { x: last.x + run * sign, y: last.y } :
                        { x: last.x, y: last.y + run * sign });
                    horizontal = !horizontal;
                }
                traces.push(points);
            }
            this.bgTraces = traces;
            this.bgSparks = [0, 1, 2].map(i => ({
                trace: i % traces.length,
                t: i * 0.33,
                speed: 0.05 + i * 0.02,
            }));
            this.bgStatic = null;   // omritas
        };
        build();
        window.addEventListener('resize', build);
    }

    drawBackdrop(dt) {
        const ctx = this.bgCtx;
        if (!ctx || !this.bgTraces) return;
        const w = this.bgCanvas.width;
        const h = this.bgCanvas.height;
        ctx.clearRect(0, 0, w, h);

        ctx.lineWidth = 1.2;
        ctx.strokeStyle = 'rgba(115, 232, 246, 0.05)';
        ctx.fillStyle = 'rgba(115, 232, 246, 0.09)';
        this.bgTraces.forEach(points => {
            ctx.beginPath();
            points.forEach((pt, i) =>
                i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y));
            ctx.stroke();
            points.forEach(pt => {
                ctx.beginPath();
                ctx.arc(pt.x, pt.y, 1.6, 0, Math.PI * 2);
                ctx.fill();
            });
        });

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

    syncTitleNote() {
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

    startLock(lock) {
        if (
            !Number.isInteger(lock) || lock < 1 ||
            lock > LOCK_CAMPAIGN.length || !this.isLockUnlocked(lock)
        ) return false;
        const entry = LOCK_CAMPAIGN[lock - 1];
        // The very first lock ever is a lesson: its current crawls.
        const teaching = !this.hasSeenLock();
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
        this.setScreen('puzzle');
        this.sound.playConfirm();
        try { cgSdk()?.game?.gameplayStart?.(); } catch { /* optional */ }
    }

    leavePuzzle() {
        if (this.engine.state?.solved) return;
        this.engine.clear();
        this.activeDaily = null;
        try { cgSdk()?.game?.gameplayStop?.(); } catch { /* optional */ }
        this.showSelect();
    }

    // ── completing locks ──

    complete() {
        const state = this.engine.state;
        if (!state?.solved) return false;
        const seconds = Math.round(state.elapsed * 10) / 10;
        this.lastResult = state.dailyLock ?
            this.summariseDaily(state, seconds) :
            this.summariseCampaign(state, seconds);
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
        return true;
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

        const previousFill = state.filled.size;
        const previousPhase = state.flowPhase;

        if (this.engine.update(dt)) {
            this.complete();
            return;
        }
        if (state.filled.size > previousFill) this.sound.playCircuitStep();
        if (previousPhase !== 'failed' && state.flowPhase === 'failed') {
            this.fx('is-brownout');
            this.sound.playCircuitFail();
        }

        if (this.engine.revision !== this.renderedRevision) {
            this.renderedRevision = this.engine.revision;
            this.renderPuzzle(state);
        } else {
            this.syncFlow(state);
            this.dom.puzzleStatus.textContent = state.status;
        }
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
            const handled = this.engine.action(action, button.dataset.value);
            if (!handled) return;
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

    renderPuzzle(state) {
        this.dom.puzzleEyebrow.textContent = state.dailyLock ?
            'Daily lock' : 'Circuit lock';
        const label = state.dailyLock ?
            `Daily lock · ${this.prettyDate(state.dailyLock)}` :
            `Lock ${state.difficulty} of ${LOCK_CAMPAIGN.length}`;
        this.dom.puzzleDifficulty.textContent = state.teaching ?
            `${label} · slow current` : label;
        this.dom.puzzleCopy.textContent = state.teaching ?
            'Your first lock, and the current crawls on this one. Swap ' +
            'conductors until a route runs from IN to OUT. The next lock ' +
            'runs at full speed.' :
            'Uncover conductors and swap them into a route from IN to ' +
            'OUT — ahead of the current.';
        this.dom.puzzleStatus.textContent = state.status;
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
            button.disabled = failed || state.solved;
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
        this.syncFlow(state);
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
