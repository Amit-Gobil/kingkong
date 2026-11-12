// Ported from cauliflowermossgrape/idrive7-apps (MIT License, Copyright (c) 2026 cauliflowermossgrape): apps/zf8hp/reader.js, egs.js, catalog.js @ c67ea17.
'use strict';

/*
 * Kingkong · Transmission: read-only ZF 8HP data from the gearbox unit (EGS, 0x18). Pure; the I/O is injected:
 *   read(addr, bytes) -> Promise of the unit's UDS reply (Buffer or byte array, from its service byte: 62 .. /
 *   59 .. / 7F ..) or null. Reads are sequential; the gap between them is the caller's (the kit waits 180 ms).
 * Only 22 <a DID of the catalog below> and 19 02 0C are ever built - request() throws on anything else - and
 * nothing but 22 F150 is asked before it names a variant the kit's decoders were checked on.
 * Schemas: the kit's catalog (BMW/ZF GSZFBCE.prg revision 15.000). Adaptation words are little endian, the
 * thermal histogram and shaft speeds big endian. A reply must match its DID and exact length, else it is an error.
 */

const EGS = 0x18;
const FAULTS = Buffer.from([0x19, 0x02, 0x0C]);   // pending + confirmed faults

// name, field count, byte width, little endian, signed, factor, offset, unit (the kit's catalog.js: the records read here)
const DEFS = {
    F150: ['SGBD_IDENTIFICATION', 0],
    6000: ['_GETRIEBEOELTEMPERATUR', 1, 1, false, false, 1, -40, '°C'],
    6081: ['_BETRIEBSZEIT_DER_EGS_OHNE_STANDBY', 1, 4, false, true, 1, 0, 'min'],
    DA2E: ['ISTGANG', 2, 1, false, false, 1, 0, '0-n'],              // gear code, selector
    DA2A: ['EINAUSGANG_DREHZAHL', 2, 2, false, true, 1, 0, '1/min'],  // turbine (input), output
    DA34: ['MOTORDREHZAHL', 1, 2, false, false, 1, 0, 'U/min'],
    DA22: ['WANDLERKUPPLUNG', 1, 2, false, true, 1, 0, '0-n'],
    '413A': ['ADAPTIONSWERTE_KPF', 5, 2, true, true, 1, 0, 'mbar'],  // fill pressure, packs A-E
    4140: ['ADAPTIONSWERTE_KSF', 5, 2, true, true, 1, 0, 'ms'],      // fast-fill time correction
    4130: ['ADAPTIONSWERTE_KSFCTR', 5, 2, true, false, 1, 0, ''],    // fast-fill evaluations
    4131: ['ADAPTIONSWERTE_KPFCTR', 5, 2, true, false, 1, 0, ''],    // fill-pressure evaluations
    4441: ['OELTEMPERATURKOLLEKTIV', 23, 4, false, false, 1, 0, 's'], // seconds per oil temperature band
};
const records = {};
Object.keys(DEFS).forEach((id) => {
    const d = DEFS[id];
    records[id] = { name: d[0], length: d[1] ? d[1] * d[2] : null,
        fields: Array.from({ length: d[1] }, (_, i) => ({ at: i * d[2], bytes: d[2], little: d[3],
            signed: d[4], factor: d[5], offset: d[6], unit: d[7] })) };
});

// 22 F150 identifications the kit's decoders were checked on. 0F21E0 (G20 330e) has no torque converter (no slip)
// and its 4441 has another length (raw only); the kit's refused-record list for it holds none of the records above.
const VARIANTS = {
    '0F25D0': { name: 'GSZFBCE', converter: true, layouts: {} },
    '0F21E0': { name: '8HP hybrid', converter: false, layouts: { 4441: { raw: true } } },
};
const RANGES = ['-40..-20', '-19..0', '1..20', '21..40', '41..60', '61..70', '71..80', '81..90', '91..95', '96..100',
    '101..105', '106..110', '111..115', '116..120', '121..125', '126..130', '131..135', '136..140', '141..145',
    '146..150', '151..155', '156..160', '>160'];   // °C
const GEARS = { 0: 'P', 1: 'R', 2: 'N', 3: '1', 4: '2', 5: '3', 6: '4', 7: '5', 8: '6', 9: '7', 16: '8' };
const SELECTOR = { 0: 'P', 1: 'R', 2: 'N', 3: 'D', 4: 'M' };
const TCC = { 0: 'OPEN', 1: 'REGULATED LOW', 2: 'REGULATED HIGH', 3: 'LOCKED LOW', 4: 'LOCKED HIGH',
    8: 'OPENING', 9: 'TO REGULATED LOW', 10: 'TO REGULATED HIGH', 11: 'TO LOCKED LOW', 12: 'TO LOCKED HIGH' };
