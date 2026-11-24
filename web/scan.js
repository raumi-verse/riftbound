"use strict";
// Scanning cards with the camera. The art is compared with every printing's first, in any language; only when that
// leaves a doubt is the collector line at the bottom left ("OGN • 030a/298") or the name read, by Tesseract.js, loaded
// on first use (the service worker keeps it for offline use). Needs query.js, collection.js and cardview.js (addAs).
//
//   readCollector(text) -> [{set, num, suffix}]      matchName(text) -> {card, score} | null
//   matchScan({collector, name}) -> {id, card, p, how: "number"|"name", sure} | null      (no DOM, tested in node)
//   recognize(canvas) -> Promise<{collector, name}>   OCR of a card-shaped picture (DOM)

// ---------- the matcher ----------

const CODE_SETS_SCAN = [...new Set([...PRINTS.keys()].map((id) => id.split("-")[0]))].filter((s) => /^[A-Z]{3}$/.test(s));
// letters OCR reads for digits and back
const AS_DIGIT = { O: "0", o: "0", D: "0", Q: "0", I: "1", l: "1", i: "1", "|": "1", Z: "2", z: "2", S: "5", s: "5", B: "8", G: "6", g: "9", T: "7" };
const AS_LETTER = { 0: "O", 1: "I", 5: "S", 8: "B", 6: "G", 2: "Z" };
const lev = (a, b) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
};

// The number after the slash is the set's size (OGN 298, SFD 221 …), which says the set even when its letters
// read as "oon" or "be"; the letters are only needed if two sets were ever the same size.
const SET_TOTALS = (() => {
  const max = {};
  for (const c of CARDS) {
    if (c.supertype === "Token") continue;
    for (const p of c.printings) if (/^[A-Z]{3}$/.test(p.set) && !p.overnumbered && p.num != null && p.num < 500) max[p.set] = Math.max(max[p.set] || 0, p.num);
  }
  const by = new Map();
  for (const [set, n] of Object.entries(max)) by.set(n, by.has(n) ? null : set); // null: two sets that size
  return by;
})();
const digits = (s) => s.replace(/./g, (c) => AS_DIGIT[c] ?? c);
const setFromLetters = (raw) => {
  raw = raw.toUpperCase().replace(/[0-9]/g, (c) => AS_LETTER[c] || c);
  return CODE_SETS_SCAN.includes(raw) ? raw : CODE_SETS_SCAN.find((s) => lev(s, raw) === 1 && s[0] === raw[0]) || null;
};

// "OGN • 030a/298", "oon - 030/298 2", "5 * 007/221", "0GN · 3OO*/298" -> [{set, num, suffix}]
function readCollector(text) {
  const out = [];
  const D = "[0-9OoDQIl|ZzSsBGT]";
  const re = new RegExp(`(?:([A-Za-z0-9]{3})\\W{0,4})?(${D}{1,3})\\s*([ab*★✱x+])?\\s*[/]\\s*(${D}{2,3})`, "g");
  for (const m of String(text).matchAll(re)) {
    const num = digits(m[2]), total = Number(digits(m[4]));
    if (!/^\d+$/.test(num) || Number.isNaN(total)) continue;
    // the data's count can be off by one or two from the printed size (RAD prints /167)
    const near = () => { for (const d of [1, -1, 2, -2]) { const x = SET_TOTALS.get(total + d); if (x) return x; } return null; };
    const set = SET_TOTALS.get(total) || (m[1] && setFromLetters(m[1])) || near();
    if (!set) continue;
    out.push({ set, num, suffix: m[3] ? (/[*★✱x+]/.test(m[3]) ? "*" : m[3]) : "" });
  }
  return out;
}

const letters = (s) => s.toLowerCase().normalize("NFKD").replace(/[^a-z]/g, "");
let NAMES = null;
const names = () => (NAMES ??= CARDS.filter((c) => c.supertype !== "Token").map((c) => ({ card: c, key: letters(c.name) })).filter((n) => n.key.length >= 3));
const bigrams = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const k = s.slice(i, i + 2); m.set(k, (m.get(k) || 0) + 1); } return m; };
// Dice coefficient of the letter pairs: 1 the same, 0 nothing in common; a long rules line scores low against a name
function dice(a, b) {
  const pa = bigrams(a), pb = bigrams(b);
  let hit = 0;
  for (const [k, n] of pb) hit += Math.min(n, pa.get(k) || 0);
  return (2 * hit) / Math.max(1, a.length - 1 + b.length - 1);
}
// The card whose name one line (or two lines: "Jinx" over "DEMOLITIONIST") of the text shows best
function matchName(text) {
  const lines = String(text).split(/\n/).map(letters).filter((l) => l.length >= 3);
  const cands = [...lines, ...lines.slice(1).map((l, i) => lines[i] + l)];
  if (!cands.length) return null;
  let best = null;
  for (const n of names()) for (const l of cands) {
    if (l.length > n.key.length * 2 + 6) continue; // a rules text line, not a name
    const s = dice(l, n.key);
    if (!best || s > best.score) best = { card: n.card, score: s };
  }
  return best && best.score >= 0.6 ? best : null;
}

// Cards the name band may show, best first (at most 8): the whole name, or its part before the comma ("Jinx" of
// "Jinx, Demolitionist"), in a line. Loose on purpose; the art decides among them.
function nameCandidates(text) {
  const lines = String(text).split(/\n/).map(letters).filter((l) => l.length >= 3);
  if (!lines.length) return [];
  const scored = [];
  for (const n of names()) {
    const title = letters(n.card.name.split(",")[0]);
    let s = 0;
    for (const l of lines) {
      if (l.length <= n.key.length * 2 + 6) s = Math.max(s, dice(l, n.key));
      if (title.length >= 4 && title !== n.key) s = Math.max(s, l.includes(title) ? 0.75 : 0.9 * dice(l, title));
      if (l.includes(n.key)) s = 1;
    }
    if (s >= 0.5) scored.push([s, n.card]);
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, 8).map(([, c]) => c);
}

function matchScan({ collector = "", name = "" }) {
  const byName = name ? matchName(name) : null;
  for (const c of readCollector(collector)) {
    const hit = [3, 2].map((pad) => `${c.set}-${c.num.padStart(pad, "0")}`.toUpperCase())
      .map((id) => PRINTS.get(id + c.suffix.toUpperCase()) || PRINTS.get(id)).find(Boolean);
    if (!hit) continue;
    // a clear name of another card: the number was misread
    if (byName && byName.score >= 0.85 && byName.card.id !== hit.card.id) {
      return { id: byName.card.id, card: byName.card, p: byName.card.printings[0], how: "name", sure: false };
    }
    return { id: hit.p.id, card: hit.card, p: hit.p, how: "number", sure: true };
  }
  if (byName) return { id: byName.card.id, card: byName.card, p: byName.card.printings[0], how: "name", sure: false };
  return null;
}

