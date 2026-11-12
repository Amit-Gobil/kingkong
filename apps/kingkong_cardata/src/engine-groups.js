// Ported from cauliflowermossgrape/idrive7-apps (MIT License, Copyright (c) 2026 cauliflowermossgrape): apps/live_data/useful.js, builtin/DME8FF_R.json, kit/runtime/sgbd.js @ c67ea17.
'use strict';
/*
 * engine-groups.js - the engine unit's (DME 0x12, SGBD DME8FF_R: S58 and B48) live values in groups for
 * Kingkong · Details. Pure, I/O injected, Node 8. Read-only: the caller sends UDS 22 <DID> and nothing else.
 *
 *   readAll(read) -> Promise<{ groups: [{ group, values: [{ name, text, value, unit }] }], read: n, of: m }>
 *       read(did): did is a number (0x4402); resolves the reply bytes after 62 <DID hi> <DID lo>;
 *       resolves null when refused (7F 31 / 12: never asked again), rejects when there is no answer this
 *       time (a timeout: asked again on the next pass). Each value takes the first candidate that answers;
 *       values (and groups) that nothing answered are left out. One request at a time.
 *   decode(entry, bytes) -> { raw, value, text? } or null (reply too short / unknown type)
 *   refused: Set of DIDs that refused once; never asked again (refused.clear() for another car).
 *
 * The catalog is engine-groups-catalog.js (checked against PRG FILES/dme8ff_r.prg).
 */
const CATALOG = require('./engine-groups-catalog.js');

const SIZE = { u8: 1, s8: 1, u16: 2, s16: 2, u32: 4, s32: 4, f32: 4 };
// SGBD unit -> shown unit -> factor
const CONVERT = {
    hPa: { bar: 0.001 }, kPa: { bar: 0.01 }, MPa: { bar: 10 }, 'ml/s': { 'l/h': 3.6 },
    cl: { l: 0.01 }, min: { h: 1 / 60 }, s: { h: 1 / 3600 }, '°CA': { '°': 1 },
};

const refused = new Set();

/** one value from the data bytes after the DID: raw x k + o (type, offset, bit mask, byte order, value table) */
function decode(entry, bytes) {
    const n = SIZE[entry.t], at = entry.at || 0;
    if (!n || !bytes || bytes.length < at + n) return null;
    const b = Array.prototype.slice.call(bytes, at, at + n);
    if (entry.le) b.reverse();
    let raw;
    if (entry.t === 'f32') {
        raw = Buffer.from(b).readFloatBE(0);
        if (!isFinite(raw)) return null;
    } else {
        raw = b.reduce((a, x) => a * 256 + x, 0);
        if (entry.m) raw = ((raw & entry.m) >>> 0) / ((entry.m & -entry.m) >>> 0);   // masked bits moved down to bit 0
        else if (entry.t[0] === 's' && raw >= Math.pow(2, 8 * n - 1)) raw -= Math.pow(2, 8 * n);
    }
    const out = { raw, value: raw * (entry.k == null ? 1 : entry.k) + (entry.o || 0) };
    if (entry.e && entry.e[raw] !== undefined) out.text = entry.e[raw];
    return out;
}

/** a candidate's value in the item's unit, or null when it means "no data" */
function valueOf(item, c, bytes) {
    const x = decode(c, bytes);
    if (!x || (item.bad && item.bad.indexOf(x.raw) >= 0)) return null;
    if (x.text !== undefined) return { value: x.raw, text: x.text };
    let v = x.value * (c.u && c.u !== item.unit ? CONVERT[c.u][item.unit] : 1);
    if (item.unit === '°C' && v < -45) return null;      // an unset sensor reads -48 or -273
    if (item.lin) v = item.lin[0] + item.lin[1] * v;
    return { value: v };
}

function text(item, v) {
    if (v.text !== undefined) return v.text;
    const s = v.value.toFixed(item.d == null ? 2 : item.d).replace(/^-(0(\.0+)?)$/, '$1');   // no "-0.0"
    return item.unit ? s + ' ' + item.unit : s;
}

