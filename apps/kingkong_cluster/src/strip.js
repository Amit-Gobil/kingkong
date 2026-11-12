'use strict';
/*
 * Quiet Dials black/gold KOMBI status strip painter (RGBA8).
 * Node 8–safe: no canvas. Matches media/kingkong-kombi-strip-mock.png layout:
 * brand · Boost · Power% · Torque% with gold chevrons and hairline rails.
 */
const GOLD = [212, 175, 55, 255];
const GOLD_DIM = [160, 130, 40, 220];
const WHITE = [245, 245, 245, 255];
const LABEL = [180, 180, 180, 255];
const BG = [12, 12, 12, 210];
const BG_EDGE = [8, 8, 8, 230];

// Hand-authored 5x7 bitmaps as 5 columns (LSB = top row).
const FONT = {
  ' ': [0, 0, 0, 0, 0],
  '-': [0, 8, 8, 8, 0],
  '.': [0, 0, 0x40, 0, 0],
  ':': [0, 0, 0x28, 0, 0],
  '%': [0x62, 0x64, 0x08, 0x13, 0x23],
  '0': [0x3e, 0x51, 0x49, 0x45, 0x3e],
  '1': [0x00, 0x42, 0x7f, 0x40, 0x00],
  '2': [0x42, 0x61, 0x51, 0x49, 0x46],
  '3': [0x21, 0x41, 0x45, 0x4b, 0x31],
  '4': [0x18, 0x14, 0x12, 0x7f, 0x10],
  '5': [0x27, 0x45, 0x45, 0x45, 0x39],
  '6': [0x3c, 0x4a, 0x49, 0x49, 0x30],
  '7': [0x01, 0x71, 0x09, 0x05, 0x03],
  '8': [0x36, 0x49, 0x49, 0x49, 0x36],
  '9': [0x06, 0x49, 0x49, 0x29, 0x1e],
  A: [0x7e, 0x11, 0x11, 0x11, 0x7e],
  B: [0x7f, 0x49, 0x49, 0x49, 0x36],
  C: [0x3e, 0x41, 0x41, 0x41, 0x22],
  D: [0x7f, 0x41, 0x41, 0x22, 0x1c],
  E: [0x7f, 0x49, 0x49, 0x49, 0x41],
  F: [0x7f, 0x09, 0x09, 0x09, 0x01],
  G: [0x3e, 0x41, 0x49, 0x49, 0x7a],
  H: [0x7f, 0x08, 0x08, 0x08, 0x7f],
  I: [0x00, 0x41, 0x7f, 0x41, 0x00],
  J: [0x20, 0x40, 0x41, 0x3f, 0x01],
  K: [0x7f, 0x08, 0x14, 0x22, 0x41],
  L: [0x7f, 0x40, 0x40, 0x40, 0x40],
  M: [0x7f, 0x02, 0x0c, 0x02, 0x7f],
  N: [0x7f, 0x04, 0x08, 0x10, 0x7f],
  O: [0x3e, 0x41, 0x41, 0x41, 0x3e],
  P: [0x7f, 0x09, 0x09, 0x09, 0x06],
  Q: [0x3e, 0x41, 0x51, 0x21, 0x5e],
  R: [0x7f, 0x09, 0x19, 0x29, 0x46],
  S: [0x26, 0x49, 0x49, 0x49, 0x32],
  T: [0x01, 0x01, 0x7f, 0x01, 0x01],
  U: [0x3f, 0x40, 0x40, 0x40, 0x3f],
  V: [0x1f, 0x20, 0x40, 0x20, 0x1f],
  W: [0x3f, 0x40, 0x38, 0x40, 0x3f],
  X: [0x63, 0x14, 0x08, 0x14, 0x63],
  Y: [0x07, 0x08, 0x70, 0x08, 0x07],
  Z: [0x61, 0x51, 0x49, 0x45, 0x43],
};

function put(px, w, x, y, rgba) {
  if (x < 0 || y < 0 || x >= w) return;
  const i = (y * w + x) * 4;
  px[i] = rgba[0]; px[i + 1] = rgba[1]; px[i + 2] = rgba[2]; px[i + 3] = rgba[3];
}

function fillRect(px, w, x0, y0, rw, rh, rgba) {
  for (let y = y0; y < y0 + rh; y++) {
    for (let x = x0; x < x0 + rw; x++) put(px, w, x, y, rgba);
  }
}

function blend(px, w, x, y, rgba) {
  if (x < 0 || y < 0 || x >= w) return;
  const i = (y * w + x) * 4;
  const a = rgba[3] / 255;
  const ia = 1 - a;
  px[i] = Math.round(px[i] * ia + rgba[0] * a);
  px[i + 1] = Math.round(px[i + 1] * ia + rgba[1] * a);
  px[i + 2] = Math.round(px[i + 2] * ia + rgba[2] * a);
  px[i + 3] = Math.min(255, Math.round(px[i + 3] + rgba[3] * (1 - px[i + 3] / 255)));
}