// ---------- OCR (browser) ----------
// Regions of a card picture, as fractions of its width and height (measured on the card scans)
const REGIONS = {
  collector: { x: 0.02, y: 0.925, w: 0.42, h: 0.06 },
  collectorTight: { x: 0.035, y: 0.935, w: 0.26, h: 0.045 },
  name: { x: 0.04, y: 0.5, w: 0.92, h: 0.3 },
};
const TESSERACT = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
async function loadTesseract() {
  if (!window.Tesseract) {
    await new Promise((ok, fail) => {
      const s = document.createElement("script");
      s.src = TESSERACT; s.onload = ok; s.onerror = () => fail(new Error("couldn't load the text recognition (offline on first use?)"));
      document.head.append(s);
    });
  }
}
let ocr = null;
function ocrWorker() {
  return (ocr ??= (async () => {
    await loadTesseract();
    return Tesseract.createWorker("eng");
  })().catch((e) => { ocr = null; throw e; }));
}

// a region of the picture, scaled up, grey with stretched contrast and turned to dark text on light (the
// collector line is light text); bin: black and white at Otsu's threshold, for text over busy full-art backgrounds
function crop(src, r, scale, bin = false) {
  const sw = src.width, sh = src.height;
  const c = document.createElement("canvas");
  c.width = Math.round(sw * r.w * scale); c.height = Math.round(sh * r.h * scale);
  const g = c.getContext("2d", { willReadFrequently: true });
  g.imageSmoothingQuality = "high";
  g.drawImage(src, sw * r.x, sh * r.y, sw * r.w, sh * r.h, 0, 0, c.width, c.height);
  const img = g.getImageData(0, 0, c.width, c.height), d = img.data;
  const hist = new Array(256).fill(0);
  let lo = 255, hi = 0;
  for (let i = 0; i < d.length; i += 4) { const v = (d[i] * 3 + d[i + 1] * 6 + d[i + 2]) / 10 | 0; d[i] = v; hist[v]++; if (v < lo) lo = v; if (v > hi) hi = v; }
  let cut = 128;
  if (bin) { // Otsu
    const n = d.length / 4;
    let sum = 0, sumB = 0, wB = 0, best = -1;
    for (let t = 0; t < 256; t++) sum += t * hist[t];
    for (let t = 0; t < 256; t++) {
      wB += hist[t]; if (!wB || wB === n) continue;
      sumB += t * hist[t];
      const mB = sumB / wB, mF = (sum - sumB) / (n - wB), v = wB * (n - wB) * (mB - mF) ** 2;
      if (v > best) { best = v; cut = t; }
    }
  }
  const k = 255 / Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    const v = bin ? (d[i] > cut ? 0 : 255) : 255 - (d[i] - lo) * k;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  g.putImageData(img, 0, 0);
  return c;
}