const PACKS = ['A', 'B', 'C', 'D', 'E'];
const hex = (n, w) => n.toString(16).toUpperCase().padStart(w, '0');
const finite = (v) => typeof v === 'number' && isFinite(v);

/** The only requests this module sends: 22 <catalog DID> or 19 02 0C. Anything else throws. */
function request(bytes) {
    const b = Buffer.from(bytes || []);
    if (b.length === 3 && b[0] === 0x22 && records[hex(b.readUInt16BE(1), 4)]) return b;
    if (b.equals(FAULTS)) return b;
    throw new Error('Refused: the gearbox unit is only read (22 <known DID>, 19 02 0C), not ' + (b.toString('hex') || 'empty'));
}

function payload(did, uds) {
    const b = Buffer.from(uds || []), id = parseInt(did, 16);
    if (b.length < 3 || b[0] !== 0x62 || b[1] !== (id >> 8) || b[2] !== (id & 255)) return null;
    return b.slice(3);
}

/** A 22 reply decoded with the catalog; layout { raw: true }: this variant's own length, kept as raw bytes. */
function decode(did, uds, layout) {
    did = String(did).toUpperCase();
    const base = records[did], b = payload(did, uds);
    const meta = base && layout && layout.raw ? { length: null, fields: [] } : base;
    if (!meta || !b) return { ok: false, error: 'No matching positive response', values: [] };
    if (meta.length !== null && b.length !== meta.length) {
        return { ok: false, error: 'Unexpected length: ' + b.length + ', expected ' + meta.length, values: [] };
    }
    const values = meta.fields.map((f) => {
        const raw = f.signed ? (f.little ? b.readIntLE(f.at, f.bytes) : b.readIntBE(f.at, f.bytes))
            : (f.little ? b.readUIntLE(f.at, f.bytes) : b.readUIntBE(f.at, f.bytes));
        return raw * f.factor + f.offset;
    });
    return { ok: true, raw: b.toString('hex').toUpperCase(), values, bytes: b.length, decoded: values.length > 0 };
}

/** A 19 02 0C reply: [{ code: 'XXXXXX', status }] (the kit's parseDtcReply). */
function faults(uds) {
    const b = Buffer.from(uds || []);
    if (b[0] === 0x7F) return { ok: false, error: 'NRC ' + hex(b[2] || 0, 2), dtcs: [] };
    if (b[0] !== 0x59 || b[1] !== 0x02) return { ok: false, error: b.length ? 'No matching positive response' : 'No response', dtcs: [] };
    const dtcs = [];
    for (let i = 3; i + 4 <= b.length; i += 4) dtcs.push({ code: hex(b.readUIntBE(i, 3), 6), status: b[i + 3] });
    return { ok: true, dtcs };
}

const val = (r, d, i) => {
    const x = r[d] && r[d].ok ? r[d].values[i || 0] : null;
    return finite(x) ? x : null;
};

/** Live values from decoded records { DID: decode() }; v = the variant's entry. */
function live(r, v) {
    const engine = val(r, 'DA34'), turbine = val(r, 'DA2A', 0);
    return {
        gear: GEARS[val(r, 'DA2E', 0)] || null,
        program: SELECTOR[val(r, 'DA2E', 1)] || null,
        oilTemp: val(r, '6000'),
        inputRpm: turbine,
        outputRpm: val(r, 'DA2A', 1),
        engineRpm: engine,
        slip: v.converter && engine !== null && turbine !== null ? engine - turbine : null,   // engine - turbine, rpm
        lockup: TCC[val(r, 'DA22')] || null,
    };
}

/** Clutch A-E adaptations (corrections, not absolute values) and their evaluation counters. */
function adaptations(r) {
    return { clutches: PACKS.map((p, i) => ({ clutch: p, pressure: val(r, '413A', i), fastFill: val(r, '4140', i),
        fastFillEvals: val(r, '4130', i), pressureEvals: val(r, '4131', i) })) };
}

/** Oil temperature time-in-band (lifetime counters) and operating hours (no standby). */
function history(r) {
    const h = r['4441'], min = val(r, '6081');
    const out = { operatingHours: min === null ? null : min / 60, oil: null, oilRaw: null };
    if (h && h.ok && h.decoded) {
        const total = h.values.reduce((a, b) => a + b, 0);
        out.oil = { totalHours: total / 3600, bands: RANGES.map((range, i) => ({ range, hours: h.values[i] / 3600,
            percent: total ? h.values[i] / total * 100 : null })) };
    } else if (h && h.ok) out.oilRaw = h.raw;   // another layout on this variant: raw only
    return out;
}

// ---- I/O --------------------------------------------------------------------------------------------------

async function send(read, bytes) {
    const req = request(bytes);
    try { return (await read(EGS, req)) || null; } catch (e) { return null; }
}

