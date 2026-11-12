'use strict';
/*
 * ethanol.js — etanol % for Kingkong on Amit’s G81 (S58) + Motive ReFlex + MHD+.
 *
 * Evidence (Amit MHD Monitor log, 2026-09-26):
 *   CALID 00008A51145047 / PRGID 00005C64145007 / VIN WBS11GB04PFP58981
 *   Column "Ethanol Content (Active) (%)" ≈ 78, with ReFlex Aux columns present.
 *   MHD docs: Active = ethanol used in custom DME calc (≈ CAN unless tuner override).
 *
 * HU has no PT-CAN. MHD Active lives in DME RAM (Monitor reads it over the WiFi
 * adapter via proprietary memory requests). Closest standard UDS mirrors on BMW
 * MG1/B48–style PID tables (same family as S58 DME8):
 *   22 59 39  — "Ethanol content at the injection valve"  ≈ Active / fueling
 *              u16 × 0.00003052 (= /32768) → 0..1 fraction → ×100 = %
 *   22 59 38  — "Ethanol content - raw value from the sensor" ≈ CAN/ECA
 *              same scale
 * Stock DME8FF_R also lists 550D (PROZENT_ALK_KRST, ×0.39215686) — often empty
 * on petrol G81 without factory flex. OBD 01 52 / UDS F4 52 kept as aftermarket
 * mirrors. Prefer 5939 → 5938 → OBD52 → F452 → 550D.
 */
const CAN_IDS = [0x0EC, 0x0ED, 0x334, 0x4CB];
const FRAC = 1 / 32768; // BMW table multiply 0.00003052

const CAN = {
    ids: CAN_IDS, id: 0x0EC, bitrate: 500000, rateHz: 4, format: 'ECA/ReFlex/MHD-FlexFuel',
    decodeFrame(bytes) {
        if (!bytes || bytes.length < 1) return null;
        const pct = bytes[0] | 0;
        if (pct > 100) return null;
        const st = bytes.length > 7 ? (bytes[7] | 0) : (bytes.length > 6 ? (bytes[6] | 0) : 0);
        if (st === 1 || st === 2) return null;
        const out = { pct, src: 'can-0xEC' };
        if (bytes.length > 1) out.tempC = (bytes[1] | 0) - 40;
        return out;
    },
};