// ---------- the art ----------
// The frame's art against every printing's (web/art.js, made by art.py: 16 x 12 colour pictures). It needs no text, so it
// works in any language, and pixels of glare (bright, colourless) are left out. The frame is tried at a few offsets and
// sizes, as no card is held exactly. Correlation: 1 the same picture, around 0 unrelated ones.
const ART = { x: 0.08, y: 0.1, w: 0.84, h: 0.42 }, FRAME = [186, 260];
const ART_SURE = { score: 0.55, ahead: 0.12, both: 0.78 }; // gave no wrong card, on photos and in trials with glare, tilt and noise
let artIndex = null;
function artReady() {
  return (artIndex ??= (async () => {
    if (!window.ART_INDEX) await new Promise((ok, fail) => {
      const s = document.createElement("script");
      s.src = "art.js"; s.onload = ok; s.onerror = () => fail(new Error("couldn't load the pictures to compare with"));
      document.head.append(s);
    });
    return readArt(window.ART_INDEX);
  })().catch((e) => { artIndex = null; throw e; }));
}
function readArt(x) {
  const bin = atob(x.px), px = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) px[i] = bin.charCodeAt(i);
  const hp = new Float32Array(px.length), n = x.w * x.h * 3, all = new Uint8Array(x.w * x.h).fill(1);
  for (let o = 0; o < px.length; o += n) hp.set(local(px.subarray(o, o + n), x.w, x.h, all), o);
  // half the size, to pick the likely ones quickly
  const cw = x.w >> 1, ch = x.h >> 1, N = x.ids.length, small = new Float32Array(N * cw * ch * 3);
  for (let i = 0; i < N; i++) for (let y = 0; y < x.h; y++) for (let xx = 0; xx < x.w; xx++) for (let c = 0; c < 3; c++)
    small[(i * cw * ch + (y >> 1) * cw + (xx >> 1)) * 3 + c] += px[(i * x.w * x.h + y * x.w + xx) * 3 + c] / 4;
  return { ...x, px, hp, small, cw, ch, at: new Map(x.ids.map((id, i) => [id, i])) };
}
// each cell against the mean of the 5 x 5 around it (only those in the mask): what soft glare, a haze over part of the
// card, leaves alone
function local(v, w, h, mask) {
  const out = new Float32Array(v.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let n = 0, r = 0, g = 0, b = 0;
    for (let yy = Math.max(0, y - 2); yy <= Math.min(h - 1, y + 2); yy++) for (let xx = Math.max(0, x - 2); xx <= Math.min(w - 1, x + 2); xx++) {
      const k = yy * w + xx;
      if (mask[k]) { n++; r += v[k * 3]; g += v[k * 3 + 1]; b += v[k * 3 + 2]; }
    }
    const o = (y * w + x) * 3;
    n = n || 1;
    out[o] = v[o] - r / n; out[o + 1] = v[o + 1] - g / n; out[o + 2] = v[o + 2] - b / n;
  }
  return out;
}
// v less its mean over use[0..m) into out -> its length
function centre(v, out, use, m) {
  let mean = 0, n = 0;
  for (let j = 0; j < m; j++) mean += v[use[j]];
  mean /= m;
  for (let j = 0; j < m; j++) { const d = v[use[j]] - mean; out[use[j]] = d; n += d * d; }
  return Math.sqrt(n) || 1e-6;
}
const artSure = (a) => a.score[a.best] >= ART_SURE.score && a.ahead >= ART_SURE.ahead && a.score[a.best] + a.ahead >= ART_SURE.both; // a hand over a card: 0.60 + 0.14
// rgba: the pixels of a w x h picture of the card -> {score: Float32Array per printing, best, ahead, clear}
// ahead: how far the best is above the best other art; clear: the part of the art free of glare
const CLOSE_PLACES = 8, LIKELY = 120; // of the 1400 pictures, this many are compared closely
function artMatch(rgba, w, h, ix) {
  const cells = ix.w * ix.h, N = ix.ids.length, score = new Float32Array(N).fill(-1);
  let clear = 0;
  // each placement of the art in the frame: its cells, which are free of glare
  const place = (s, dx, dy) => {
    // the card is s times the frame, its middle off by dx, dy
    const X0 = (0.5 + dx + (ART.x - 0.5) * s) * w, Y0 = (0.5 + dy + (ART.y - 0.5) * s) * h, cw = ART.w * s * w / ix.w, ch = ART.h * s * h / ix.h;
    const glare = new Uint8Array(cells), mask = new Uint8Array(cells), v = new Float32Array(cells * 3);
    for (let cy = 0, k = 0; cy < ix.h; cy++) for (let cx = 0; cx < ix.w; cx++, k++) {
      const x0 = Math.max(0, Math.round(X0 + cx * cw)), x1 = Math.min(w, Math.max(x0 + 1, Math.round(X0 + (cx + 1) * cw)));
      const y0 = Math.max(0, Math.round(Y0 + cy * ch)), y1 = Math.min(h, Math.max(y0 + 1, Math.round(Y0 + (cy + 1) * ch)));
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let i = (y * w + x0) * 4, e = (y * w + x1) * 4; i < e; i += 4) { r += rgba[i]; g += rgba[i + 1]; b += rgba[i + 2]; n++; }
      n = n || 1;
      v[k * 3] = r /= n; v[k * 3 + 1] = g /= n; v[k * 3 + 2] = b /= n;
      const lo = Math.min(r, g, b);
      glare[k] = lo > 185 && Math.max(r, g, b) - lo < 35 ? 1 : 0;
    }
    let free = 0;
    for (let k = 0; k < cells; k++) { // with the cells around it: glare fades out
      const c = k % ix.w;
      mask[k] = glare[k] || (c && glare[k - 1]) || (c < ix.w - 1 && glare[k + 1]) || (k >= ix.w && glare[k - ix.w]) || (k < cells - ix.w && glare[k + ix.w]) ? 0 : 1;
      free += mask[k];
    }
    clear = Math.max(clear, free / cells);
    return free < cells * 0.2 ? null : { s, dx, dy, v, mask, trust: Math.min(1, 0.8 + 0.4 * free / cells) }; // less art to go by counts a little less
  };
  const places = [];
  for (const s of [0.79, 0.86, 0.93, 1, 1.07]) for (const dx of [-0.05, 0, 0.05]) for (const dy of [-0.04, 0, 0.04]) { const pl = place(s, dx, dy); if (pl) places.push(pl); }
  // all pictures at half size
  const n2 = ix.cw * ix.ch, use = new Int32Array(cells * 3), x = new Float32Array(cells * 3);
  for (const pl of places) {
    const sv = new Float32Array(n2 * 3), sm = new Uint8Array(n2);
    for (let k = 0; k < cells; k++) if (pl.mask[k]) { const q = (k / ix.w >> 1) * ix.cw + (k % ix.w >> 1); sm[q]++; for (let c = 0; c < 3; c++) sv[q * 3 + c] += pl.v[k * 3 + c]; }
    let m = 0;
    for (let q = 0; q < n2; q++) if (sm[q] > 1) for (let c = 0; c < 3; c++) { sv[q * 3 + c] /= sm[q]; use[m++] = q * 3 + c; }
    if (m < 12) continue;
    const norm = centre(sv, x, use, m);
    if (norm * norm < m * 9) continue; // nearly one colour: no picture there
    for (let i = 0; i < N; i++) {
      const o = i * n2 * 3;
      let sx = 0, s1 = 0, s2 = 0;
      for (let j = 0; j < m; j++) { const k = use[j], p = ix.small[o + k]; sx += p * x[k]; s1 += p; s2 += p * p; }
      const c = pl.trust * sx / (norm * Math.sqrt(Math.max(1e-6, s2 - s1 * s1 / m)));
      if (c > score[i]) score[i] = c;
      if (c > (pl.best ?? -1)) pl.best = c;
    }
  }
  const likely = Array.from(score.keys()).sort((a, b) => score[b] - score[a]).slice(0, LIKELY), close = new Float32Array(LIKELY).fill(-1);
  // those closely: the picture itself and its local contrast, half each
  places.sort((a, b) => (b.best ?? -1) - (a.best ?? -1));
  // the best placements, and those half a step from the very best
  const closer = places.slice(0, CLOSE_PLACES), b0 = places.slice(0, 2);
  for (const b of b0) for (const [s, dx, dy] of [[0.035, 0, 0], [-0.035, 0, 0], [0, 0.025, 0], [0, -0.025, 0], [0, 0, 0.02], [0, 0, -0.02]]) { const pl = place(b.s + s, b.dx + dx, b.dy + dy); if (pl) closer.push(pl); }
  // and as it's meant to be held, also when haze misleads the quick look
  for (const s of [0.93, 1, 1.07]) for (const dx of [-0.03, 0, 0.03]) for (const dy of [-0.025, 0, 0.025]) { const pl = place(s, dx, dy + (s - 1) * 0.19); if (pl) closer.push(pl); }
  for (const { v, mask, trust } of closer) {
    let m = 0;
    for (let k = 0; k < cells; k++) if (mask[k]) for (let c = 0; c < 3; c++) use[m++] = k * 3 + c;
    const z = local(v, ix.w, ix.h, mask), norm = centre(v, x, use, m), zn = centre(z, z, use, m);
    if (norm * norm < m * 9) continue;
    likely.forEach((i, q) => {
      const o = i * cells * 3;
      let sx = 0, s1 = 0, s2 = 0, hx = 0, h1 = 0, h2 = 0;
      for (let j = 0; j < m; j++) {
        const k = use[j], p = ix.px[o + k], r = ix.hp[o + k];
        sx += p * x[k]; s1 += p; s2 += p * p;
        hx += r * z[k]; h1 += r; h2 += r * r;
      }
      const c = trust * (sx / (norm * Math.sqrt(Math.max(1e-6, s2 - s1 * s1 / m))) + hx / (zn * Math.sqrt(Math.max(1e-6, h2 - h1 * h1 / m)))) / 2;
      if (c > close[q]) close[q] = c;
    });
  }
  // the unlikely ones can't be better than the least likely of those
  const least = Math.min(...close);
  for (let i = 0; i < N; i++) score[i] = Math.min(score[i], least);
  likely.forEach((i, q) => (score[i] = close[q]));
  let best = 0, other = -1;
  for (let i = 1; i < N; i++) if (score[i] > score[best]) best = i;
  for (let i = 0; i < N; i++) if (ix.group[i] !== ix.group[best] && score[i] > other) other = score[i];
  return { score, best, ahead: score[best] - other, clear };
}
async function matchArt(canvas) {
  const ix = await artReady(), c = document.createElement("canvas");
  [c.width, c.height] = FRAME;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.imageSmoothingQuality = "high";
  g.drawImage(canvas, 0, 0, c.width, c.height);
  return { ...artMatch(g.getImageData(0, 0, c.width, c.height).data, c.width, c.height, ix), ix };
}

// ---------- the language ----------
// The card is known: it's found exactly in the frame (it may lie off centre or tilted), straightened, and its name and
// rules compared, piece by piece, with its English picture, blurred as the frame may be. A match is English. Text that is
// sharp and still matches nowhere is another language. Anything else (blur, glare, hardly any text) is unsure: null.
const TEXT = { w: 200, h: 340, dx: 8, dy: 8 }; // cells per card, and how far a piece may be off
const TEXT_TILES = [0.1, 0.25, 0.4].map((x) => [x, 0.588, 0.15, 0.06])
  .concat([0.665, 0.735, 0.805].flatMap((y) => [0.1, 0.3, 0.5, 0.7].map((x) => [x, y, 0.2, 0.07])));
