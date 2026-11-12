'use strict';
/*
 * logbuf.js - local auto-log ring on the HU (support dump, not BM3/MHD).
 * Samples in memory + rolling segment files under data/logs/. Export packages the
 * last ~30 min (or size cap) for Skicka-logg. Node 8. No remote live stream.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const KEEP_MS = 30 * 60 * 1000;
const MAX_BYTES = 40 * 1024 * 1024;
const SEG_MS = 5 * 60 * 1000;          // new segment file every 5 min
const FAST_MS = 100;                   // 10 Hz
const MED_MS = 500;                    // 2 Hz

function ensureDir(d) {
    try { fs.mkdirSync(d); } catch (e) {
        if (!e || e.code !== 'EEXIST') throw e;
    }
}

function listSegs(dir) {
    try {
        return fs.readdirSync(dir).filter((n) => /\.jsonl$/.test(n)).sort()
            .map((n) => {
                const p = path.join(dir, n);
                let size = 0, mtime = 0;
                try { const st = fs.statSync(p); size = st.size; mtime = st.mtimeMs || (+st.mtime); } catch (e) { /* */ }
                return { name: n, path: p, size, mtime };
            });
    } catch (e) { return []; }
}

function prune(dir, keepMs, maxBytes) {
    const segs = listSegs(dir);
    const cutoff = Date.now() - keepMs;
    let total = segs.reduce((a, s) => a + s.size, 0);
    segs.forEach((s) => {
        if (s.mtime < cutoff || total > maxBytes) {
            try { fs.unlinkSync(s.path); total -= s.size; } catch (e) { /* */ }
        }
    });
}

/** Rolling JSONL ring under dataDir/logs. */
function RingLog(dataDir) {
    this.root = path.join(dataDir, 'logs');
    this.exportDir = path.join(this.root, 'export');
    this.buf = [];                     // recent in-memory lines (export fallback)
    this.bufBytes = 0;
    this.seg = null;
    this.segPath = null;
    this.segStarted = 0;
    this.segBytes = 0;
    this.lastFast = 0;
    this.lastMed = 0;
    this.lastSlow = {};
    this.incidentAt = 0;
    this.lastStatus = '';
    try {
        ensureDir(dataDir);
        ensureDir(this.root);
        ensureDir(this.exportDir);
    } catch (e) {
        this.lastStatus = `log dir: ${e.message || e}`;
    }
}

RingLog.prototype._openSeg = function (now) {
    const stamp = new Date(now).toISOString().replace(/[:.]/g, '-').slice(0, 19);
    this.segPath = path.join(this.root, `${stamp}.jsonl`);
    this.segStarted = now;
    this.segBytes = 0;
    try { this.seg = fs.openSync(this.segPath, 'a'); } catch (e) {
        this.seg = null;
        this.lastStatus = `open: ${e.message || e}`;
    }
};

RingLog.prototype._closeSeg = function () {
    if (this.seg != null) {
        try { fs.closeSync(this.seg); } catch (e) { /* */ }
        this.seg = null;
    }
};

RingLog.prototype._writeLine = function (obj, now) {
    const line = `${JSON.stringify(obj)}\n`;
    const n = Buffer.byteLength(line);
    this.buf.push({ t: now, line });
    this.bufBytes += n;
    while (this.buf.length > 1 && (this.bufBytes > 2 * 1024 * 1024 || now - this.buf[0].t > KEEP_MS)) {
        this.bufBytes -= Buffer.byteLength(this.buf.shift().line);
    }
    if (!this.seg || now - this.segStarted > SEG_MS || this.segBytes > 4 * 1024 * 1024) {
        this._closeSeg();
        this._openSeg(now);
        prune(this.root, KEEP_MS, MAX_BYTES);
    }
    if (this.seg == null) return;
    try {
        fs.writeSync(this.seg, line);
        this.segBytes += n;
    } catch (e) {
        this.lastStatus = `write: ${e.message || e}`;
        this._closeSeg();
    }
};

/**
 * Sample current live values. Call ~every render tick; internally rate-limits.
 * vals: { rpm, v, tq, boost, ect, oil, batt, gear, mode, run, ethanol }
 */
