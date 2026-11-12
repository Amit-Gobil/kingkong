'use strict';
/**
 * KingKong Race: head-to-head drag mode. v1 runs solo (practice) and is built so the
 * online room drops in later: the tree runs on the monotonic clock, each car measures its
 * own run locally with a RunTimer, so the result never depends on network latency.
 *
 * Phases: idle (lobby) -> count (tree) -> armed (green shown, waiting for launch)
 *         -> run (timing) -> result; or foul when the car moves before green.
 * The green moment is kept so the reaction time is green -> launch, like a real tree.
 */
const { RunTimer, LAUNCH_KMH } = require('./timer.js');

const READY_MS = 6000;      // "get ready" countdown before the tree, so both drivers can prepare
const PRE_MIN_MS = 300;     // a short, slightly random pause before the first amber so the green can't be timed
const PRE_RND_MS = 700;
const STEP_MS = 500;        // amber to amber
const GREEN_AFTER_MS = 500; // last amber to green

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
function roomCode() {
    let s = '';
    for (let i = 0; i < 4; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    return s;
}

class Race {
    constructor(splits, opts) {
        this.splits = splits;
        this.now = (opts && opts.now) || (() => 0);
        this.timer = new RunTimer(splits, { onDone: (run) => this._done(run) });
        this.reset();
    }

    /** The car must be standing with a speed signal to stage. */
    canStart(signal, speed) { return !!signal && typeof speed === 'number' && speed <= LAUNCH_KMH; }

    reset() {
        this.phase = 'idle';
        this.code = roomCode();
        this.lights = { staged: false, amber: [false, false, false], green: false };
        this.greenAt = null;
        this.reaction = null;
        this.result = {};
        this.trap = {};
        this.timer.reset();
    }

    /** Begin the ready countdown, then the tree. */
    start() {
        if (this.phase === 'ready' || this.phase === 'count' || this.phase === 'armed' || this.phase === 'run') return;
        this.goAt = this.now() + READY_MS;        // 6 s to get ready; the tree times are set when it ends
        this.t1 = this.t2 = this.t3 = this.tGreen = null;
        this.lights = { staged: true, amber: [false, false, false], green: false };
        this.greenAt = null;
        this.reaction = null;
        this.result = {};
        this.trap = {};
        this.timer.reset();
        this.phase = 'ready';
    }

    /** Called often (every ~50 ms) so the countdown, tree and timer advance without new speed samples. */
    tick(now) {
        if (this.phase === 'ready') {
            this.timer.idle(now);
            if (now >= this.goAt) {
                this.t1 = now + PRE_MIN_MS + Math.random() * PRE_RND_MS;
                this.t2 = this.t1 + STEP_MS;
                this.t3 = this.t2 + STEP_MS;
                this.tGreen = this.t3 + GREEN_AFTER_MS;
                this.phase = 'count';
            }
            return;
        }
        if (this.phase === 'count' || this.phase === 'armed') {
            this.timer.idle(now);
            this.lights.amber[0] = now >= this.t1;
            this.lights.amber[1] = now >= this.t2;
            this.lights.amber[2] = now >= this.t3;
            if (this.phase === 'count' && now >= this.tGreen) {
                this.phase = 'armed';
                this.greenAt = now;
                this.lights.green = true;
            }
        } else if (this.phase === 'run') {
            this.timer.idle(now);
        }
    }

    /** A speed sample (time ms, km/h). */
    feed(t, v) {
        if (this.phase === 'ready' || this.phase === 'count') {
            this.timer.feed(t, v);
            if (typeof v === 'number' && v > LAUNCH_KMH) this.phase = 'foul'; // moved before green
            return;
        }
        if (this.phase === 'armed') {
            this.timer.feed(t, v);
            if (this.timer.state === 'run') {
                this.phase = 'run';
                this.reaction = Math.max(0, (this.timer.tLaunch - this.greenAt) / 1000);
            }
            return;
        }
        if (this.phase === 'run') this.timer.feed(t, v);
    }

    _done(run) {
        this.result = Object.assign({}, run.result);
        this.trap = Object.assign({}, run.trap);
        this.phase = 'result';
    }

    model() {
        return {
            phase: this.phase, code: this.code, lights: this.lights,
            reaction: this.reaction, result: this.result, trap: this.trap,
            elapsed: this.timer.elapsed(this.now()),
            ready: this.phase === 'ready' ? Math.max(0, Math.ceil((this.goAt - this.now()) / 1000)) : null,
        };
    }
}

module.exports = { Race, roomCode };