// eleven photos, each also blurred, and a webcam's frames: English 0.67 and up, Chinese up to 0.58
const LANGUAGE = { english: 0.64, other: 0.55, sharp: 0.25 };
function grey(rgba) {
  const g = new Float32Array(rgba.length / 4);
  for (let i = 0; i < g.length; i++) g[i] = rgba[i * 4] * 0.299 + rgba[i * 4 + 1] * 0.587 + rgba[i * 4 + 2] * 0.114;
  return g;
}
// the mean of the (2r+1)^2 cells around each
function soften(g, w, h, r) {
  const sum = new Float64Array((w + 1) * (h + 1)), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0, row = 0; x < w; x++) { row += g[y * w + x]; sum[(y + 1) * (w + 1) + x + 1] = sum[y * (w + 1) + x + 1] + row; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1), y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    out[y * w + x] = (sum[y1 * (w + 1) + x1] - sum[y0 * (w + 1) + x1] - sum[y1 * (w + 1) + x0] + sum[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0));
  }
  return out;
}
// grey less its 7 x 7 mean: the strokes
function strokes(g) {
  const s = soften(g, TEXT.w, TEXT.h, 3);
  for (let i = 0; i < s.length; i++) s[i] = g[i] - s[i];
  return s;
}
const tileBox = ([fx, fy, fw, fh]) => [Math.floor(fx * TEXT.w), Math.floor(fy * TEXT.h), Math.floor(fw * TEXT.w), Math.floor(fh * TEXT.h)];
// how well a's text matches b's (strokes of the English picture): 0 to 1, or null without enough text
function textMatch(a, b) {
  const { w, h, dx, dy } = TEXT;
  let total = 0, weight = 0, n = 0;
  for (const tile of TEXT_TILES) {
    const [x0, y0, tw, th] = tileBox(tile);
    let bb = 0;
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) { const t = b[(y0 + y) * w + x0 + x]; bb += t * t; }
    const energy = Math.sqrt(bb / (tw * th));
    if (energy < 6) continue; // no text there
    let best = -1, seen = 0;
    for (let oy = -dy; oy <= dy; oy++) for (let ox = -dx; ox <= dx; ox++) {
      if (x0 + ox < 0 || y0 + oy < 0 || x0 + ox + tw > w || y0 + oy + th > h) continue;
      let ab = 0, aa = 0;
      for (let y = 0; y < th; y++) for (let x = 0, i = (y0 + oy + y) * w + x0 + ox, j = (y0 + y) * w + x0; x < tw; x++, i++, j++) { ab += a[i] * b[j]; aa += a[i] * a[i]; }
      const q = ab / (Math.sqrt(bb * aa) + 1e-3);
      if (q > best) { best = q; seen = Math.sqrt(aa / (tw * th)); }
    }
    if (seen < 1.5) continue; // washed out
    total += best * energy; weight += energy; n++;
  }
  return n < 2 ? null : total / weight;
}
// how fine the detail of the text area is: lower when blurred
function detail(g, b) {
  const { w } = TEXT, all = [];
  for (const tile of TEXT_TILES) {
    const [x0, y0, tw, th] = tileBox(tile);
    let e = 0, mean = 0, fine = 0, v = 0, n = 0;
    for (let y = y0; y < y0 + th; y++) for (let x = x0; x < x0 + tw; x++) { const i = y * w + x; e += b[i] * b[i]; mean += g[i]; n++; }
    if (Math.sqrt(e / n) < 11) continue;
    mean /= n;
    for (let y = y0; y < y0 + th; y++) for (let x = x0; x < x0 + tw; x++) { const i = y * w + x, f = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w]; fine += f * f; v += (g[i] - mean) ** 2; }
    all.push(Math.sqrt(fine / n) / (Math.sqrt(v / n) + 4));
  }
  all.sort((p, q) => p - q);
  return all.length ? all[all.length >> 1] : null;
}
// Where the card lies in the frame: {s, rot, dx, dy} against filling it, by the whole picture at 40 x 56.
const FIND = { w: 40, h: 56, pw: 80, ph: 112 };
function findCard(frame, ref) { // frame: grey pw x ph, ref: grey w x h
  const { w, h, pw, ph } = FIND, pts = [];
  for (let y = 2; y < h - 2; y += 2) for (let x = 2; x < w - 2; x += 2) pts.push([((x + 0.5) / w - 0.5) * pw, ((y + 0.5) / h - 0.5) * ph, ref[y * w + x]]);
  const mean = pts.reduce((a, p) => a + p[2], 0) / pts.length;
  let rr = 0;
  for (const p of pts) { p[2] -= mean; rr += p[2] * p[2]; }
  const at = (s, rot, dx, dy) => {
    const c = Math.cos(rot) * s, n = Math.sin(rot) * s, ox = pw / 2 + dx * pw, oy = ph / 2 + dy * ph;
    let sv = 0, vv = 0, rv = 0, out = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], X = Math.round(ox + c * p[0] - n * p[1] - 0.5), Y = Math.round(oy + n * p[0] + c * p[1] - 0.5);
      let v = 0;
      if (X >= 0 && Y >= 0 && X < pw && Y < ph) v = frame[Y * pw + X]; else { out++; v = 40; }
      sv += v; vv += v * v; rv += p[2] * v;
    }
    return out > pts.length * 0.3 ? -1 : rv / Math.sqrt(rr * Math.max(1e-6, vv - sv * sv / pts.length));
  };
  let best = { q: -1, s: 1, rot: 0, dx: 0, dy: 0 };
  const go = (s, rot, dx, dy) => { const q = at(s, rot, dx, dy); if (q > best.q) best = { q, s, rot, dx, dy }; };
  for (const s of [0.7, 0.78, 0.86, 0.94, 1.02]) for (const r of [-9, -6, -3, 0, 3, 6, 9]) for (let dx = -0.2; dx < 0.21; dx += 0.04) for (let dy = -0.2; dy < 0.21; dy += 0.04) go(s, r * Math.PI / 180, dx, dy);
  for (const k of [1, 0.5, 0.25]) {
    const b = best;
    for (const s of [-0.04, 0, 0.04]) for (const r of [-1.5, 0, 1.5]) for (const x of [-0.02, 0, 0.02]) for (const y of [-0.02, 0, 0.02]) go(b.s + s * k, b.rot + r * k * Math.PI / 180, b.dx + x * k, b.dy + y * k);
  }
  return best;
}
function pixels(src, w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.imageSmoothingQuality = "high";
  if (draw) draw(g); else g.drawImage(src, 0, 0, w, h);
  return grey(g.getImageData(0, 0, w, h).data);
}
const ENGLISH = new Map(); // printing id -> Promise<{find, g, ref: [strokes at each blur]} | null>
function englishText(p) {
  if (!ENGLISH.has(p.id)) ENGLISH.set(p.id, (async () => {
    if (!p.img) return null;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = p.img;
    await img.decode();
    const g = pixels(img, TEXT.w, TEXT.h);
    return { find: pixels(img, FIND.w, FIND.h), g, ref: [g, soften(g, TEXT.w, TEXT.h, 1), soften(soften(g, TEXT.w, TEXT.h, 1), TEXT.w, TEXT.h, 1)].map(strokes) };
  })().catch(() => { ENGLISH.delete(p.id); return null; }));
  return ENGLISH.get(p.id);
}
// {lang: "en", "other" or null (unsure), score, sharp, card: the straightened card for OCR} for a frame showing printing p
async function readLanguage(canvas, p, card) {
  const none = { lang: null, score: null, sharp: null };
  if (card.landscape || card.type === "Rune") return none; // the text is elsewhere, or there is none
  const e = await englishText(p);
  if (!e) return none;
  const at = findCard(pixels(canvas, FIND.pw, FIND.ph), e.find), W = canvas.width, H = canvas.height;
  if (at.q < 0.4) return none;
  const g = pixels(null, TEXT.w, TEXT.h, (c) => {
    c.translate(TEXT.w / 2, TEXT.h / 2); c.scale(TEXT.w / W, TEXT.h / H); c.rotate(-at.rot); c.scale(1 / at.s, 1 / at.s);
    c.translate(-W / 2 - at.dx * W, -H / 2 - at.dy * H);
    c.drawImage(canvas, 0, 0);
  });
  const full = detail(e.g, e.ref[0]), d = detail(g, e.ref[0]), sharp = full && d != null ? d / full : 0;
  // print and pixels differ in the finest detail: a sharp frame is compared a little softened
  const a = strokes(sharp > 0.5 ? soften(g, TEXT.w, TEXT.h, 1) : g);
  const scores = e.ref.map((b) => textMatch(a, b)).filter((s) => s != null);
  if (!scores.length) return { ...none, sharp };
  const score = Math.max(...scores);
  return { lang: score >= LANGUAGE.english ? "en" : score <= LANGUAGE.other && sharp >= LANGUAGE.sharp ? "other" : null, score, sharp, at };
}

