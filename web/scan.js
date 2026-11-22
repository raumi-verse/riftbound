"use strict";
// Scanning cards with the camera. The collector line at the bottom left ("OGN • 030a/298") names the printing; the
// name is read too, to confirm it or to find the card when the number can't be read. OCR is Tesseract.js, loaded
// on first use (the service worker keeps it for offline use). Needs query.js and collection.js (PRINTS).
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

// ---------- checking the art ----------
// A misread number can name a real card (030a read as 300), so the frame is compared with the printing's picture:
// both shrunk to a small grey thumbnail of the art (the top of the card), normalised, correlated. 1 the same picture,
// around 0 unrelated ones.
const ART = { x: 0.08, y: 0.1, w: 0.84, h: 0.42 }, THUMB = [24, 16];
function thumb(src) {
  const [w, h] = THUMB, c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.imageSmoothingQuality = "high";
  const sw = src.width, sh = src.height;
  g.drawImage(src, sw * ART.x, sh * ART.y, sw * ART.w, sh * ART.h, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data, v = new Float32Array(w * h);
  let mean = 0;
  for (let i = 0; i < v.length; i++) { v[i] = d[i * 4] * 0.3 + d[i * 4 + 1] * 0.6 + d[i * 4 + 2] * 0.1; mean += v[i]; }
  mean /= v.length;
  let sd = 0;
  for (let i = 0; i < v.length; i++) { v[i] -= mean; sd += v[i] * v[i]; }
  sd = Math.sqrt(sd / v.length) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= sd;
  return v;
}
const THUMBS = new Map(); // printing id -> Promise<thumb | null>
function printThumb(p) {
  if (!THUMBS.has(p.id)) {
    THUMBS.set(p.id, (async () => {
      if (!p.img) return null;
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = p.img;
      await img.decode();
      return thumb(img);
    })().catch(() => null));
  }
  return THUMBS.get(p.id);
}
async function artScore(frame, p) {
  const t = await printThumb(p);
  if (!t) return null; // no picture (offline and never seen): can't tell
  const f = thumb(frame);
  let s = 0;
  for (let i = 0; i < t.length; i++) s += t[i] * f[i];
  return s / t.length;
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
async function byArt(frame, cands, r) {
  let best = null, known = false;
  for (const c of cands) {
    const s = await artScore(frame, c.p);
    if (s == null) continue;
    known = true;
    if (!best || s > best.score + 0.03 || (Math.abs(s - best.score) <= 0.03 && c.read && !best.read)) best = { ...c, score: s };
  }
  if (cands.length && !known) r.artUnknown = true;
  return best && best.score >= 0.5 ? { id: best.p.id, card: best.card, p: best.p, score: best.score, how: "art", sure: true } : null;
}

// ---------- the scan screen (index.html #scan) ----------
// Hold cards into the frame one after another. A card counts when two frames in a row agree; the same card counts
// again only after the camera saw no card (or another one). The tally is kept until "Add all".

function initScan(onAdd) {
  const dlg = document.getElementById("scan");
  if (!dlg) return;
  const $s = (q) => dlg.querySelector(q);
  const video = $s("video"), guide = $s(".guide"), hint = $s(".hint"), list = $s(".tally");
  const KEY = "rb-scan-tally";
  let tally = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } })(); // [{id, n}]
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
    list.innerHTML = tally.map((t, i) => {
      const hit = PRINTS.get(t.id.toUpperCase());
      if (!hit) return "";
      const { card, p } = hit;
      const opts = card.printings.length > 1 ? `<select data-i="${i}">${card.printings.map((x) => `<option value="${esc(x.id)}"${x.id === p.id ? " selected" : ""}>${esc(x.id)}${x.kind ? ` · ${esc(x.kind)}` : ""}</option>`).join("")}</select>` : `<small>${esc(p.id)}</small>`;
      return `<li class="${t.sure ? "" : "unsure"}">${p.img ? `<img src="${esc(p.img)}" alt="">` : ""}<span class="nm"><b>${esc(card.name)}</b>${opts}${t.sure ? "" : `<small class="warn">by name: check the printing</small>`}</span>
        <span class="own"><span role="button" data-d="-1" data-i="${i}">−</span><b>${t.n}</b><span role="button" data-d="1" data-i="${i}">+</span></span></li>`;
    }).reverse().join("");
  }
  function add(m) {
    const t = tally.find((x) => x.id === m.id);
    if (t) { t.n++; tally.splice(tally.indexOf(t), 1); tally.push(t); } else tally.push({ id: m.id, n: 1, sure: m.sure });
    save(); show(); beep();
    hint.textContent = `+1 ${m.card.name}`;
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
    const r = await recognize(canvas, { name: false });
    let m = await byArt(canvas, numberCandidates(r.collector), r);
    if (!m) {
      r.name = (await recognize(canvas, { collector: false })).name;
      m = await byArt(canvas, nameCandidates(r.name).flatMap((card) => card.printings.map((p) => ({ card, p }))), r);
      // no pictures to compare (offline and never seen): the text alone, to be checked
      if (!m && r.artUnknown) { const t = matchScan(r); if (t) m = { ...t, sure: false }; }
    }
    if (window.SETTINGS?.scanDebug) { hint.textContent = `${canvas.width}×${canvas.height} · ${r.collector.replace(/\s+/g, " ")} · ${r.name.replace(/\s+/g, " ").slice(0, 50)} → ${m ? `${m.id} ${m.score?.toFixed(2) ?? ""}` : "-"}`; window.SCAN_LAST = canvas; }
    return m;
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
        if (armed && !window.SETTINGS?.scanDebug) hint.textContent = "Hold a card in the frame, its bottom edge on the line";
        continue;
      }
      empties = 0;
      if (last && m.id !== last) armed = true; // another card
      if (armed && m.id === last) { armed = false; add(m); }
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
    hint.textContent = "Loading the text recognition…";
    try { await ocrWorker(); } catch (e) { hint.textContent = e.message; return; }
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
    if (m) add(m); else hint.textContent = "Couldn't read that card: crop the photo to the card, or type its number";
  };
  $s("form.manual").onsubmit = (e) => {
    e.preventDefault();
    const inp = e.target.querySelector("input"), r = parseEntry(inp.value, tally.length ? PRINTS.get(tally.at(-1).id.toUpperCase())?.p.id.split("-")[0] : null);
    if (r.error != null) { hint.textContent = r.error || ""; return; }
    for (let i = 0; i < Math.max(1, r.n); i++) add({ ...r, sure: true });
    inp.value = "";
  };
  list.addEventListener("click", (e) => {
    const b = e.target.closest("[data-d]");
    if (!b) return;
    const t = tally[+b.dataset.i];
    t.n += +b.dataset.d;
    if (t.n <= 0) tally.splice(+b.dataset.i, 1);
    save(); show();
  });
  list.addEventListener("change", (e) => {
    const sel = e.target.closest("select");
    if (!sel) return;
    const t = tally[+sel.dataset.i], same = tally.find((x) => x.id === sel.value && x !== t);
    if (same) { same.n += t.n; tally.splice(tally.indexOf(t), 1); } else { t.id = sel.value; t.sure = true; }
    save(); show();
  });
  $s(".addall").onclick = () => {
    onAdd(tally.map(({ id, n }) => ({ id, n })));
    hint.textContent = `Added ${tally.reduce((n, t) => n + t.n, 0)} cards to the collection`;
    tally = []; save(); show();
  };
  $s(".clear").onclick = () => { if (tally.length && confirm("Forget the scanned cards?")) { tally = []; save(); show(); } };
  $s(".close").onclick = () => dlg.close();
  dlg.addEventListener("close", stop);

  show();
  return () => { dlg.showModal(); start(); };
}
