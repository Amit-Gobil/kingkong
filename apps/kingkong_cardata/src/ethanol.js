'use strict';
/*
 * ethanol.js - etanol % for Kingkong (G81 + Motive ReFlex / MHD-style).
 *
 * Motive ReFlex / FlexFuel+ / Zeitronix ECA (MHD “MOTIV” / “Zeitronix ECA” presets)
 * broadcast on PT-CAN:
 *   CAN ID  0x0EC  (11-bit standard), 500 kbit/s, ~4 Hz
 *   Format  ECA / ReFlex (same preset Send ID on FlexFuel+):
 *     byte0  ethanol % as u8 0..100
 *     byte1  fuel temperature as u8, °C = raw - 40
 *     byte7  sensor status (0 = ok, 1 = fault) on Zeitronix ECA-2
 *
 * The MGU app has no raw PT-CAN socket. When MHD (or BM3/JB4) ingests 0xEC,
 * the DME typically exposes the same % as OBD mode 01 PID 0x52 (A * 100/255).
 * Stock BMW UDS DID 550D (PROZENT_ALK_KRST, ×0.39215686) is the fallback and
 * is often empty on petrol G81 without factory flex fuel.
 *
 * Priority: OBD 52 (Reflex/CAN via DME) → UDS 550D → null (-- on UI).
 */
const CAN = {
    id: 0x0EC,
    bitrate: 500000,
    rateHz: 4,
    format: 'ECA/ReFlex',
    // decode a raw 8-byte PT-CAN payload (for tests / future bridge)
    decodeFrame(bytes) {
        if (!bytes || bytes.length < 1) return null;
        const pct = bytes[0] | 0;
        if (pct > 100) return null;
        const fault = bytes.length > 7 ? (bytes[7] | 0) : 0;
        if (fault === 1) return null;
        const out = { pct, src: 'can-0xEC' };
        if (bytes.length > 1) out.tempC = (bytes[1] | 0) - 40;
        return out;
    },
};

const FRESH_MS = 8000;

/** Mutable ethanol state used by main.js. */
function createEthanol() {
    return {
        pct: null,           // number 0..100 or null
        src: null,           // 'obd52' | 'uds550D' | 'can-0xEC' | null
        at: 0,
        tempC: null,
    };
}

function setOk(state, pct, src, now, tempC) {
    if (typeof pct !== 'number' || !isFinite(pct) || pct < 0 || pct > 100) return false;
    state.pct = Math.round(pct);
    state.src = src;
    state.at = now || Date.now();
    if (tempC !== undefined && tempC !== null) state.tempC = tempC;
    return true;
}

/** OBD PID 0x52: A * 100/255 (SAE J1979) — preferred Reflex/CAN mirror. */
function fromObd52(rawA, state, now) {
    if (typeof rawA !== 'number' || !isFinite(rawA)) return false;
    return setOk(state, rawA * 100 / 255, 'obd52', now);
}

/** UDS 22 550D reply bytes (full UDS incl. 62 55 0D …) or data-only u8. */
function fromUds550D(uds, state, now) {
    if (!uds || !uds.length) return false;
    let raw;
    if (uds[0] === 0x62 && uds.length >= 4) raw = uds[3];
    else if (uds[0] === 0x7F) return false;
    else raw = uds[0];
    if (typeof raw !== 'number') return false;
    // catalog scale; if that collapses a plausible 0..100 raw, keep the raw
    const scaled = raw * 0.39215686;
    const pct = (raw >= 5 && raw <= 100 && scaled < 5) ? raw : scaled;
    return setOk(state, pct, 'uds550D', now);
}

/** Apply a sniffed 0xEC frame if a future bridge delivers one. */
function fromCanEc(bytes, state, now) {
    const d = CAN.decodeFrame(bytes);
    if (!d) return false;
    return setOk(state, d.pct, d.src, now, d.tempC);
}

function value(state, now) {
    now = now || Date.now();
    if (state.pct === null || state.pct === undefined) return null;
    if (state.at && now - state.at > FRESH_MS * 4) return state.pct; // keep last for UI; still show
    return state.pct;
}

function label(state) {
    if (!state || !state.src) return 'Etanol';
    if (state.src === 'obd52') return 'Etanol · Reflex/CAN';
    if (state.src === 'uds550D') return 'Etanol · UDS 550D';
    if (state.src === 'can-0xEC') return 'Etanol · CAN 0xEC';
    return 'Etanol';
}

module.exports = {
    CAN, createEthanol, setOk, fromObd52, fromUds550D, fromCanEc, value, label, FRESH_MS,
    // self-check
    test: function () {
        const assert = require('assert');
        const s = createEthanol();
        assert(fromCanEc([70, 80, 0, 0, 0, 0, 0, 0], s));
        assert.strictEqual(s.pct, 70);
        assert.strictEqual(s.src, 'can-0xEC');
        assert.strictEqual(s.tempC, 40);
        assert(fromObd52(Math.round(85 * 255 / 100), s));
        assert.strictEqual(s.pct, 85);
        assert.strictEqual(s.src, 'obd52');
        assert(fromUds550D([0x62, 0x55, 0x0D, 178], s)); // 178*0.392≈70
        assert.strictEqual(s.pct, 70);
        assert.strictEqual(CAN.id, 0x0EC);
        console.log('ethanol self-check ok');
    },
};

if (require.main === module) module.exports.test();