// Which other language: the rules text of the straightened card is read as each in turn (settings' languages first) till
// one fits. Read as the wrong script Tesseract is unsure of itself (photos: 39 % at most, the right one 49 % and up).
// Its data, a few MB a language, is loaded the first time a card isn't English.
const READ_AS = { zh: ["chi_sim", 45], ko: ["kor", 50], fr: ["fra", 60] };
const langWorkers = new Map();
function langWorker(code) {
  if (!langWorkers.has(code)) langWorkers.set(code, (async () => { await loadTesseract(); return Tesseract.createWorker(code); })().catch((e) => { langWorkers.delete(code); throw e; }));
  return langWorkers.get(code);
}
function languageOfText(text) {
  const n = (re) => (text.match(re) || []).length;
  const han = n(/[一-鿿]/g), hangul = n(/[가-힯]/g), latin = n(/[a-zà-öø-ÿœ]/gi);
  if (hangul >= 5 && hangul > han) return "ko";
  if (han >= 5 && han > hangul && han * 2 > latin) return "zh";
  const french = n(/(?<![a-zà-ÿ])(le|la|les|un|une|des|du|de|et|ou|vous|votre|vos|unités?|cartes?|ce|cette|sort|est|en|jouez|piochez|quand|lorsque|que|au|aux|sur|pour|avec|je|me)(?![a-zà-ÿ])/gi) + n(/[éèêàçùôîœ]/gi);
  const english = n(/\b(the|you|your|this|when|units?|cards?|and|of|to|it|play|draw|an|is|with|from|me|my)\b/gi);
  if (latin >= 15 && french >= 4 && french > english * 1.5) return "fr";
  if (latin >= 15 && english >= 3 && english > french) return "en";
  return null;
}
async function readLanguages(canvas) {
  const order = [...new Set([...(S.languages || []), "zh", "fr", "ko"])].filter((l) => READ_AS[l]);
  for (const l of order) {
    const [code, sure] = READ_AS[l], { text, confidence } = (await (await langWorker(code)).recognize(canvas)).data, found = languageOfText(text);
    if (confidence >= sure && (found === l || (found === "en" && l === "fr"))) return found;
  }
  return null;
}
let langQueue = Promise.resolve();
// canvas: the frame; at: where the card is in it (findCard)
function readScript(canvas, at) {
  const W = canvas.width, H = canvas.height, c = document.createElement("canvas"), cw = 900, ch = Math.round(cw * 88 / 63);
  const y0 = 0.66, y1 = 0.9; // the rules box
  c.width = cw; c.height = Math.round(ch * (y1 - y0));
  const g = c.getContext("2d");
  g.imageSmoothingQuality = "high";
  g.translate(cw / 2, ch / 2 - ch * y0); g.scale(cw / W, ch / H); g.rotate(-at.rot); g.scale(1 / at.s, 1 / at.s);
  g.translate(-W / 2 - at.dx * W, -H / 2 - at.dy * H);
  g.drawImage(canvas, 0, 0);
  return (langQueue = langQueue.catch(() => {}).then(() => readLanguages(c)));
}

const COLLECTOR_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789•·*/-. ";
async function recognize(card, { name = true, collector: wantNumber = true } = {}) {
  const w = await ocrWorker();
  const line = async (r, bin) => {
    const scale = Math.max(1, 64 / (card.height * r.h)); // the line is small: make it ~64 px high
    await w.setParameters({ tessedit_pageseg_mode: "7", tessedit_char_whitelist: COLLECTOR_CHARS });
    return (await w.recognize(crop(card, r, scale, bin))).data.text;
  };
  let collector = "";
  if (wantNumber) {
    collector = await line(REGIONS.collector, false);
    if (!readCollector(collector).length) collector += "\n" + await line(REGIONS.collectorTight, true);
  }
  let nameText = "";
  if (name) {
    const ns = Math.max(1, 900 / (card.width * REGIONS.name.w));
    await w.setParameters({ tessedit_pageseg_mode: "11", tessedit_char_whitelist: "" });
    nameText = (await w.recognize(crop(card, REGIONS.name, ns))).data.text;
  }
  return { collector, name: nameText };
}

// every printing the number OCR read could be: as read, and its variants (030 / 030a / 030*)
function numberCandidates(text) {
  const out = new Map();
  for (const c of readCollector(text)) for (const pad of [3, 2]) for (const suf of [c.suffix, "", "a", "b", "*"]) {
    const hit = PRINTS.get(`${c.set}-${c.num.padStart(pad, "0")}${suf}`.toUpperCase());
    if (hit && !out.has(hit.p.id)) out.set(hit.p.id, { ...hit, read: suf === c.suffix });
  }
  return [...out.values()];
}
// the candidate whose picture the frame shows (score >= 0.5); among printings with the same art the one read
function byArt(a, cands, r) {
  let best = null, known = false;
  for (const c of cands) {
    const s = a && a.ix.at.has(c.p.id) ? a.score[a.ix.at.get(c.p.id)] : null;
    if (s == null) continue;
    known = true;
    if (!best || s > best.score + 0.03 || (Math.abs(s - best.score) <= 0.03 && c.read && !best.read)) best = { ...c, score: s };
  }
  if (cands.length && !known) r.artUnknown = true;
  return best && best.score >= 0.5 ? { id: best.p.id, card: best.card, p: best.p, score: best.score, how: "art", sure: true } : null;
}