async function ask(read, did, v) {
    const id = parseInt(did, 16), uds = await send(read, [0x22, id >> 8, id & 255]);
    const got = decode(did, uds, v && v.layouts[did]);
    if (!got.ok && !uds) got.error = 'No response';
    else if (!got.ok && uds[0] === 0x7F) got.error = 'NRC ' + hex(uds[2] || 0, 2);
    return got;
}

/** 22 F150 -> { supported, variant, name, converter } or { supported: false, variant, error }. */
async function identify(read) {
    const got = await ask(read, 'F150'), variant = got.ok ? got.raw : null, v = VARIANTS[variant];
    if (v) return { supported: true, variant, name: v.name, converter: v.converter };
    return { supported: false, variant, error: got.ok ? 'Unknown gearbox variant ' + variant : got.error };
}

// id: identify()'s result (else it is read first). Nothing else is asked unless it names a known variant.
async function gated(read, id, fn) {
    id = id || await identify(read);
    const v = id.supported && VARIANTS[id.variant];
    if (!v) return { supported: false, variant: id.variant || null, error: id.error || 'Unknown gearbox variant' };
    return Object.assign({ supported: true, variant: id.variant, name: v.name, at: Date.now() }, await fn(v));
}

async function readSet(read, dids, v, fn) {
    const r = {}, errors = {};
    for (const d of dids) {
        r[d] = await ask(read, d, v);
        if (!r[d].ok) errors[d] = r[d].error;
    }
    return Object.assign(fn(r, v), { errors });
}

const readLive = (read, id) => gated(read, id, (v) => readSet(read, ['DA2E', '6000', 'DA2A', 'DA34', 'DA22'], v, live));
const readAdaptations = (read, id) => gated(read, id, (v) => readSet(read, ['413A', '4140', '4130', '4131'], v, adaptations));
const readHistory = (read, id) => gated(read, id, (v) => readSet(read, ['4441', '6081'], v, history));
const readFaults = (read, id) => gated(read, id, async () => faults(await send(read, FAULTS)));

async function readAll(read) {
    const id = await identify(read);
    if (!id.supported) return id;
    return Object.assign({}, id, { live: await readLive(read, id), adaptations: await readAdaptations(read, id),
        history: await readHistory(read, id), faults: await readFaults(read, id) });
}

// ---- self-check: node transmission.js ---------------------------------------------------------------------

