'use strict';
/*
 * ethanol.js - etanol % for Kingkong on G81 + Motive ReFlex / MHD.
 *
 * ReFlex / FlexFuel+ / Zeitronix / MHD ECA broadcast on PT-CAN (500 kbit/s):
 *   Send IDs used in the wild (Motive + MG Flasher + TRP):
 *     0x0EC  — N54/B58/S58 MHD “Zeitronix ECA” / FlexFuel+ ReFlex&ECA presets (most G-series)
 *     0x0ED  — TRP duplicate frame (same payload layout)
 *     0x334  — S55/N55F MHD / EcuTek ReFlex send ID
 *     0x4CB  — MG Flasher “Universal canbus” alternate
 *   ECA / ReFlex / MHD FlexFuel payload (8 bytes):
 *     byte0  ethanol % u8 0..100
 *     byte1  fuel temp u8, °C = raw - 40
 *     byte2..5  often static/duplicate (TRP: 0x05,0x44, then E% and temp again)
 *     byte6/7  sensor status (0=ok)
 *
 * The MGU has no PT-CAN socket. MHD ingests those frames into the DME; we read
 * mirrors over TASU, forcing probes even when the DME omits PID 0x52 from its
 * “supported PIDs” bitmap (common — 1.2.1 never asked 0x52 for that reason):
 *   1) OBD 01 52          (forced; raw byte as % if 0..100, else A*100/255)
 *   2) UDS 22 F4 52       (ISO OBD-PID-via-UDS mapping)
 *   3) UDS 22 550D        (stock BMW PROZENT_ALK_KRST ×0.39215686, or raw 0..100)
 *
 * Settings debug keeps the last raw attempt per path.
 */
const CAN_IDS = [0x0EC, 0x0ED, 0x334, 0x4CB];

const CAN = {
    ids: CAN_IDS,
    id: 0x0EC,
    bitrate: 500000,
    rateHz: 4,
    format: 'ECA/ReFlex/MHD-FlexFuel',
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
        pct: null,
        src: null,
        at: 0,
        tempC: null,
        debug: {
            obd52: 'not asked yet',
            f452: 'not asked yet',
            d550D: 'not asked yet',
            note: 'CAN 0xEC/0xED/0x334/0x4CB → DME; HU reads mirrors',
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
    if (raw <= 100) return raw;                 // direct % (Reflex/MHD mirror)
    return +(raw * 100 / 255).toFixed(0);       // SAE J1979
}

function fromObd52Byte(rawA, state, now) {
    state.debug.obd52 = 'raw=' + rawA;
    const pct = decodeByte(rawA);
    if (pct === null) { state.debug.obd52 += ' · bad'; return false; }
    state.debug.obd52 += ' → ' + pct + '%';
    return setOk(state, pct, 'obd52', now);
}

function fromUdsF452(uds, state, now) {
    if (!uds || !uds.length) { state.debug.f452 = 'no reply'; return false; }
    if (uds[0] === 0x7F) {
        state.debug.f452 = 'NRC ' + (uds.length > 2 ? uds[2].toString(16) : '?');
        return false;
    }
    let raw;
    if (uds[0] === 0x62 && uds.length >= 4) {
        if (uds[1] === 0xF4 && uds[2] === 0x52) raw = uds[3];
        else raw = uds[uds.length - 1];
    } else raw = uds[0];
    state.debug.f452 = 'raw=' + raw;
    const pct = decodeByte(raw);
    if (pct === null) { state.debug.f452 += ' · bad'; return false; }
    state.debug.f452 += ' → ' + pct + '%';
    return setOk(state, pct, 'udsF452', now);
}

function fromUds550D(uds, state, now) {
    if (!uds || !uds.length) { state.debug.d550D = 'no reply'; return false; }
    if (uds[0] === 0x7F) {
        state.debug.d550D = 'NRC ' + (uds.length > 2 ? uds[2].toString(16) : '?');
        return false;
    }
    let raw;
    if (uds[0] === 0x62 && uds.length >= 4) raw = uds[3];
    else raw = uds[0];
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
    if (state.src === 'obd52') return 'Etanol · OBD 52 / Reflex';
    if (state.src === 'udsF452') return 'Etanol · UDS F452 / Reflex';
    if (state.src === 'uds550D') return 'Etanol · UDS 550D';
    if (state.src === 'can-0xEC') return 'Etanol · CAN 0xEC';
    return 'Etanol';
}

function debugRows(state) {
    const d = (state && state.debug) || {};
    return [
        ['OBD 01 52', d.obd52 || '--'],
        ['UDS 22 F452', d.f452 || '--'],
        ['UDS 22 550D', d.d550D || '--'],
        ['CAN IDs', '0xEC 0xED 0x334 0x4CB'],
        ['Source', state && state.src ? (state.src + ' · ' + state.pct + '%') : 'none'],
    ];
}

module.exports = {
    CAN, CAN_IDS, createEthanol, setOk, decodeByte,
    fromObd52Byte, fromUdsF452, fromUds550D, fromCanEc,
    value, label, debugRows,
    test: function () {
        const assert = require('assert');
        const s = createEthanol();
        assert(fromCanEc([70, 80, 5, 0x44, 70, 80, 0, 0], s));
        assert.strictEqual(s.pct, 70);
        assert(fromObd52Byte(85, s));
        assert.strictEqual(s.pct, 85);
        assert(fromObd52Byte(217, s));
        assert.strictEqual(s.pct, 85);
        assert(fromUdsF452([0x62, 0xF4, 0x52, 60], s));
        assert.strictEqual(s.pct, 60);
        assert.strictEqual(s.src, 'udsF452');
        assert(fromUds550D([0x62, 0x55, 0x0D, 178], s));
        assert(debugRows(s)[3][1].indexOf('0xEC') >= 0);
        console.log('ethanol self-check ok');
    },
};

if (require.main === module) module.exports.test();