// ---------- what had to be corrected ----------
// Frames whose reading was corrected by hand, with what the scan thought and what was right: kept in this browser only
// (IndexedDB, the newest 150), to download and improve the scan with.
const CORRECTIONS = (() => {
  const KEEP = 150;
  let db = null;
  const open = () => (db ??= new Promise((ok, fail) => {
    const r = indexedDB.open("rb-scan", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("corrections", { keyPath: "k", autoIncrement: true });
    r.onsuccess = () => ok(r.result);
    r.onerror = () => { db = null; fail(r.error); };
  }));
  const run = async (mode, f) => {
    const s = (await open()).transaction("corrections", mode).objectStore("corrections");
    return new Promise((ok, fail) => { const r = f(s); r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error); });
  };
  return {
    async add(c) {
      try {
        await run("readwrite", (s) => s.add({ at: new Date().toISOString(), device: navigator.userAgent, ...c }));
        const keys = await run("readonly", (s) => s.getAllKeys());
        for (const k of keys.slice(0, Math.max(0, keys.length - KEEP))) await run("readwrite", (s) => s.delete(k));
      } catch (e) { console.warn("scan: can't keep the correction", e); }
    },
    all: () => run("readonly", (s) => s.getAll()).catch(() => []),
    count: () => run("readonly", (s) => s.count()).catch(() => 0),
    clear: () => run("readwrite", (s) => s.clear()).catch(() => {}),
  };
})();
// the frame, small enough to keep and large enough to try again with
function snapshot(canvas) {
  const c = document.createElement("canvas");
  c.width = 744; c.height = Math.round(744 * canvas.height / canvas.width);
  c.getContext("2d").drawImage(canvas, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.8);
}

// ---------- the scan screen (collection.html #scan) ----------
// Hold cards into the frame one after another. A card counts when two frames in a row agree; the same card counts
// again only after the camera saw no card (or another one). The tally is kept until "Add all".

// where a filed card goes, in words
const placeText = (f) => f.already ? `with your other ${esc(f.card.name)}` : [f.after && `after <b>${esc(f.after.name)}</b>`, f.before && `before <b>${esc(f.before.name)}</b>`].filter(Boolean).join(", ") || "first of its pile";
// the pile a card goes on: legends with their signatures, battlefields, else domain and rarity
const pileOf = (card, p) => filePile(card) ? `<b>${FILE_PILES[filePile(card)]}</b>${filePile(card) === 1 ? ` · ${esc(card.champion)}` : ""}` : `${card.domains.map((d) => `<img class="ic" src="icons/${d.toLowerCase()}.webp" alt="">`).join("")}<b>${card.domains.map((d) => cap(d.toLowerCase())).join(" + ") || "Colorless"}</b> · ${p.rarity}`;

