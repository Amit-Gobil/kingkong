'use strict';
/*
 * flap.js - the DME's electric exhaust flap, in the two kinds the SGBD dme8ff_r describes (PRG FILES/dme8ff_r.prg):
 *   regulated ("geregelte"): 2F 611E GER_EL_AGK, argument SW_GER_EL_AGK = % x 81.92 (signed int, high byte first);
 *     position 22 651E ASG_GER_EL_AGK, bank 1 + bank 2, counts / 81.92 = % (car-measured: car-apps issue #3, a G80 S58
 *     MHD: 1C CD = 90.0 % closed, 03 33 = 10.0 % open; the SGBD's 0.00152588 does not fit). Here the plain channel is idle
 *     (22 64FD reads 00 00) and refuses 2F 60FD with 7F 2F 22.
 *   plain: 2F 60FD EL_AGK 03 03E8 (10 %) / 03 2328 (90 %); position 22 64FD ASG_EL_AGK, signed % x 100.
 * Both: 03 = short-term adjustment, 00 = control back to the DME (it also ends an override itself after ~20 s);
 * <= 20 % open, >= 80 % closed.
 * Which one a car has: ask 22 651E first; a positive reply = regulated; a refusal other than "busy / conditions not
 * correct" (21 / 22) = plain (and then the plain read decides whether there is a flap at all).
 * BMW's jobs are diagnostic overrides: the DME drops them once the car moves (issue #3) or after ~20 s. MHD's own flap
 * control holds while driving: 2F 02 nn (00 back to the tune, 01 open, 02 closed), echoed 6F 02 nn, the same short
 * scheme as its map (2F 01) and Max Cooling (2F 03); captured from MHD's app on an MHD+ S58 (idrive7-apps PR #23,
 * real_adapters.js MhdFlap). An untuned DME refuses it (too short for a 2F job). No read-back but the position read.
 */
const MHD = { open: [0x02, 0x01], close: [0x02, 0x02], oem: [0x02, 0x00] };
const KINDS = {
    regulated: { set: [0x61, 0x1E], read: [0x65, 0x1E],
        cmd: { open: [0x03, 0x03, 0x33], close: [0x03, 0x1C, 0xCD], oem: [0x00] },
        pct: (hi, lo) => Math.round(((hi << 8) | lo) / 81.92 * 10) / 10 },
    plain: { set: [0x60, 0xFD], read: [0x64, 0xFD],
        cmd: { open: [0x03, 0x03, 0xE8], close: [0x03, 0x23, 0x28], oem: [0x00] },
        pct: (hi, lo) => { const raw = (hi << 8) | lo; return (raw > 0x7FFF ? raw - 0x10000 : raw) / 100; } },
};
const TRANSIENT = [0x21, 0x22, 0x78];           // busy, conditions not correct, pending: ask again later

/** the reply (bytes after the 7F / 62) belongs to that kind's read */
const isRead = (kind, u) => !!u && ((u[0] === 0x62 && u[1] === KINDS[kind].read[0] && u[2] === KINDS[kind].read[1]) || (u[0] === 0x7F && u[1] === 0x22));
/**
 * a read reply -> { pct } (a position), { kind: 'plain' } (regulated asked and refused for good: use plain),
 * { none: true } (plain refused for good: no electric flap), or {} (nothing learned: no reply, busy)
 */
function onRead(kind, u) {
    if (!u) return {};
    if (u[0] === 0x62 && u.length >= 5) return { pct: KINDS[kind].pct(u[3], u[4]) };
    if (u[0] === 0x7F && TRANSIENT.indexOf(u[2]) < 0) return kind === 'regulated' ? { kind: 'plain' } : { none: true };
    return {};
}
/** the 2F request data for k ('open' | 'close' | 'oem') */
const command = (kind, k) => KINDS[kind].set.concat(KINDS[kind].cmd[k]);
/** 2F data that drives a flap (MHD's or either BMW job): allowed at any speed */
const isFlapSet = (d) => !!d && ((d.length === 2 && d[0] === MHD.oem[0])
    || Object.keys(KINDS).some((k) => d[0] === KINDS[k].set[0] && d[1] === KINDS[k].set[1]));