async function test() {
    const assert = require('assert');
    const words = (did, values) => {   // the kit's test helper: 62 DID + int16 LE words
        const b = Buffer.alloc(3 + values.length * 2);
        b[0] = 0x62; b.writeUInt16BE(parseInt(did, 16), 1);
        values.forEach((x, i) => b.writeInt16LE(x, 3 + i * 2));
        return b.toString('hex');
    };
    const dec = (d, h) => decode(d, Buffer.from(h, 'hex'));
    // decoding, the kit's known bytes (test_zf8hp.js)
    assert.deepStrictEqual(dec('413A', words('413A', [-120, 15, 0, -260, 48])).values, [-120, 15, 0, -260, 48]);
    assert.deepStrictEqual(dec('4140', words('4140', [10, -3, 6, 0, 2])).values, [10, -3, 6, 0, 2]);
    assert.strictEqual(dec('413A', '62413a0100').ok, false);                          // short
    assert.strictEqual(dec('413A', words('4140', [10, -3, 6, 0, 2])).ok, false);      // another DID
    assert.strictEqual(dec('413A', '7f2231').ok, false);
    assert.strictEqual(dec('6000', '62600064').values[0], 60);
    assert.deepStrictEqual(dec('DA2A', '62da2a032004b0').values, [800, 1200]);
    assert.strictEqual(dec('F150', '62f1500f25d0').raw, '0F25D0');
    assert.strictEqual(GEARS[0x10], '8');
    assert.strictEqual(GEARS[10], undefined);
    assert.strictEqual(RANGES.length, 23);
    assert.deepStrictEqual(faults(Buffer.from('5902ff1234562f', 'hex')), { ok: true, dtcs: [{ code: '123456', status: 0x2F }] });
    assert.strictEqual(faults(Buffer.from('7f1931', 'hex')).error, 'NRC 31');

    // read-only: every other service, sub-function or unknown DID is refused before it is sent
    [[0x2E, 0xF1, 0x90, 0x00], [0x31, 0x01, 0x0F, 0x0C], [0x14, 0xFF, 0xFF, 0xFF], [0x10, 0x03], [0x11, 0x01],
        [0x27, 0x01], [0x2F, 0x60, 0x00, 0x03], [0x3E, 0x00], [0x19, 0x02, 0xFF], [0x19, 0x0A], [0x22, 0xF1, 0x90],
        [0x22, 0x60, 0x00, 0x60, 0x05], [0x22], []].forEach((b) => assert.throws(() => request(b), /Refused/));
    assert(request([0x22, 0x60, 0x00]).equals(Buffer.from('226000', 'hex')) && request([0x19, 0x02, 0x0C]).equals(FAULTS));

    // a fake gearbox: request hex -> reply hex
    const band = Array(23).fill(0); band[4] = 3600; band[7] = 10800;               // 1 h in 41..60, 3 h in 81..90
    const hist = Buffer.alloc(3 + 92); hist.write('624441', 'hex'); band.forEach((s, i) => hist.writeUInt32BE(s, 3 + i * 4));
    const replies = { '22f150': '62f1500f25d0', 226000: '62600064', '22da2e': '62da2e0503', '22da2a': '62da2a032004b0',
        '22da34': '62da3403e8', '22da22': '62da220004', '22413a': words('413A', [-120, 15, 0, -260, 48]),
        224140: words('4140', [10, -3, 6, 0, 2]), 224130: words('4130', [1, 2, 3, 4, 5]), 224131: words('4131', [6, 7, 8, 9, 10]),
        224441: hist.toString('hex'), 226081: '6260810000' + '1770', '19020c': '5902ff1234562f' };
    const fake = (over) => {
        const calls = [], map = Object.assign({}, replies, over);
        const read = (addr, bytes) => {
            calls.push({ addr, req: Buffer.from(bytes).toString('hex') });
            const h = map[Buffer.from(bytes).toString('hex')];
            return Promise.resolve(h ? Buffer.from(h, 'hex') : null);
        };
        return { read, calls };
    };

    const g = fake(), all = await readAll(g.read);
    assert.strictEqual(all.name, 'GSZFBCE');
    assert.deepStrictEqual([all.live.gear, all.live.program, all.live.oilTemp, all.live.inputRpm, all.live.outputRpm,
        all.live.engineRpm, all.live.slip, all.live.lockup], ['3', 'D', 60, 800, 1200, 1000, 200, 'LOCKED HIGH']);
    assert.deepStrictEqual(all.adaptations.clutches[3], { clutch: 'D', pressure: -260, fastFill: 0, fastFillEvals: 4, pressureEvals: 9 });
    assert.strictEqual(all.history.operatingHours, 100);
    assert.strictEqual(all.history.oil.totalHours, 4);
    assert.deepStrictEqual([all.history.oil.bands[4], all.history.oil.bands[7].percent, all.history.oil.bands[0].percent],
        [{ range: '41..60', hours: 1, percent: 25 }, 75, 0]);
    assert.strictEqual(all.history.oil.bands.reduce((a, b) => a + b.percent, 0), 100);
    assert.deepStrictEqual(all.faults.dtcs, [{ code: '123456', status: 0x2F }]);
    assert.strictEqual(g.calls.length, 13);
    assert(g.calls.every((c) => c.addr === EGS && (/^22[0-9a-f]{4}$/.test(c.req) || c.req === '19020c')), 'only 22 / 19 02 0C to 0x18');
    assert.deepStrictEqual(all.live.errors, {});

    // an NRC and a dead read show as errors with no value
    const n = fake({ '22da34': '7f2231' }), lv = await readLive(n.read);
    assert(lv.supported && lv.engineRpm === null && lv.slip === null && lv.errors.DA34 === 'NRC 31');
    const dead = await identify(() => Promise.reject(new Error('link down')));
    assert.deepStrictEqual(dead, { supported: false, variant: null, error: 'No response' });

    // variant gate: an unknown variant reads nothing after F150, also with a forged identification
    const u = fake({ '22f150': '62f1500f2ff0' }), unk = await readAll(u.read);
    assert.deepStrictEqual([unk.supported, unk.variant, u.calls.length], [false, '0F2FF0', 1]);
    assert.strictEqual((await readLive(u.read, unk)).supported, false);
    assert.strictEqual((await readFaults(u.read, { supported: true, variant: '0F2FF0' })).supported, false);
    assert.strictEqual(u.calls.length, 1, 'nothing read on an unknown variant');

    // the hybrid 8HP: read; no converter slip; its 4441 of another length kept raw
    const h = fake({ '22f150': '62f1500f21e0', 224441: '624441' + '00'.repeat(40) }), hy = await readAll(h.read);
    assert(hy.supported && hy.name === '8HP hybrid' && hy.live.slip === null && hy.live.inputRpm === 800);
    assert(hy.history.oil === null && hy.history.oilRaw === '00'.repeat(40) && hy.history.operatingHours === 100);
    console.log('transmission self-check ok (node ' + process.version + ')');
}

module.exports = { EGS, VARIANTS, RANGES, GEARS, SELECTOR, TCC, records, request, payload, decode, faults, live, adaptations,
    history, identify, readLive, readAdaptations, readHistory, readFaults, readAll, test };
if (require.main === module) test().catch((e) => { console.error(e); process.exit(1); });