function drawGlyph(px, w, x, y, ch, scale, rgba) {
  const g = FONT[ch] || FONT[ch.toUpperCase()] || FONT[' '];
  if (!g) return 5 * scale;
  for (let col = 0; col < 5; col++) {
    const bits = g[col];
    for (let row = 0; row < 7; row++) {
      if (!(bits & (1 << row))) continue;
      fillRect(px, w, x + col * scale, y + row * scale, scale, scale, rgba);
    }
  }
  return 6 * scale;
}

function drawText(px, w, x, y, text, scale, rgba) {
  let cx = x;
  String(text).split('').forEach((ch) => { cx += drawGlyph(px, w, cx, y, ch, scale, rgba); });
  return cx - x;
}

function chevron(px, w, x, y, h) {
  // Slanted gold parallelogram accent (mock dividers).
  for (let row = 0; row < h; row++) {
    const inset = Math.floor(row * 0.35);
    for (let col = 0; col < 10; col++) {
      blend(px, w, x + col + inset, y + row, GOLD);
    }
  }
}

/**
 * @param {{ boost?: number|string, power?: number|string, torque?: number|string, map?: string, ethanol?: number|string }} vals
 * @param {{ w?: number, h?: number }} opts
 * @returns {{ w: number, h: number, rgba: Buffer }}
 */
function paintStrip(vals, opts) {
  const w = (opts && opts.w) || 1140;
  const h = (opts && opts.h) || 72;
  const px = Buffer.alloc(w * h * 4);

  // Background + subtle centre gold wash.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const edge = y < 2 || y >= h - 2 || x < 2 || x >= w - 2;
      const glow = Math.max(0, 1 - Math.abs(y - h / 2) / (h / 2));
      const g = Math.round(18 + glow * 22);
      put(px, w, x, y, edge ? BG_EDGE : [g, Math.round(g * 0.85), Math.round(g * 0.35), 215]);
    }
  }
  // Gold hairline rails.
  fillRect(px, w, 0, 0, w, 2, GOLD);
  fillRect(px, w, 0, h - 2, w, 2, GOLD);

  const boost = vals.boost == null || vals.boost === '' ? '--' : vals.boost;
  const power = vals.power == null || vals.power === '' ? '--' : String(vals.power) + (String(vals.power).indexOf('%') >= 0 ? '' : '%');
  const torque = vals.torque == null || vals.torque === '' ? '--' : String(vals.torque) + (String(vals.torque).indexOf('%') >= 0 ? '' : '%');

  const cells = [
    { label: 'BOOST', value: String(boost) },
    { label: 'POWER', value: String(power) },
    { label: 'TORQUE', value: String(torque) },
  ];
  if (vals.ethanol != null && vals.ethanol !== '') {
    cells.push({ label: 'ETH', value: String(vals.ethanol) + (String(vals.ethanol).indexOf('%') >= 0 ? '' : '%') });
  }
  if (vals.map) cells.push({ label: 'MAP', value: String(vals.map).slice(0, 10) });

  // Brand block.
  drawText(px, w, 18, 14, 'KINGKONG', 2, GOLD);
  drawText(px, w, 18, 42, 'TUNING', 1, GOLD_DIM);

  let cx = 200;
  cells.forEach((c) => {
    chevron(px, w, cx, 10, h - 20);
    cx += 22;
    drawText(px, w, cx, 12, c.label, 1, LABEL);
    const vw = drawText(px, w, cx, 34, c.value, 2, WHITE);
    cx += Math.max(vw, 90) + 28;
  });

  return { w, h, rgba: px };
}

/** Place the strip on a target-sized transparent canvas. */
function paintOnCanvas(targetW, targetH, vals, place) {
  const strip = paintStrip(vals, place && place.strip);
  const canvas = Buffer.alloc(targetW * targetH * 4); // transparent
  const sw = strip.w;
  const sh = strip.h;
  const x0 = place && place.x != null ? place.x : Math.max(0, Math.floor((targetW - sw) / 2));
  const y0 = place && place.y != null ? place.y : Math.max(0, Math.floor(targetH * 0.55));
  for (let y = 0; y < sh; y++) {
    if (y0 + y >= targetH) break;
    for (let x = 0; x < sw; x++) {
      if (x0 + x >= targetW) break;
      const si = (y * sw + x) * 4;
      if (!strip.rgba[si + 3]) continue;
      const di = ((y0 + y) * targetW + (x0 + x)) * 4;
      canvas[di] = strip.rgba[si];
      canvas[di + 1] = strip.rgba[si + 1];
      canvas[di + 2] = strip.rgba[si + 2];
      canvas[di + 3] = strip.rgba[si + 3];
    }
  }
  return { w: targetW, h: targetH, rgba: canvas, stripX: x0, stripY: y0, stripW: sw, stripH: sh };
}

/** Minimal RGB→PNG (no deps) for local mock dumps. */
function rgbaToPng(w, h, rgba) {
  const zlib = require('zlib');
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const compressed = zlib.deflateSync(raw);
  function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const typeB = Buffer.from(type);
    const crc = Buffer.alloc(4);
    const crcVal = crc32(Buffer.concat([typeB, data])) >>> 0;
    crc.writeUInt32BE(crcVal, 0);
    return Buffer.concat([len, typeB, data, crc]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c;
}

module.exports = { paintStrip, paintOnCanvas, rgbaToPng, GOLD };
