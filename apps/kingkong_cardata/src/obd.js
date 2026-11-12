'use strict';
/*
 * OBD service 0x01 helpers for kingkong_cardata (pure, no I/O, Node 8).
 *  - PID table: key, data length, decode (SAE J1979)
 *  - multi-PID requests: up to 6 PIDs in one request (ISO 15031-5), the answer is
 *    41 PID data PID data ...  -> one TASU round trip instead of six
 *  - supported-PID bitmaps (PIDs 00/20/40/60/80/A0)
 *  - gear estimate from rpm / speed for when no bus source sends the gear
 */
const PIDS = {
    0x04: ['load', 1, (d) => d[0] * 100 / 255],               // %
    0x05: ['coolant', 1, (d) => d[0] - 40],                   // °C
    0x0A: ['lpfp', 1, (d) => d[0] * 0.03],                    // bar, fuel pressure (gauge), 3 kPa per bit
    0x0B: ['map', 1, (d) => d[0]],                            // kPa absolute, max 255 (= 1.5 bar boost)
    0x0C: ['rpm', 2, (d) => (d[0] * 256 + d[1]) / 4],
    0x0D: ['speed', 1, (d) => d[0]],                          // km/h
    0x0E: ['timing', 1, (d) => d[0] / 2 - 64],                // ° before TDC
    0x0F: ['iat', 1, (d) => d[0] - 40],                       // °C
    0x10: ['maf', 2, (d) => (d[0] * 256 + d[1]) / 100],       // g/s
    0x11: ['throttle', 1, (d) => d[0] * 100 / 255],           // %
    0x23: ['hpfp', 2, (d) => (d[0] * 256 + d[1]) * 0.1],      // bar, fuel rail gauge pressure (direct injection), 10 kPa per bit
    0x33: ['baro', 1, (d) => d[0]],                           // kPa
    0x45: ['throttleRel', 1, (d) => d[0] * 100 / 255],        // %, 0 = closed
    0x46: ['ambient', 1, (d) => d[0] - 40],                   // °C
    0x49: ['pedalD', 1, (d) => d[0] * 100 / 255],             // % absolute (≈15 at rest)
    0x52: ['ethanol', 1, (d) => d[0] * 100 / 255],             // % ethanol (Reflex/CAN via MHD)
    0x5C: ['oil', 1, (d) => d[0] - 40],                       // °C
    0x5A: ['pedalRel', 1, (d) => d[0] * 100 / 255],           // %, 0 = released
    0x5E: ['fuelRate', 2, (d) => (d[0] * 256 + d[1]) * 0.05], // l/h, the engine's fuel rate (1.3.0: a reference for Trips)
    0x61: ['demandTorquePct', 1, (d) => d[0] - 125],          // % of reference torque
    0x62: ['torquePct', 1, (d) => d[0] - 125],
    0x63: ['refTorque', 2, (d) => d[0] * 256 + d[1]],         // Nm
    // kPa absolute, boost pressure sensor A (A1 = supported) else B (A3), 1/32 kPa; B-C / F-G = commanded A / B (A0 / A2):
    // boostT, the boost target's fallback on Fuel (1.3.0)
    0x70: ['boostP', 10, (d) => (d[0] & 2 ? (d[3] * 256 + d[4]) / 32 : d[0] & 8 ? (d[7] * 256 + d[8]) / 32 : undefined),
        { boostT: (d) => (d[0] & 1 ? (d[1] * 256 + d[2]) / 32 : d[0] & 4 ? (d[5] * 256 + d[6]) / 32 : undefined) }],
    0x87: ['mapX', 5, (d) => (d[0] & 1 ? (d[1] * 256 + d[2]) / 32 : undefined)],   // kPa absolute, sensor A (A0 = supported), 1/32 kPa
    0xA4: ['gear', 4, (d) => (d[0] & 2 ? d[1] >> 4 : undefined)],   // A1 = gear valid, B7..B4 = gear
};
const SUPPORT = [0x00, 0x20, 0x40, 0x60, 0x80, 0xA0];          // 4-byte bitmaps of the next 32 PIDs

const key = (pid) => (PIDS[pid] ? PIDS[pid][0] : `pid${pid.toString(16)}`);

// bytes after the 0x41 of a positive answer -> { values: { key: number }, supported: [pid...] }
function parse(bytes) {
    const values = {}, supported = [];
    let i = 0;
    while (i < bytes.length) {
        const pid = bytes[i];
        if (SUPPORT.indexOf(pid) >= 0) {
            if (i + 5 > bytes.length) break;
            for (let b = 0; b < 32; b++) if (bytes[i + 1 + (b >> 3)] & (0x80 >> (b & 7))) supported.push(pid + 1 + b);
            i += 5;
            continue;
        }
        const p = PIDS[pid];
        if (!p || i + 1 + p[1] > bytes.length) break;   // unknown length: the rest can't be read
        const data = bytes.slice(i + 1, i + 1 + p[1]);
        values[p[0]] = p[2](data);
        if (p[3]) Object.keys(p[3]).forEach((k) => { values[k] = p[3][k](data); });   // more values in the same answer
        i += 1 + p[1];
    }
    return { values, supported };
}

// ZF 8HP ratios. k = engine rpm per km/h in the 1:1 gear (final drive x 1000 / (60 x tyre circumference))
const RATIOS = [5.0, 3.2, 2.143, 1.72, 1.313, 1.0, 0.823, 0.64];
// -> { gear, k } ; gear undefined while stopped, slipping or shifting. k is learned a little from
// every clear match.
// ponytail: fixed 8HP table; a manual / DCT car needs its own RATIOS
function estimateGear(rpm, kmh, k) {
    if (!(kmh > 8 && rpm > 600 && k > 0)) return { gear: undefined, k };
    const r = rpm / kmh / k;
    let best = 0, err = Infinity;
    RATIOS.forEach((g, i) => { const e = Math.abs(Math.log(r / g)); if (e < err) { err = e; best = i; } });
    if (err > 0.08) return { gear: undefined, k };
    return { gear: best + 1, k: err < 0.04 ? k * 0.98 + (rpm / kmh / RATIOS[best]) * 0.02 : k };
}

module.exports = { PIDS, SUPPORT, key, parse, estimateGear, RATIOS };