function createEthanol() {
    return {
        pct: null, src: null, at: 0, tempC: null,
        debug: {
            d5939: 'not asked yet',
            d5938: 'not asked yet',
            obd52: 'not asked yet',
            f452: 'not asked yet',
            d550D: 'not asked yet',
            note: 'MHD Active≈5939; sensor/CAN≈5938 (u16/32768)',
        },
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

function decodeByte(raw) {
    if (typeof raw !== 'number' || !isFinite(raw) || raw < 0) return null;
    raw = raw | 0;
    if (raw > 255) return null;
    if (raw <= 100) return raw;
    return +(raw * 100 / 255).toFixed(0);
}

/** u16 BMW ethanol fraction → % ; also accept single-byte direct %. */
function decodePayload(payload) {
    if (!payload || !payload.length) return null;
    if (payload.length === 1) return decodeByte(payload[0]);
    const u16 = ((payload[0] & 255) << 8) | (payload[1] & 255);
    // Primary: fraction 0..1 → %
    let pct = u16 * FRAC * 100;
    if (pct >= 0 && pct <= 100.5) return +pct.toFixed(1);
    // Fallback: already stored as centi-% or direct 0..100 in low byte
    if (payload[0] === 0 && payload[1] <= 100) return payload[1];
    if (u16 <= 10000 && u16 >= 0) {
        const c = u16 / 100;
        if (c <= 100) return +c.toFixed(1);
    }
    return null;
}

function udsPayload(uds) {
    if (!uds || !uds.length) return { err: 'no reply' };
    if (uds[0] === 0x7F) return { err: 'NRC ' + (uds.length > 2 ? uds[2].toString(16) : '?') };
    if (uds[0] === 0x62 && uds.length >= 4) return { data: uds.slice(3), hex: uds.slice(0, Math.min(uds.length, 7)).map((b) => b.toString(16).padStart(2, '0')).join(' ') };
    return { data: uds, hex: uds.slice(0, Math.min(uds.length, 5)).map((b) => b.toString(16).padStart(2, '0')).join(' ') };
}

function fromUds5939(uds, state, now) {
    const p = udsPayload(uds);
    if (p.err) { state.debug.d5939 = p.err; return false; }
    const pct = decodePayload(p.data);
    state.debug.d5939 = (p.hex || '') + ' → ' + (pct == null ? 'bad' : pct + '%');
    return pct == null ? false : setOk(state, pct, 'uds5939', now);
}

function fromUds5938(uds, state, now) {
    const p = udsPayload(uds);
    if (p.err) { state.debug.d5938 = p.err; return false; }
    const pct = decodePayload(p.data);
    state.debug.d5938 = (p.hex || '') + ' → ' + (pct == null ? 'bad' : pct + '%');
    return pct == null ? false : setOk(state, pct, 'uds5938', now);
}

function fromObd52Byte(rawA, state, now) {
    state.debug.obd52 = 'raw=' + rawA;
    const pct = decodeByte(rawA);
    if (pct === null) { state.debug.obd52 += ' · bad'; return false; }
    state.debug.obd52 += ' → ' + pct + '%';
    return setOk(state, pct, 'obd52', now);
}

function fromUdsF452(uds, state, now) {
    const p = udsPayload(uds);
    if (p.err) { state.debug.f452 = p.err; return false; }
    let raw;
    if (uds[0] === 0x62 && uds.length >= 4 && uds[1] === 0xF4 && uds[2] === 0x52) raw = uds[3];
    else raw = p.data[p.data.length - 1];
    state.debug.f452 = 'raw=' + raw;
    const pct = decodeByte(raw);
    if (pct === null) { state.debug.f452 += ' · bad'; return false; }
    state.debug.f452 += ' → ' + pct + '%';
    return setOk(state, pct, 'udsF452', now);
}

function fromUds550D(uds, state, now) {
    const p = udsPayload(uds);
    if (p.err) { state.debug.d550D = p.err; return false; }
    const raw = p.data[0] | 0;
    const scaled = raw * 0.39215686;
    const pct = (raw >= 5 && raw <= 100 && scaled < 5) ? raw : scaled;
    state.debug.d550D = 'raw=' + raw + ' → ' + Math.round(pct) + '%';
    return setOk(state, pct, 'uds550D', now);
}

function fromCanEc(bytes, state, now) {
    const d = CAN.decodeFrame(bytes);
    if (!d) return false;
    return setOk(state, d.pct, d.src, now, d.tempC);
}

function value(state) {
    if (!state || state.pct === null || state.pct === undefined) return null;
    return state.pct;
}

function label(state) {
    if (!state || !state.src) return 'Etanol';
    if (state.src === 'uds5939') return 'Etanol · MHD Active (5939)';
    if (state.src === 'uds5938') return 'Etanol · MHD sensor (5938)';
    if (state.src === 'obd52') return 'Etanol · OBD 52 / Reflex';
    if (state.src === 'udsF452') return 'Etanol · UDS F452 / Reflex';
    if (state.src === 'uds550D') return 'Etanol · UDS 550D';
    if (state.src === 'can-0xEC') return 'Etanol · CAN 0xEC';
    return 'Etanol';
}

function debugRows(state) {
    const d = (state && state.debug) || {};
    return [
        ['UDS 5939 Active', d.d5939 || '--'],
        ['UDS 5938 sensor', d.d5938 || '--'],
        ['OBD 01 52', d.obd52 || '--'],
        ['UDS 22 F452', d.f452 || '--'],
        ['UDS 22 550D', d.d550D || '--'],
        ['Source', state && state.src ? (state.src + ' · ' + state.pct + '%') : 'none'],
    ];
}

/** Probe table for main.js rotation (MHD Active first). */
const PROBES = [
    { key: '5939', bytes: [0x22, 0x59, 0x39], apply: fromUds5939 },
    { key: '5938', bytes: [0x22, 0x59, 0x38], apply: fromUds5938 },
    { key: 'F452', bytes: [0x22, 0xF4, 0x52], apply: fromUdsF452 },
    { key: '550D', bytes: [0x22, 0x55, 0x0D], apply: fromUds550D },
];

module.exports = {
    CAN, CAN_IDS, FRAC, PROBES, createEthanol, setOk, decodeByte, decodePayload,
    fromUds5939, fromUds5938, fromObd52Byte, fromUdsF452, fromUds550D, fromCanEc,
    value, label, debugRows,
    test: function () {
        const assert = require('assert');
        const s = createEthanol();
        // 78% → u16 = round(0.78 * 32768) = 25559
        const raw = Math.round(0.78 * 32768);
        assert(fromUds5939([0x62, 0x59, 0x39, (raw >> 8) & 255, raw & 255], s));
        assert.strictEqual(s.pct, 78);
        assert.strictEqual(s.src, 'uds5939');
        assert(fromUds5938([0x62, 0x59, 0x38, (raw >> 8) & 255, raw & 255], s));
        assert.strictEqual(s.src, 'uds5938');
        assert(fromObd52Byte(78, s));
        assert(fromUdsF452([0x62, 0xF4, 0x52, 78], s));
        assert(fromUds550D([0x62, 0x55, 0x0D, 178], s));
        assert(debugRows(s)[0][0].indexOf('5939') >= 0);
        assert.strictEqual(PROBES[0].key, '5939');
        console.log('ethanol self-check ok (5939 Active @78%)');
    },
};

if (require.main === module) module.exports.test();