/** MHD's reply to its flap request: 'held' (echoed), 'busy' (try again later), 'none' (no MHD flap control: use BMW's job) */
const onMhd = (k, u) => (u && u[0] === 0x6F && u[1] === MHD[k][0] && u[2] === MHD[k][1] ? 'held'
    : !u || (u[0] === 0x7F && TRANSIENT.indexOf(u[2]) >= 0) ? 'busy' : 'none');
const state = (pct) => (pct === null || pct === undefined ? null : pct <= 20 ? 'OPEN' : pct >= 80 ? 'CLOSED' : `${pct} %`);

function test() {
    const assert = require('assert');
    // issue #3's G80: regulated replies 62 651E 1CCD 1CCD (closed) / 0333 0333 (open)
    assert.deepStrictEqual(onRead('regulated', [0x62, 0x65, 0x1E, 0x1C, 0xCD, 0x1C, 0xCD]), { pct: 90 });
    assert.deepStrictEqual(onRead('regulated', [0x62, 0x65, 0x1E, 0x03, 0x33, 0x03, 0x33]), { pct: 10 });
    assert.deepStrictEqual([state(90), state(10), state(50), state(null)], ['CLOSED', 'OPEN', '50 %', null]);
    // a DME without the regulated job: request out of range -> plain; busy / conditions -> ask again
    assert.deepStrictEqual(onRead('regulated', [0x7F, 0x22, 0x31]), { kind: 'plain' });
    assert.deepStrictEqual(onRead('regulated', [0x7F, 0x22, 0x22]), {});
    assert.deepStrictEqual(onRead('regulated', null), {});
    // plain: signed % x 100; refused for good = no electric flap
    assert.deepStrictEqual(onRead('plain', [0x62, 0x64, 0xFD, 0x23, 0x28]), { pct: 90 });
    assert.deepStrictEqual(onRead('plain', [0x7F, 0x22, 0x31]), { none: true });
    // the commands as the SGBD's argument says (% x 81.92) and as the issue's car accepted
    assert.deepStrictEqual(command('regulated', 'open'), [0x61, 0x1E, 0x03, 0x03, 0x33]);
    assert.deepStrictEqual(command('regulated', 'close'), [0x61, 0x1E, 0x03, 0x1C, 0xCD]);
    assert.deepStrictEqual(command('plain', 'close'), [0x60, 0xFD, 0x03, 0x23, 0x28]);
    assert.deepStrictEqual(command('regulated', 'oem'), [0x61, 0x1E, 0x00]);
    assert.strictEqual(Math.round(10 * 81.92), 0x0333); assert.strictEqual(Math.round(90 * 81.92), 0x1CCD);
    assert.deepStrictEqual([isFlapSet([0x61, 0x1E, 0x00]), isFlapSet([0x60, 0xFD, 0x00]), isFlapSet([0x01, 0x01])], [true, true, false]);
    assert.deepStrictEqual([isFlapSet([0x02, 0x01]), isFlapSet([0x02, 0x01, 0x00]), isFlapSet([0x03, 0x01])], [true, false, false]);
    // MHD: the echo holds it; an untuned DME refuses the short request for good; busy / no reply = ask again
    assert.deepStrictEqual([onMhd('open', [0x6F, 0x02, 0x01]), onMhd('close', [0x6F, 0x02, 0x01]), onMhd('oem', [0x7F, 0x2F, 0x13]),
        onMhd('open', [0x7F, 0x2F, 0x22]), onMhd('open', null)], ['held', 'none', 'none', 'busy', 'busy']);
    assert(isRead('regulated', [0x62, 0x65, 0x1E, 0, 0]) && !isRead('regulated', [0x62, 0x64, 0xFD, 0, 0]) && isRead('plain', [0x7F, 0x22, 0x31]));
    console.log('flap self-check ok');
}

module.exports = { KINDS, MHD, isRead, onRead, command, isFlapSet, onMhd, state, test };
if (require.main === module) test();