async function readAll(read) {
    const asked = {};                                    // this pass: did -> Promise<bytes|null>
    const ask = (did) => {
        const id = parseInt(did, 16);
        if (refused.has(id)) return Promise.resolve(null);
        if (!asked[did]) {
            asked[did] = Promise.resolve().then(() => read(id))
                .then((b) => { if (!b) refused.add(id); return b || null; }, () => null);   // rejected: no refusal
        }
        return asked[did];
    };
    const one = async (item, c) => { const b = await ask(c.did); return b ? valueOf(item, c, b) : null; };
    async function itemValue(item) {
        if (item.minus) {
            const a = await one(item, item.minus[0]), b = a && await one(item, item.minus[1]);
            return b ? { value: a.value - b.value } : null;
        }
        for (const c of item.c) { const v = await one(item, c); if (v) return v; }
        return null;
    }
    const groups = [];
    let n = 0, of = 0;
    for (const g of CATALOG.groups) {
        const values = [];
        for (const item of g.items) {
            of++;
            const v = await itemValue(item);
            if (v) { n++; values.push({ name: item.name, text: text(item, v), value: v.value, unit: item.unit }); }
        }
        if (values.length) groups.push({ group: g.group, values });
    }
    return { groups, read: n, of };
}

async function test() {
    const assert = require('assert');
    const cand = (did) => {
        for (const g of CATALOG.groups) for (const it of g.items) for (const c of (it.c || []).concat(it.minus || [])) if (c.did === did) return c;
        throw new Error('no ' + did);
    };
    const B = (a) => Buffer.from(a);
    // decoding, with the catalog's entries
    assert.strictEqual(decode(cand('4402'), B([0x00, 0xA0])).value, 0.75 * 160 - 48);       // oil temperature 72 °C
    assert.strictEqual(decode(cand('4A49'), B([0xFF, 0x9C])).raw, -100);                    // s16 two's complement
    assert.strictEqual(+decode(cand('4A49'), B([0xFF, 0x9C])).value.toFixed(3), -10);
    assert.strictEqual(decode(cand('4402'), B([0x00])), null);                              // too short
    assert.strictEqual(decode(cand('4A36'), B([1])).text, 'yes');                           // value table
    assert.strictEqual(decode({ did: '411A', at: 4, t: 'u32', u: 's' }, B([0, 0, 0, 0, 0, 0, 0x0E, 0x10, 0])).value, 3600);
    assert.strictEqual(decode({ t: 'u16', m: 0x0FF0, le: true }, B([0x34, 0x12])).raw, 0x23);   // mask + low byte first
    assert.strictEqual(decode({ t: 'u32', m: 0xFF000000 }, B([0xFE, 0, 0, 0])).raw, 0xFE);       // stays unsigned
    assert.strictEqual(decode({ t: 'f32', k: 2 }, B([0x3F, 0xC0, 0, 0])).value, 3);
    // the catalog: known types, every unit shown or converted, no Valvetronic (the S58 has none)
    assert.deepStrictEqual(CATALOG.groups.map((g) => g.group), ['Engine', 'Temperatures', 'Oil', 'Fuel', 'Ignition and knock', 'VANOS', 'Injector corrections']);
    CATALOG.groups.forEach((g) => g.items.forEach((it) => (it.c || []).concat(it.minus || []).forEach((c) => {
        assert(SIZE[c.t], c.did + ' type');
        assert(!c.u || c.u === it.unit || (CONVERT[c.u] && CONVERT[c.u][it.unit]), c.did + ' unit ' + c.u + ' -> ' + it.unit);
        assert(c.did !== '4602' && c.did !== '4603', 'Valvetronic');
    })));

    // readAll with a fake engine unit: the rest refuses (null or rejects)
    refused.clear();
    const car = {
        0x4807: [0x0F, 0xA0],                            // 4000 x 0.5 = 2000 rpm
        0x4300: null, 0x5805: [0x0B, 0x8D],              // coolant: first refuses, second 2957 x 0.1 - 273.14 = 22.56
        0x4402: [0x00, 0xA0], 0x4408: [0, 0],            // oil 72 °C; sump unset (-273) -> left out
        0x5817: [0x0A, 0xAB],                            // outside 2731 x 0.1 - 273.14 = -0.04 -> "0.0 °C"
        0x4436: [0x0F, 0xA0], 0x4201: [0x64, 0x00],      // 4000 hPa abs, 25600 x 0.0390625 = 1000 hPa
        0x5811: [255], 0x442F: [150],                    // oil level: 255 = no data, next candidate 1.50 l
        0x5776: [0], 0x4A36: [1], 0x5889: [0x10, 0x00],  // RON 98, knock yes, lambda 1.000
        0x58EF: [0x9C, 0x40],                            // 40000 x 0.0005 MPa = 20 MPa = 200 bar
    };
    const calls = {};
    const read = (did) => {
        calls[did] = (calls[did] || 0) + 1;
        // vehicle speed: no answer on the first pass (a timeout), 50 km/h on the next
        if (did === 0x4AB1) return calls[did] === 1 ? Promise.reject(new Error('timeout')) : Promise.resolve(B([0x13, 0x88]));
        return Promise.resolve(car[did] ? B(car[did]) : null);
    };
    const r = await readAll(read);
    const val = (name) => { for (const g of r.groups) for (const v of g.values) if (v.name === name) return v; return null; };
    assert.strictEqual(r.of, 76);
    assert.strictEqual(r.read, 11);
    assert.strictEqual(val('Coolant').text, '23 °C');
    assert.strictEqual(val('Engine oil (after filter)').text, '72 °C');
    assert.strictEqual(val('Engine oil in the sump'), null);
    assert.strictEqual(val('Outside').text, '0.0 °C');
    assert.strictEqual(val('Oil pressure').text, '3.00 bar');
    assert.strictEqual(val('Oil pressure (absolute)').text, '4.00 bar');
    assert.strictEqual(val('Oil level above minimum').text, '1.50 l');
    assert.strictEqual(val('Fuel quality (adapted)').text, '98.0 RON');
    assert.deepStrictEqual(val('Knock detected'), { name: 'Knock detected', text: 'yes', value: 1, unit: '' });
    assert.strictEqual(val('Lambda').text, '1.000');
    assert.strictEqual(val('High pressure fuel (rail)').text, '200 bar');
    assert.strictEqual(val('Vehicle speed'), null);                                         // no answer (yet)
    assert.deepStrictEqual(r.groups.map((g) => g.group), ['Engine', 'Temperatures', 'Oil', 'Fuel', 'Ignition and knock', 'Injector corrections']);
    assert.deepStrictEqual(r.groups[0].values, [{ name: 'Engine speed', text: '2000 rpm', value: 2000, unit: 'rpm' }]);
    assert.strictEqual(calls[0x4436], 1);                                                   // two values, one request
    assert(refused.has(0x4300) && !refused.has(0x4AB1) && !refused.has(0x4402), 'refused: null only; a timeout is no refusal');
    // the second pass skips what refused, asks the timed-out one again
    const before = Object.keys(calls).length, r2 = await readAll(read);
    assert.strictEqual(r2.read, 12);
    assert.strictEqual(r2.groups[0].values[1].text, '50 km/h');
    assert.strictEqual(calls[0x4300], 1);
    assert.strictEqual(calls[0x4AB1], 2);
    assert.strictEqual(calls[0x4402], 2);
    assert.strictEqual(Object.keys(calls).length, before);
    refused.clear();
    console.log('engine-groups self-check ok: ' + r.read + ' of ' + r.of + ' values read, ' + before + ' DIDs asked');
}

module.exports = { readAll, decode, refused, CATALOG, test };
if (require.main === module) test().catch((e) => { console.error(e); process.exit(1); });
