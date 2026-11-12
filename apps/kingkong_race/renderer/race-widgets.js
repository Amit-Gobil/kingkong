'use strict';
/**
 * KingKong Race–only GPU elements (christmas tree + brand). Packed into Race's
 * renderer copy — never shipped in kingkong_cardata.
 */
const fs = require('fs');
const path = require('path');
const DRAW = {};
const TRY = {};

const GOLD = '#d4af37';
const CREAM = '#f5ecd2';
const DIM = '#9a8f72';
const AMBER_ON = '#ffb000';
const AMBER_OFF = '#3a2a08';
const GREEN_ON = '#2fd27a';
const GREEN_OFF = '#0d2a18';
const RED_ON = '#e23b2f';
const HOUSING = '#12100c';
const EDGE = '#2a261c';

let _logo = undefined; // undefined = not tried; null = missing; object = decoded
function logoPic() {
    if (_logo !== undefined) return _logo;
    try {
        const png = require('./kit/png');
        const buf = fs.readFileSync(path.join(__dirname, 'logo.png'));
        let img = png.decode(buf);
        if (img.w > 900 || img.h > 400) img = png.fit(img, 900);
        _logo = img;
    } catch (e) {
        _logo = null;
    }
    return _logo;
}

function ambersOf(o) {
    if (Array.isArray(o.amber)) return [0, 1, 2].map((i) => !!o.amber[i]);
    const parts = String(o.amber == null ? '' : o.amber).split(/[,\s|]+/).filter(Boolean);
    return [0, 1, 2].map((i) => {
        const v = parts[i];
        return v === '1' || v === 'true' || v === 'on' || v === '●';
    });
}

/** Dual-column NHRA tree filling a wide left half — max lamp size for ID8 glance. */
DRAW.raceTree = (cv, t, b, o) => {
    const pad = 10;
    const x0 = b.x + pad;
    const y0 = b.y + pad;
    const w = Math.max(80, b.w - pad * 2);
    const h = Math.max(80, b.h - pad * 2);
    cv.roundRect(b.x, b.y, b.w, b.h, 14, HOUSING);
    cv.strokeRoundRect(b.x, b.y, b.w, b.h, 14, 3, EDGE);

    const ambers = ambersOf(o);
    const green = !!o.green;
    const foul = !!o.foul;
    const staged = o.staged !== false;

    // Two columns so a wide left-half box is filled with light, not empty gutter.
    const colGap = Math.max(12, w * 0.05);
    const colW = (w - colGap) / 2;
    const cxL = x0 + colW / 2;
    const cxR = x0 + colW + colGap + colW / 2;

    const gap = Math.max(4, Math.min(10, h * 0.014));
    // Stage row is compact; spend height budget on 3 ambers + green.
    const stageBand = Math.min(h * 0.14, 90);
    const mainH = h - stageBand;
    const nMain = 4; // 3 amber + green
    const r = Math.min(colW * 0.48, (mainH - gap * (nMain - 1)) / (nMain * 2));

    const lamp = (cx, yy, rad, onCol, offCol, lit, hi) => {
        cv.circle(cx, yy, rad, lit ? onCol : offCol);
        if (lit && hi) cv.circle(cx, yy, rad * 0.4, hi);
    };

    const sr = Math.min(stageBand * 0.38, r * 0.5);
    let y = y0 + stageBand * 0.5;
    lamp(cxL, y, sr, GOLD, AMBER_OFF, staged, null);
    lamp(cxR, y, sr, GOLD, AMBER_OFF, staged, null);

    y = y0 + stageBand + r;
    for (let i = 0; i < 3; i++) {
        const lit = ambers[i];
        lamp(cxL, y, r, AMBER_ON, AMBER_OFF, lit, '#ffe08a');
        lamp(cxR, y, r, AMBER_ON, AMBER_OFF, lit, '#ffe08a');
        y += r * 2 + gap;
    }

    const go = foul ? RED_ON : (green ? GREEN_ON : GREEN_OFF);
    const hi = foul ? '#ffb0a8' : '#b8ffd0';
    const litGo = green || foul;
    lamp(cxL, y, r * 1.08, go, GREEN_OFF, litGo, hi);
    lamp(cxR, y, r * 1.08, go, GREEN_OFF, litGo, hi);
};

/** Official logo (logo.png) with optional subtitle — not cardata teleShell + gauge. */
DRAW.raceBrand = (cv, t, b, o) => {
    const sub = String(o.sub != null ? o.sub : '');
    const center = o.align === 'center';
    const img = o.logo === false ? null : logoPic();
    if (img) {
        const subH = sub ? 28 : 0;
        const maxH = Math.max(40, b.h - subH - 8);
        const scale = Math.min(b.w / img.w, maxH / img.h);
        const dw = img.w * scale;
        const dh = img.h * scale;
        const x = center ? b.x + (b.w - dw) / 2 : b.x;
        const y = b.y + Math.max(0, (maxH - dh) / 2);
        cv.image(img, x, y, dw, dh, 0);
        if (sub) {
            const sx = center ? b.x + b.w / 2 : b.x;
            cv.text(sub, sx, y + dh + 24, 22, CREAM, {
                font: 'label',
                align: center ? 'center' : 'left',
                spacing: 3
            });
        }
        return;
    }
    const title = String(o.title != null ? o.title : 'KINGKONG');
    const x = center ? b.x + b.w / 2 : b.x;
    const align = center ? 'center' : 'left';
    const size = Math.min(72, Math.max(40, b.h * 0.55));
    cv.text(title, x, b.y + size * 0.85, size, GOLD, { font: 'bold', align, spacing: 4 });
    if (sub) {
        cv.text(sub, x, b.y + size + 28, 26, CREAM, { font: 'label', align, spacing: 3 });
    }
};

const ELEMENTS = {
    raceTree: {
        label: 'Race tree',
        icon: '●',
        tele: true,
        box: [240, 520],
        fields: [
            { key: 'amber', label: 'Ambers', kind: 'text', def: '0,0,0' },
            { key: 'green', label: 'Green', kind: 'bool', def: false },
            { key: 'foul', label: 'Foul', kind: 'bool', def: false },
            { key: 'staged', label: 'Staged', kind: 'bool', def: true }
        ]
    },
    raceBrand: {
        label: 'Race brand',
        icon: 'K',
        tele: true,
        box: [900, 110],
        fields: [
            { key: 'title', label: 'Title', kind: 'text', def: 'KINGKONG' },
            { key: 'sub', label: 'Sub', kind: 'text', def: 'TUNING' },
            { key: 'align', label: 'Align', kind: 'select', def: 'left', extra: ['left', 'center'] }
        ]
    }
};

module.exports = { DRAW, TRY, ELEMENTS, GOLD, DIM };
