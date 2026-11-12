'use strict';
/*
 * ethanol.js — ethanol % for Kingkong G81 + Motive ReFlex + MHD+.
 *
 * Amit MHD Monitor log: "Ethanol Content (Active) (%)" ≈ 78
 * (CALID 00008A51145047 / PRGID 00005C64145007). Active is MHD custom RAM;
 * Monitor reads it over WiFi. HU probes DME UDS/OBD mirrors:
 *   5939 / 5938 — B48 MG1 ethanol DIDs (may NRC on S58)
 *   593A       — DME8FF oil+alcohol mass (debug only, not %)
 *   550D       — stock PROZENT_ALK_KRST
 *   OBD 01 52 / UDS F4 52 — aftermarket mirrors
 * UI always shows "Ethanol XX %" or "Ethanol -- %" (short label).
 */
const CAN_IDS = [0x0EC, 0x0ED, 0x334, 0x4CB];
const FRAC = 1 / 32768;

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
            d5939: 'not asked', d5938: 'not asked', d593A: 'not asked',
            obd52: 'not asked', f452: 'not asked', d550D: 'not asked',
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

function decodePayload(payload) {
    if (!payload || !payload.length) return null;
    if (payload.length === 1) return decodeByte(payload[0]);
    const u16 = ((payload[0] & 255) << 8) | (payload[1] & 255);
    let pct = u16 * FRAC * 100;
    if (pct >= 0 && pct <= 100.5) return +pct.toFixed(1);
    if (payload[0] === 0 && payload[1] <= 100) return payload[1];
    if (u16 <= 10000) {
        const c = u16 / 100;
        if (c <= 100) return +c.toFixed(1);
    }
    // last resort: low byte as direct %
    if (payload[payload.length - 1] <= 100) return payload[payload.length - 1];
    return null;
}

function hexOf(uds, n) {
    n = n || 8;
    return (uds || []).slice(0, Math.min((uds && uds.length) || 0, n)).map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

function udsPayload(uds) {
    if (!uds || !uds.length) return { err: 'no reply' };
    if (uds[0] === 0x7F) return { err: 'NRC ' + (uds.length > 2 ? uds[2].toString(16) : '?'), hex: hexOf(uds) };
    if (uds[0] === 0x62 && uds.length >= 4) return { data: uds.slice(3), hex: hexOf(uds) };
    return { data: uds, hex: hexOf(uds) };
}

function fromUds5939(uds, state, now) {
    const p = udsPayload(uds);
    if (p.err) { state.debug.d5939 = p.err; return false; }
    const pct = decodePayload(p.data);
    state.debug.d5939 = p.hex + (pct == null ? ' · nodecode' : ' → ' + pct + '%');
    return pct == null ? false : setOk(state, pct, 'uds5939', now);
}

function fromUds5938(uds, state, now) {
    const p = udsPayload(uds);
    if (p.err) { state.debug.d5938 = p.err; return false; }
    const pct = decodePayload(p.data);
    state.debug.d5938 = p.hex + (pct == null ? ' · nodecode' : ' → ' + pct + '%');
    return pct == null ? false : setOk(state, pct, 'uds5938', now);
}

/** 593A = oil+alcohol mass (g) — debug only, never drives the % gauge. */
function fromUds593A(uds, state) {
    const p = udsPayload(uds);
    if (p.err) { state.debug.d593A = p.err; return false; }
    state.debug.d593A = p.hex + ' (oil mass, not %)';
    return false;
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

/** Short UI label — never a long source string (that broke Fuel miniTile). */
function label() { return 'Ethanol'; }

function sourceLine(state) {
    if (!state) return 'no probe yet';
    if (state.src && state.pct != null) return 'source ' + state.src;
    const d = state.debug || {};
    // show first non-default probe result for the strip
    const order = ['d5939', 'd5938', 'obd52', 'f452', 'd550D', 'd593A'];
    for (let i = 0; i < order.length; i++) {
        const v = d[order[i]];
        if (v && v !== 'not asked') return order[i].replace(/^d/, '') + ': ' + v;
    }
    return 'waiting for DME…';
}

/** "Ethanol 78 %" or "Ethanol -- %" */
function displayText(state) {
    const v = value(state);
    return 'Ethanol ' + (v == null ? '--' : String(v)) + ' %';
}

function debugRows(state) {
    const d = (state && state.debug) || {};
    return [
        ['5939 Active?', d.d5939 || '--'],
        ['5938 sensor?', d.d5938 || '--'],
        ['593A oildbg', d.d593A || '--'],
        ['OBD 01 52', d.obd52 || '--'],
        ['UDS F452', d.f452 || '--'],
        ['UDS 550D', d.d550D || '--'],
        ['UI', displayText(state) + (state && state.src ? ' · ' + state.src : '')],
    ];
}

const PROBES = [
    { key: '5939', bytes: [0x22, 0x59, 0x39], apply: fromUds5939 },
    { key: '5938', bytes: [0x22, 0x59, 0x38], apply: fromUds5938 },
    { key: '550D', bytes: [0x22, 0x55, 0x0D], apply: fromUds550D },
    { key: 'F452', bytes: [0x22, 0xF4, 0x52], apply: fromUdsF452 },
    { key: '593A', bytes: [0x22, 0x59, 0x3A], apply: fromUds593A },
];

module.exports = {
    CAN, CAN_IDS, FRAC, PROBES, createEthanol, setOk, decodeByte, decodePayload,
    fromUds5939, fromUds5938, fromUds593A, fromObd52Byte, fromUdsF452, fromUds550D, fromCanEc,
    value, label, sourceLine, displayText, debugRows,
    test: function () {
        const assert = require('assert');
        const s = createEthanol();
        const raw = Math.round(0.78 * 32768);
        assert(fromUds5939([0x62, 0x59, 0x39, (raw >> 8) & 255, raw & 255], s));
        assert.strictEqual(s.pct, 78);
        assert.strictEqual(label(), 'Ethanol');
        assert.strictEqual(displayText(s), 'Ethanol 78 %');
        assert(displayText(createEthanol()) === 'Ethanol -- %');
        fromUds593A([0x62, 0x59, 0x3A, 0x01, 0x00], s);
        assert(s.debug.d593A.indexOf('oil') >= 0);
        assert.strictEqual(s.pct, 78); // 593A must not clear %
        console.log('ethanol self-check ok');
    },
};

if (require.main === module) module.exports.test();
