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
let ocr = null;
function ocrWorker() {
  return (ocr ??= (async () => {
    if (!window.Tesseract) {
      await new Promise((ok, fail) => {
        const s = document.createElement("script");
        s.src = TESSERACT; s.onload = ok; s.onerror = () => fail(new Error("couldn't load the text recognition (offline on first use?)"));
        document.head.append(s);
      });
    }
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
const ART_SURE = { score: 0.55, ahead: 0.12 }; // gave no wrong card, on photos and in trials with glare, tilt and noise
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
  return { ...x, px, hp, at: new Map(x.ids.map((id, i) => [id, i])) };
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
// rgba: the pixels of a w x h picture of the card -> {score: Float32Array per printing, best, ahead, clear}
// ahead: how far the best is above the best other art; clear: the part of the art free of glare
function artMatch(rgba, w, h, ix) {
  const cells = ix.w * ix.h, N = ix.ids.length, score = new Float32Array(N).fill(-1), v = new Float32Array(cells * 3), mask = new Uint8Array(cells), x = new Float32Array(cells * 3), use = new Int32Array(cells * 3);
  let clear = 0;
  for (const s of [0.93, 1, 1.07]) for (const dx of [-0.03, 0, 0.03]) for (const dy of [-0.025, 0, 0.025]) {
    const X0 = (ART.x + ART.w / 2 + dx - ART.w * s / 2) * w, Y0 = (ART.y + ART.h / 2 + dy - ART.h * s / 2) * h, cw = ART.w * s * w / ix.w, ch = ART.h * s * h / ix.h;
    const glare = new Uint8Array(cells);
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
    if (free < cells * 0.2) continue;
    let m = 0;
    for (let k = 0; k < cells; k++) if (mask[k]) for (let c = 0; c < 3; c++) use[m++] = k * 3 + c;
    // the picture itself and its local contrast, half each
    const z = local(v, ix.w, ix.h, mask);
    const norm = centre(v, x, use, m), zn = centre(z, z, use, m);
    if (norm * norm < m * 9) continue; // nearly one colour: no picture there
    const trust = Math.min(1, 0.8 + 0.4 * free / cells); // less art to go by counts a little less
    for (let i = 0; i < N; i++) {
      const o = i * cells * 3;
      let sx = 0, s1 = 0, s2 = 0, hx = 0, h1 = 0, h2 = 0;
      for (let j = 0; j < m; j++) {
        const k = use[j], p = ix.px[o + k], q = ix.hp[o + k];
        sx += p * x[k]; s1 += p; s2 += p * p;
        hx += q * z[k]; h1 += q; h2 += q * q;
      }
      const c = trust * (sx / (norm * Math.sqrt(Math.max(1e-6, s2 - s1 * s1 / m))) + hx / (zn * Math.sqrt(Math.max(1e-6, h2 - h1 * h1 / m)))) / 2;
      if (c > score[i]) score[i] = c;
    }
  }
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
// The known card's name and rules are compared, piece by piece, with its English picture: a match is English, text that
// matches nowhere is another language. In between (glare, hardly any text) it's unsure: null.
const TEXT = { w: 200, h: 340, dx: 12, dy: 12 }; // cells per card, and how far a piece may be off
const TEXT_TILES = [0.1, 0.25, 0.4].map((x) => [x, 0.588, 0.15, 0.06])
  .concat([0.665, 0.735, 0.805].flatMap((y) => [0.1, 0.3, 0.5, 0.7].map((x) => [x, y, 0.2, 0.07])));
const ENGLISH_FROM = 0.42, OTHER_TO = 0.36; // the first eleven photos: English 0.44 to 0.70, Chinese 0.21 to 0.34
// rgba of TEXT.w x TEXT.h -> grey less its 7 x 7 mean: the strokes
function strokes(rgba) {
  const { w, h } = TEXT, g = new Float32Array(w * h), sum = new Float64Array((w + 1) * (h + 1)), out = new Float32Array(w * h);
  for (let i = 0; i < g.length; i++) g[i] = rgba[i * 4] * 0.299 + rgba[i * 4 + 1] * 0.587 + rgba[i * 4 + 2] * 0.114;
  for (let y = 0; y < h; y++) for (let x = 0, row = 0; x < w; x++) { row += g[y * w + x]; sum[(y + 1) * (w + 1) + x + 1] = sum[y * (w + 1) + x + 1] + row; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.max(0, x - 3), x1 = Math.min(w, x + 4), y0 = Math.max(0, y - 3), y1 = Math.min(h, y + 4);
    out[y * w + x] = g[y * w + x] - (sum[y1 * (w + 1) + x1] - sum[y0 * (w + 1) + x1] - sum[y1 * (w + 1) + x0] + sum[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0));
  }
  return out;
}
// how well a's text (strokes of a frame) matches b's (of the English picture): 0 to 1, or null without enough text
function textMatch(a, b) {
  const { w, h, dx, dy } = TEXT;
  let total = 0, weight = 0, n = 0;
  for (const [fx, fy, fw, fh] of TEXT_TILES) {
    const x0 = Math.floor(fx * w), y0 = Math.floor(fy * h), tw = Math.floor(fw * w), th = Math.floor(fh * h);
    let bb = 0;
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) { const t = b[(y0 + y) * w + x0 + x]; bb += t * t; }
    const energy = Math.sqrt(bb / (tw * th));
    if (energy < 11) continue; // no text there
    let best = -1, seen = 0;
    for (let oy = -dy; oy <= dy; oy++) for (let ox = -dx; ox <= dx; ox++) {
      if (x0 + ox < 0 || y0 + oy < 0 || x0 + ox + tw > w || y0 + oy + th > h) continue;
      let ab = 0, aa = 0;
      for (let y = 0; y < th; y++) for (let x = 0, i = (y0 + oy + y) * w + x0 + ox, j = (y0 + y) * w + x0; x < tw; x++, i++, j++) { ab += a[i] * b[j]; aa += a[i] * a[i]; }
      const q = ab / (Math.sqrt(bb * aa) + 1e-3);
      if (q > best) { best = q; seen = Math.sqrt(aa / (tw * th)); }
    }
    if (seen < 3) continue; // washed out
    total += best * energy; weight += energy; n++;
  }
  return n < 2 ? null : total / weight;
}
function strokesOf(src) {
  const c = document.createElement("canvas");
  c.width = TEXT.w; c.height = TEXT.h;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.imageSmoothingQuality = "high";
  g.drawImage(src, 0, 0, c.width, c.height);
  return strokes(g.getImageData(0, 0, c.width, c.height).data);
}
const ENGLISH = new Map(); // printing id -> Promise<strokes | null>
function englishText(p) {
  if (!ENGLISH.has(p.id)) ENGLISH.set(p.id, (async () => {
    if (!p.img) return null;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = p.img;
    await img.decode();
    return strokesOf(img);
  })().catch(() => { ENGLISH.delete(p.id); return null; }));
  return ENGLISH.get(p.id);
}
// {lang: "en", "zh" or null (unsure), score} for a frame showing printing p
async function readLanguage(canvas, p, card) {
  if (card.landscape || card.type === "Rune") return { lang: null, score: null }; // the text is elsewhere, or there is none
  // a slow picture must not hold up the scanning
  const b = await Promise.race([englishText(p), new Promise((r) => setTimeout(() => r(null), 2500))]);
  const s = b && textMatch(strokesOf(canvas), b);
  return { lang: s == null ? null : s >= ENGLISH_FROM ? "en" : s <= OTHER_TO ? "zh" : null, score: s ?? null };
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
  let lastFrame = null, inOrder = false;
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
    const lang = m.lang || (addAs.startsWith("zh") ? "zh" : "en"), ver = m.ver ?? verOf(lang, addAs.endsWith("foil")), t = tally.find((x) => x.id === m.id && (x.ver || "") === ver);
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
  async function find(canvas) {
    let a = null, m = null, r = { collector: "", name: "" };
    try { a = await matchArt(canvas); } catch { /* offline and never loaded: the text alone */ }
    if (a && a.score[a.best] >= ART_SURE.score && a.ahead >= ART_SURE.ahead) {
      const grp = a.ix.group[a.best], same = a.ix.ids.filter((_, i) => a.ix.group[i] === grp).map((id) => PRINTS.get(id.toUpperCase())).filter(Boolean);
      const hit = (x, sure) => ({ id: x.p.id, card: x.card, p: x.p, score: a.score[a.best], how: "art", sure });
      if (same.length === 1) m = hit(same[0], true);
      else if (same.length) {
        // the same picture on several printings: the number decides, else the first one, to be checked
        r = await recognize(canvas, { name: false });
        const read = numberCandidates(r.collector).find((c) => c.read && same.some((x) => x.p.id === c.p.id));
        const first = same.slice().sort((x, y) => (x.p.kind ? 1 : 0) - (y.p.kind ? 1 : 0))[0];
        m = hit(read || first, !!read);
      }
    }
    if (!m) {
      r = await recognize(canvas, { name: false });
      m = byArt(a, numberCandidates(r.collector), r);
    }
    if (!m) {
      r.name = (await recognize(canvas, { collector: false })).name;
      m = byArt(a, nameCandidates(r.name).flatMap((card) => card.printings.map((p) => ({ card, p }))), r);
      // no pictures to compare: the text alone, to be checked
      if (!m && (!a || r.artUnknown)) { const t = matchScan(r); if (t) m = { ...t, sure: false }; }
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
  // the language, from this frame or else the one before; and the frame itself, in case it has to be corrected
  async function language(m, ...frames) {
    for (const c of frames) {
      if (!c || m.lang) continue;
      const l = await readLanguage(c, m.p, m.card).catch(() => null);
      m.lang = l?.lang;
      if (m.think) m.think.text = l?.score ?? m.think.text;
    }
    m.read = true;
    m.frame = snapshot(frames[0]);
    missed = null;
  }
  async function loop() {
    while (running) {
      const c = grab();
      if (!c) { await new Promise((r) => setTimeout(r, 200)); continue; }
      let m = null;
      try { m = await find(c); } catch (e) { hint.textContent = e.message; running = false; break; }
      if (!running) break;
      if (!m) {
        if (++empties >= 2) { armed = true; last = null; }
        if (armed && !window.SETTINGS?.scanDebug && !hint.textContent.startsWith("Glare")) hint.textContent = "Hold a card in the frame, its bottom edge on the line";
        continue;
      }
      empties = 0;
      if (last && m.id !== last) armed = true; // another card
      if (armed && m.id === last) {
        armed = false;
        await language(m, c, lastFrame);
        if (!running) break;
        add(m);
      }
      lastFrame = c;
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
    if (m) { await language(m, c); add(m); } else hint.textContent = "Couldn't read that card: crop the photo to the card, or type its number";
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
    const ver = verOf((t.ver || "").startsWith("zh") ? "zh" : "en", !(t.ver || "").endsWith("foil"));
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
      if (sel.value.startsWith("zh") !== (t.ver || "").startsWith("zh")) fixed(t, "language", { id: t.id, ver: sel.value });
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
