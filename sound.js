// The circuit's voice — a trimmed cut of Manny the Mole's ArcadeSound.
// Samples decode on the first unlock; until they land (or if they never
// do) every call falls through to the procedural tone it was written
// against, so the game is never silent while it waits.

const SC_MUTE_KEY = 'short-circuit:muted';

class CircuitSound {
    constructor() {
        this.context = null;
        this.noiseBuffer = null;
        this.muted = this.loadMuted();
        this.platformMuted = false;
        this.samples = new Map();
        this.samplesRequested = false;
    }

    loadSamples() {
        if (this.samplesRequested || typeof SFX_DATA === 'undefined') return;
        const context = this.context;
        if (!context) return;
        this.samplesRequested = true;

        Object.entries(SFX_DATA).forEach(([name, base64]) => {
            let bytes;
            try {
                const binary = atob(base64);
                bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) {
                    bytes[i] = binary.charCodeAt(i);
                }
            } catch {
                return;
            }
            context.decodeAudioData(
                bytes.buffer,
                buffer => this.samples.set(name, {
                    buffer,
                    gain: this.levellingGain(buffer),
                }),
                () => {}
            );
        });
    }

    levellingGain(buffer, target = 0.7, maxBoost = 6) {
        let peak = 0;
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
            const samples = buffer.getChannelData(channel);
            for (let i = 0; i < samples.length; i++) {
                const value = Math.abs(samples[i]);
                if (value > peak) peak = value;
            }
        }
        if (peak < 0.0001) return 0;
        return Math.min(maxBoost, target / peak);
    }

    playSample(name, { volume = 1, rate = 1, delay = 0 } = {}) {
        if (this.muted || this.platformMuted) return true;
        const context = this.unlock();
        if (!context) return true;
        const entry = this.samples.get(name);
        if (!entry || entry.gain === 0) return false;

        const source = context.createBufferSource();
        const gain = context.createGain();
        source.buffer = entry.buffer;
        source.playbackRate.value = rate;
        gain.gain.value = entry.gain * volume;
        source.connect(gain);
        gain.connect(context.destination);
        source.start(context.currentTime + delay);
        return true;
    }

    loadMuted() {
        try {
            return localStorage.getItem(SC_MUTE_KEY) === '1';
        } catch {
            return false;
        }
    }

    setMuted(muted) {
        this.muted = Boolean(muted);
        try {
            localStorage.setItem(SC_MUTE_KEY, this.muted ? '1' : '0');
        } catch {
            // storage blocked still mutes, just not across visits
        }
        return this.muted;
    }

    toggleMuted() {
        return this.setMuted(!this.muted);
    }

    unlock() {
        if (this.muted || this.platformMuted) return null;
        const AudioContextClass =
            window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return null;

        if (!this.context) {
            // A throw here would take the button press with it; a silent
            // game still beats no game.
            try {
                this.context = new AudioContextClass();
                const count = Math.floor(this.context.sampleRate * 0.5);
                this.noiseBuffer = this.context.createBuffer(
                    1, count, this.context.sampleRate
                );
                const samples = this.noiseBuffer.getChannelData(0);
                for (let i = 0; i < count; i++) {
                    samples[i] = Math.random() * 2 - 1;
                }
            } catch (err) {
                console.warn('Audio unavailable, continuing silent', err);
                this.context = null;
                this.noiseBuffer = null;
                return null;
            }
        }

        if (this.context.state === 'suspended') {
            this.context.resume().catch(() => {});
        }
        this.loadSamples();
        return this.context;
    }

    playTone(startFrequency, endFrequency, duration, volume,
             type = 'square', delay = 0) {
        const context = this.unlock();
        if (!context) return;

        const startTime = context.currentTime + delay;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = type;
        oscillator.frequency.setValueAtTime(startFrequency, startTime);
        oscillator.frequency.exponentialRampToValueAtTime(
            Math.max(20, endFrequency),
            startTime + duration
        );
        gain.gain.setValueAtTime(0.0001, startTime);
        gain.gain.exponentialRampToValueAtTime(volume, startTime + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(startTime);
        oscillator.stop(startTime + duration + 0.01);
    }

    playNoise(duration, volume, frequency) {
        const context = this.unlock();
        if (!context || !this.noiseBuffer) return;

        const now = context.currentTime;
        const source = context.createBufferSource();
        const filter = context.createBiquadFilter();
        const gain = context.createGain();
        source.buffer = this.noiseBuffer;
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(frequency, now);
        filter.Q.setValueAtTime(0.8, now);
        gain.gain.setValueAtTime(volume, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
        source.connect(filter);
        filter.connect(gain);
        gain.connect(context.destination);
        source.start(now, Math.random() * 0.08, duration);
    }

    // — the circuit's own cues —

    /** One relay throw as the current moves to the next conductor. */
    playCircuitStep() {
        if (this.playSample('circuit-step', { volume: 0.3, rate: 1.25 })) {
            return;
        }
        this.playTone(240, 180, 0.05, 0.022, 'square');
    }

    playCircuitFail() {
        if (this.playSample('circuit-fail', { volume: 0.55 })) return;
        this.playTone(180, 60, 0.28, 0.05, 'sawtooth');
        this.playNoise(0.22, 0.03, 320);
    }

    /** The surge as the finished route lights up. */
    playSurge() {
        if (this.playSample('circuit-solved', { volume: 0.55, rate: 0.98 })) {
            return;
        }
        this.playTone(330, 510, 0.11, 0.045, 'square');
        this.playTone(495, 720, 0.1, 0.03, 'square', 0.045);
    }

    /**
     * The big win: the circuit closes and the lock gives up. The surge
     * keeps its identity, the vault door lands under it, and a four-note
     * fanfare climbs an octave on top.
     */
    playTriumph() {
        this.playSurge();
        this.playSample('vault-open', { volume: 0.7, delay: 0.25 });
        this.playTone(65, 52, 0.5, 0.034, 'triangle', 0.2);
        this.playTone(523, 523, 0.11, 0.045, 'square', 0.32);
        this.playTone(659, 659, 0.11, 0.045, 'square', 0.44);
        this.playTone(784, 784, 0.11, 0.045, 'square', 0.56);
        this.playTone(1047, 1047, 0.34, 0.048, 'square', 0.68);
        this.playTone(1319, 1568, 0.4, 0.016, 'sine', 0.74);
    }

    /** A welded conductor refusing the tap: a dead clank, no bite. */
    playClank() {
        this.playTone(1150, 760, 0.05, 0.034, 'square');
        this.playTone(190, 130, 0.09, 0.028, 'triangle', 0.01);
    }

    playConfirm() {
        if (this.playSample('menu-confirm', { volume: 0.32 })) return;
        this.playTone(420, 640, 0.07, 0.03, 'square');
    }

    /** The small tap acknowledgement inside the board. */
    playTap() {
        this.playTone(420, 560, 0.055, 0.018, 'square');
    }

    /** The action that completed the route, before the current races. */
    playSolveBlip() {
        this.playTone(520, 880, 0.18, 0.04, 'square');
    }
}

globalThis.CircuitSound = CircuitSound;