function initScan(onAdd) {
  const dlg = document.getElementById("scan");
  if (!dlg) return;
  const $s = (q) => dlg.querySelector(q);
  const video = $s("video"), guide = $s(".guide"), hint = $s(".hint"), list = $s(".tally");
  const KEY = "rb-scan-tally";
  let tally = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } })(); // [{id, n}]
  const shots = new Map(); // tally line -> {frame, think}: the frame it came from and what the scan thought, till the page closes
  let missed = null; // the newest frame nothing was found in: {frame, think, at}
  let inOrder = false;
  const pile = $s(".pile");
  let stream = null, running = false, last = null, armed = true, empties = 0, audio = null;
  const esc = (x) => String(x ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(tally)); } catch { /* */ } };

  function beep() {
    try {
      audio ??= new AudioContext();
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = 1320; g.gain.value = 0.08;
      o.connect(g).connect(audio.destination); o.start(); o.stop(audio.currentTime + 0.07);
    } catch { /* */ }
    navigator.vibrate?.(40);
  }

  function show() {
    const total = tally.reduce((n, t) => n + t.n, 0);
    $s(".count").textContent = tally.length ? `${total} card${total === 1 ? "" : "s"}` : "";
    $s(".addall").disabled = !tally.length;
    const rows = tally.map((t, i) => [t, i]).reverse();
    // the order the cards are filed in (fileOrder), and where each goes
    const place = new Map();
    if (inOrder) {
      const f = filing(tally.map((t, k0) => ({ ...t, k0 })), STORE.all("coll").filter((r) => r.data.n > 0).map((r) => r.id));
      f.forEach((x, i) => place.set(x.k0, { ...x, i }));
      rows.sort(([, a], [, b]) => (place.get(a)?.i ?? 0) - (place.get(b)?.i ?? 0));
    }
    let lastPile = null;
    $s(".order").setAttribute("aria-pressed", inOrder);
    list.innerHTML = rows.map(([t, i]) => {
      const hit = PRINTS.get(t.id.toUpperCase());
      if (!hit) return "";
      const { card, p } = hit;
      const opts = card.printings.length > 1 ? `<select data-i="${i}">${card.printings.map((x) => `<option value="${esc(x.id)}"${x.id === p.id ? " selected" : ""}>${esc(x.id)}${x.kind ? ` · ${esc(x.kind)}` : ""}</option>`).join("")}</select>` : `<small>${esc(p.id)}</small>`;
      const pl = inOrder ? pileOf(card, p) : "", head = pl !== lastPile && pl ? `<li class="pile-head">${pl}</li>` : "";
      lastPile = pl;
      return `${head}<li class="${t.sure && !t.guess ? "" : "unsure"}">${p.img ? `<img src="${esc(p.img)}" alt="">` : ""}<span class="nm"><b>${esc(card.name)}</b><span class="sel">${opts}<select data-ver="${i}" aria-label="Version">${Object.entries(VERSIONS).map(([k, l]) => `<option value="${k}"${(t.ver || "") === k ? " selected" : ""}>${l}</option>`).join("")}</select></span>${place.has(i) ? `<small class="place">${placeText(place.get(i))}</small>` : ""}${t.sure ? "" : `<small class="warn">check the printing</small>`}${t.guess ? `<small class="warn">check the language</small>` : ""}</span>
        <button type="button" class="foil" data-foil="${i}" aria-pressed="${(t.ver || "").endsWith("foil")}" title="Foil" aria-label="Foil">✦</button>
        <span class="own"><span role="button" data-d="-1" data-i="${i}">−</span><b>${t.n}</b><span role="button" data-d="1" data-i="${i}">+</span></span></li>`;
    }).join("");
  }
  const fixed = (t, kind, right) => {
    const x = shots.get(t.k);
    if (!x) return; // typed, not scanned
    shots.delete(t.k);
    CORRECTIONS.add({ kind, got: { id: t.id, ver: t.ver || "" }, right, frame: x.frame, think: x.think }).then(countFixes);
  };
  async function countFixes() { const n = await CORRECTIONS.count(), b = $s(".fixes"); b.hidden = !n; b.textContent = `Corrections ${n}`; }
  function add(m) {
    const lang = m.lang || langOf(addAs), ver = m.ver ?? verOf(lang, addAs.endsWith("foil")), t = tally.find((x) => x.id === m.id && (x.ver || "") === ver);
    if (t) { t.n++; t.k ??= STORE.uid(); tally.splice(tally.indexOf(t), 1); tally.push(t); } else tally.push({ k: STORE.uid(), id: m.id, n: 1, sure: m.sure, ver, guess: m.read && !m.lang });
    save(); show(); beep();
    if (m.frame) {
      shots.set(tally.at(-1).k, { frame: m.frame, think: m.think });
      if (shots.size > 60) shots.delete(shots.keys().next().value);
    }
    hint.textContent = `+1 ${m.card.name} · ${VERSIONS[ver]}${m.read && !m.lang ? "?" : ""}`;
    pile.innerHTML = pileOf(m.card, m.p || PRINTS.get(m.id.toUpperCase()).p);
    pile.hidden = false;
  }

  // the part of the video under the guide, at the camera's resolution
  function grab() {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw) return null;
    const box = video.getBoundingClientRect(), g = guide.getBoundingClientRect();
    const k = Math.max(box.width / vw, box.height / vh); // object-fit: cover
    const ox = (box.width - vw * k) / 2, oy = (box.height - vh * k) / 2;
    const x = (g.left - box.left - ox) / k, y = (g.top - box.top - oy) / k, w = g.width / k, h = g.height / k;
    const c = document.createElement("canvas");
    c.width = Math.round(w); c.height = Math.round(h);
    c.getContext("2d").drawImage(video, x, y, w, h, 0, 0, c.width, c.height);
    return c;
  }
  async function find(canvas, still = true) {
    let a = null, m = null, r = { collector: "", name: "" };
    try { a = await matchArt(canvas); } catch { /* offline and never loaded: the text alone */ }
    if (a && artSure(a)) {
      const grp = a.ix.group[a.best], same = a.ix.ids.filter((_, i) => a.ix.group[i] === grp).map((id) => PRINTS.get(id.toUpperCase())).filter(Boolean);
      const hit = (x, sure) => ({ id: x.p.id, card: x.card, p: x.p, score: a.score[a.best], ahead: a.ahead, how: "art", sure });
      if (same.length === 1) m = hit(same[0], true);
      else if (same.length) {
        // the same picture on several printings: the number decides, else the first one, to be checked
        // not again for the card that was just counted
        if (!armed && same.some((x) => x.p.id === last)) return { ...hit(same.find((x) => x.p.id === last), true), think: null };
        r = still ? await recognize(canvas, { name: false }) : r;
        const read = numberCandidates(r.collector).find((c) => c.read && same.some((x) => x.p.id === c.p.id));
        const first = same.slice().sort((x, y) => (x.p.kind ? 1 : 0) - (y.p.kind ? 1 : 0))[0];
        m = hit(read || first, !!read);
      }
    }
    // reading text takes long on a phone: only for a frame that holds still, not for each in between
    if (!m && still) {
      r = await recognize(canvas, { name: false });
      m = byArt(a, numberCandidates(r.collector), r);
      if (!m) {
        r.name = (await recognize(canvas, { collector: false })).name;
        m = byArt(a, nameCandidates(r.name).flatMap((card) => card.printings.map((p) => ({ card, p }))), r);
        // no pictures to compare: the text alone, to be checked
        if (!m && (!a || r.artUnknown)) { const t = matchScan(r); if (t) m = { ...t, sure: false }; }
      }
    }
    const think = { collector: r.collector, name: r.name, clear: a?.clear, ahead: a?.ahead,
      art: a ? [...a.score.keys()].sort((x, y) => a.score[y] - a.score[x]).slice(0, 5).map((i) => [a.ix.ids[i], +a.score[i].toFixed(3)]) : null };
    if (m) m.think = think;
    else if (a && a.score[a.best] > 0.25) { // something like a card was there
      missed = { canvas, think, at: Date.now() };
    }
    if (!m && a && a.clear < 0.5) hint.textContent = "Glare: tilt the card or the light a little";
    if (window.SETTINGS?.scanDebug) { hint.textContent = `art ${a ? `${a.ix.ids[a.best]} ${a.score[a.best].toFixed(2)} +${a.ahead.toFixed(2)} clear ${a.clear.toFixed(2)}` : "-"} · ${r.collector.replace(/\s+/g, " ")} · ${r.name.replace(/\s+/g, " ").slice(0, 40)} → ${m?.id ?? "-"}`; window.SCAN_LAST = canvas; }
    return m;
  }
  // Added at once, with the language chosen; the frames after it settle the language while the card still lies there.
  // English is told by comparing; anything else is read in the background, after the card is gone if need be.
  let settle = null; // {t, m, tries}
  async function language(m, c) {
    const l = await readLanguage(c, m.p, m.card).catch(() => null);
    if (m.think && l?.score != null) { m.think.text = l.score; m.think.sharp = l.sharp; }
    m.read = true;
    if (l?.lang !== "other") return (m.lang = l?.lang || null);
    const script = await readScript(c, l.at).catch(() => null);
    if (m.think) m.think.script = script;
    // the comparison said it isn't English; unread (offline), the language chosen if that's another one
    m.lang = script || null;
    return m.lang;
  }
  function setLanguage(s, c) {
    const t = s.t, ver = verOf(s.m.lang, isFoil(t.ver));
    if (!tally.includes(t)) return;
    t.guess = false;
    const x = shots.get(t.k);
    if (x) { x.frame = snapshot(c); x.think = s.m.think; }
    hint.textContent = `${s.m.card.name} · ${VERSIONS[ver]}`;
    if (ver === (t.ver || "")) { save(); show(); return; }
    if (t.n > 1) { t.n--; const one = { ...t, k: STORE.uid(), n: 1, ver }; if (x) shots.set(one.k, x); tally.push(one); merge(one); } else { t.ver = ver; merge(t); }
  }
  let reading = false;
  function settleLanguage(c) {
    const s = settle;
    if (!s || reading) return;
    if (++s.tries > 8) { settle = null; return; }
    reading = true;
    language(s.m, c).then((l) => { if (!l) return; if (settle === s) settle = null; setLanguage(s, c); }).finally(() => { reading = false; });
  }
  // how much changed since the frame before (0 to 255)
  let small = null;
  function moved(canvas) {
    const g = pixels(canvas, 24, 34), was = small;
    small = g;
    if (!was) return 255;
    let d = 0;
    for (let i = 0; i < g.length; i++) d += Math.abs(g[i] - was[i]);
    return d / g.length;
  }
  async function loop() {
    let unsure = 0;
    while (running) {
      await new Promise((r) => setTimeout(r, 0)); // let the page breathe
      const c = grab();
      if (!c) { await new Promise((r) => setTimeout(r, 200)); continue; }
      const still = moved(c) < 6;
      let m = null;
      try { m = await find(c, still && unsure >= 2); } catch (e) { hint.textContent = e.message; running = false; break; }
      if (!running) break;
      if (!m) {
        unsure = still ? unsure + 1 : 0;
        if (unsure > 2) unsure = -4; // read, nothing found: not again right away
        if (++empties >= 2) { armed = true; last = null; settle = null; }
        if (armed && !window.SETTINGS?.scanDebug && !hint.textContent.startsWith("Glare")) hint.textContent = "Hold a card in the frame, its bottom edge on the line";
        continue;
      }
      empties = 0; unsure = 0;
      if (last && m.id !== last) { armed = true; settle = null; } // another card
      if (last !== m.id) englishText(m.p); // loading while the next frame is taken
      if (armed && m.id === last) {
        // not far ahead of the others, the whole picture has to fit too (a dark thing on the table can look like some art)
        if (m.ahead < 0.22) {
          const e = await Promise.race([englishText(m.p), new Promise((r) => setTimeout(() => r(null), 600))]);
          if (e && findCard(pixels(c, FIND.pw, FIND.ph), e.find).q < 0.5) { last = null; continue; }
        }
        armed = false;
        missed = null;
        m.read = true;
        m.frame = snapshot(c);
        add(m);
        settle = { t: tally.at(-1), m, tries: 0 };
        settleLanguage(c);
      } else if (settle && m.id === last && still) settleLanguage(c);
      last = m.id;
    }
  }

  async function start() {
    hint.textContent = "Starting the camera…";
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    } catch (e) {
      hint.textContent = "No camera (or no permission). A photo or typing the number still works.";
      return;
    }
    video.srcObject = stream;
    await video.play().catch(() => {});
    const track = stream.getVideoTracks()[0];
    try { await track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }); } catch { /* */ }
    $s(".torch").hidden = !track.getCapabilities?.().torch;
    hint.textContent = "Loading the card pictures…";
    // the pictures are enough to start; the text recognition is only needed when they leave a doubt
    try { await artReady(); ocrWorker().catch(() => {}); } catch { try { await ocrWorker(); } catch (e) { hint.textContent = e.message; return; } }
    hint.textContent = "Hold a card in the frame, its bottom edge on the line";
    running = true; armed = true; last = null;
    loop();
  }
  function stop() {
    running = false;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  let torch = false;
  $s(".torch").onclick = async () => {
    torch = !torch;
    try { await stream.getVideoTracks()[0].applyConstraints({ advanced: [{ torch }] }); } catch { /* */ }
  };
  $s(".photo input").onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    e.target.value = "";
    hint.textContent = "Reading the photo…";
    const bmp = await createImageBitmap(f);
    const c = document.createElement("canvas");
    c.width = bmp.width; c.height = bmp.height;
    c.getContext("2d").drawImage(bmp, 0, 0);
    const m = await find(c).catch(() => null);
    if (m) { m.frame = snapshot(c); await language(m, c); add(m); } else hint.textContent = "Couldn't read that card: crop the photo to the card, or type its number";
  };
  $s("form.manual").onsubmit = (e) => {
    e.preventDefault();
    const inp = e.target.querySelector("input"), r = parseEntry(inp.value, tally.length ? PRINTS.get(tally.at(-1).id.toUpperCase())?.p.id.split("-")[0] : null);
    if (r.error != null) { hint.textContent = r.error || ""; return; }
    // typed because the scan found nothing in it a moment ago
    if (missed && Date.now() - missed.at < 30000) CORRECTIONS.add({ kind: "missed", got: null, right: { id: r.id, ver: r.ver ?? addAs }, frame: snapshot(missed.canvas), think: missed.think }).then(countFixes);
    missed = null;
    for (let i = 0; i < Math.max(1, r.n); i++) add({ ...r, sure: true });
    inp.value = "";
  };
  list.addEventListener("click", (e) => {
    const b = e.target.closest("[data-d]");
    if (!b) return;
    const t = tally[+b.dataset.i];
    t.n += +b.dataset.d;
    if (t.n <= 0) fixed(t, "removed", null);
    if (t.n <= 0) tally.splice(+b.dataset.i, 1);
    save(); show();
  });
  // two lines that became the same printing and version are one
  function merge(t) {
    const same = tally.find((x) => x !== t && x.id === t.id && (x.ver || "") === (t.ver || ""));
    if (same) { same.n += t.n; same.sure ||= t.sure; same.guess &&= t.guess; tally.splice(tally.indexOf(t), 1); }
    save(); show();
  }
  list.addEventListener("click", (e) => {
    const b = e.target.closest("[data-foil]");
    if (!b) return;
    const t = tally[+b.dataset.foil];
    const ver = verOf(langOf(t.ver), !isFoil(t.ver));
    if (t.n === 1) { t.ver = ver; return merge(t); }
    // one of several copies
    t.n--;
    const one = { ...t, k: STORE.uid(), n: 1, ver };
    tally.push(one);
    merge(one);
  });
  $s(".fixes").onclick = async () => {
    const all = (await CORRECTIONS.all()).reverse(), KIND = { printing: "wrong printing", language: "wrong language", removed: "taken off the list", missed: "not recognised" };
    const label = (x) => (x ? `${PRINTS.get(x.id.toUpperCase())?.card.name || x.id} (${x.id}, ${VERSIONS[x.ver] || x.ver})` : "–");
    const d = sheet({ title: "Corrections", cls: "wide", html: `<p class="note">Scans you corrected, with their picture. They stay in this browser; download them to improve the scan with.</p>
      <div class="row"><button type="button" class="btn filled save">Download</button><button type="button" class="btn text danger-text forget">Forget them</button></div>
      <ul class="fix-list">${all.map((c) => `<li><img src="${esc(c.frame)}" alt=""><span><b>${esc(KIND[c.kind] || c.kind)}</b><small>scan: ${esc(label(c.got))}</small>${c.right ? `<small>right: ${esc(label(c.right))}</small>` : ""}</span></li>`).join("")}</ul>` });
    $(".save", d).onclick = () => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([JSON.stringify(all)], { type: "application/json" }));
      a.download = `scan-corrections-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    $(".forget", d).onclick = async () => { if (await ask("Forget these pictures and what was wrong about them?", { yes: "Forget", danger: true })) { await CORRECTIONS.clear(); countFixes(); d.close(); } };
  };
  countFixes();
  $s(".order").onclick = () => { inOrder = !inOrder; show(); };
  list.addEventListener("change", (e) => {
    const sel = e.target.closest("select");
    if (!sel) return;
    const t = tally[+(sel.dataset.i ?? sel.dataset.ver)];
    if (sel.dataset.ver !== undefined) {
      if (langOf(sel.value) !== langOf(t.ver)) fixed(t, "language", { id: t.id, ver: sel.value });
      t.ver = sel.value; t.guess = false;
    } else { fixed(t, "printing", { id: sel.value, ver: t.ver || "" }); t.id = sel.value; t.sure = true; }
    merge(t);
  });
  $s(".addall").onclick = () => {
    onAdd(tally.map(({ id, n, ver }) => ({ id, n, ver: ver || "" })));
    hint.textContent = `Added ${tally.reduce((n, t) => n + t.n, 0)} cards to the collection`;
    tally = []; save(); show();
  };
  $s(".clear").onclick = () => { if (tally.length && confirm("Forget the scanned cards?")) { tally = []; save(); show(); } };
  $s(".close").onclick = () => dlg.close();
  dlg.addEventListener("close", stop);

  show();
  return () => { dlg.showModal(); start(); };
}