RingLog.prototype.sample = function (vals, now) {
    now = now || Date.now();
    const fast = now - this.lastFast >= FAST_MS;
    const med = now - this.lastMed >= MED_MS;
    if (!fast && !med) return;

    const row = { t: now };
    let changed = false;
    if (fast) {
        this.lastFast = now;
        ['rpm', 'v', 'tq', 'boost'].forEach((k) => {
            if (vals[k] !== undefined && vals[k] !== null) { row[k] = vals[k]; changed = true; }
        });
        // incident mark: high boost jump or limp-ish
        if (typeof vals.boost === 'number' && vals.boost >= 1.8) {
            row.incident = true;
            this.incidentAt = now;
            changed = true;
        }
    }
    if (med) {
        this.lastMed = now;
        ['ect', 'oil', 'batt', 'ethanol'].forEach((k) => {
            if (vals[k] !== undefined && vals[k] !== null) { row[k] = vals[k]; changed = true; }
        });
    }
    ['gear', 'mode', 'run'].forEach((k) => {
        const v = vals[k];
        if (v !== undefined && v !== null && this.lastSlow[k] !== v) {
            row[k] = v;
            this.lastSlow[k] = v;
            changed = true;
        }
    });
    if (!changed) return;
    if (this.incidentAt && now - this.incidentAt < 5000) row.incident = true;
    this._writeLine(row, now);
};

/** Package last keepMs of log into exportDir as .jsonl.gz. Returns { ok, path, bytes, note }. */
RingLog.prototype.exportPackage = function (keepMs) {
    keepMs = keepMs || KEEP_MS;
    const now = Date.now();
    const cutoff = now - keepMs;
    try {
        ensureDir(this.exportDir);
        this._closeSeg(); // flush current segment handle; reopen on next sample
        const parts = [];
        listSegs(this.root).forEach((s) => {
            if (s.mtime < cutoff - SEG_MS) return;
            try { parts.push(fs.readFileSync(s.path, 'utf8')); } catch (e) { /* */ }
        });
        // prefer disk segments; if empty, fall back to memory buffer
        let body = parts.join('');
        if (!body && this.buf.length) body = this.buf.filter((x) => x.t >= cutoff).map((x) => x.line).join('');
        if (!body) {
            this.lastStatus = 'Ingen logg att skicka ännu';
            return { ok: false, note: this.lastStatus };
        }
        // filter lines by t when possible
        const filtered = body.split('\n').filter((ln) => {
            if (!ln) return false;
            try {
                const o = JSON.parse(ln);
                return !o.t || o.t >= cutoff;
            } catch (e) { return true; }
        }).join('\n') + '\n';
        const stamp = new Date(now).toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const outPath = path.join(this.exportDir, `kingkong-log-${stamp}.jsonl.gz`);
        const gz = zlib.gzipSync(Buffer.from(filtered, 'utf8'));
        fs.writeFileSync(outPath, gz);
        // also write uncompressed sibling for USB copy without gunzip
        const plain = outPath.replace(/\.gz$/, '');
        fs.writeFileSync(plain, filtered);
        this.lastStatus = `Sparad · ${path.basename(plain)} (${Math.round(gz.length / 1024)} KB gz)`;
        prune(this.root, KEEP_MS, MAX_BYTES);
        return { ok: true, path: plain, gz: outPath, bytes: gz.length, note: this.lastStatus };
    } catch (e) {
        this.lastStatus = `Export fel: ${e.message || e}`;
        return { ok: false, note: this.lastStatus };
    }
};

RingLog.prototype.status = function () {
    const segs = listSegs(this.root);
    const bytes = segs.reduce((a, s) => a + s.size, 0) + this.bufBytes;
    return {
        segs: segs.length,
        mb: +(bytes / (1024 * 1024)).toFixed(2),
        note: this.lastStatus || (segs.length ? `${segs.length} segment · ${+(bytes / 1024).toFixed(0)} KB` : 'Ringbuffer tom'),
        incidentAt: this.incidentAt || null,
    };
};

RingLog.prototype.close = function () { this._closeSeg(); };

module.exports = { RingLog, KEEP_MS, MAX_BYTES, FAST_MS, MED_MS };
