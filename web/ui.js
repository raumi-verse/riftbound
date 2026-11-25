"use strict";
// The controls every page shares: escaping, sheets, toasts, steppers, chips. No other file needed first.
//
//   sheet({title, cls, html, onClose}) -> <dialog>, open; .close() shuts and removes it
//   ask(text, {yes, no, danger}) -> Promise<bool>     toast(text, {undo: fn})
//   stepper(name, value, {min, max, label})           a number with − and +; a named input inside forms
//   tagInput(name, values, known)                     chips to tick and a field to add one; form[name].value is "a, b"
//   fillChips(name, values)                           earlier values that fill the form's input [name]
//   onHold(root, selector, (el) => …)                  a long press (or right click, or the menu key) on one of those
//   seg(legend, name, [[value, label]], current)      one of a few

const $ = (s, root = document) => root.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const cardImg = (c) => c && (c.printings.find((p) => p.id === c.id)?.img || c.printings.find((p) => p.img)?.img);
const splitTags = (s) => [...new Set(String(s).split(",").map((t) => t.trim()).filter(Boolean))];
// the colour of a legend's game or deck: its domains
const domainStyle = (c) => { const d = (c?.domains || []).map((x) => `var(--${x.toLowerCase()})`); return d.length ? `--c1:${d[0]};--c2:${d[1] || d[0]}` : ""; };
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
// change the page inside a view transition where the browser has them
const smoothly = (change) => { if (document.startViewTransition && !reducedMotion()) return document.startViewTransition(change); change(); return null; };

function sheet({ title = "", cls = "", html = "", onClose } = {}) {
  const d = document.createElement("dialog");
  d.className = `sheet ${cls}`;
  d.innerHTML = `<div class="sheet-head"><h2 tabindex="-1" autofocus>${esc(title)}</h2><button type="button" class="icon-btn x" aria-label="Close">✕</button></div><div class="sheet-body">${html}</div>`;
  document.body.append(d);
  $(".x", d).onclick = () => d.close();
  d.addEventListener("click", (e) => { if (e.target === d) d.close(); }); // the backdrop
  d.addEventListener("close", (e) => { if (e.target !== d) return; d.remove(); onClose?.(); });
  d.showModal();
  return d;
}

function ask(text, { yes = "OK", no = "Cancel", danger = false } = {}) {
  return new Promise((done) => {
    let answer = false;
    const d = sheet({ title: yes, cls: "ask", html: `<p>${esc(text)}</p><div class="row end"><button type="button" class="btn text no">${esc(no)}</button><button type="button" class="btn ${danger ? "danger" : "filled"} yes">${esc(yes)}</button></div>`, onClose: () => done(answer) });
    $(".no", d).onclick = () => d.close();
    $(".yes", d).onclick = () => { answer = true; d.close(); };
    $(".yes", d).focus();
  });
}

let toastTimer;
function toast(text, { undo } = {}) {
  $("#toast")?.remove();
  clearTimeout(toastTimer);
  const t = document.createElement("div");
  t.id = "toast";
  t.setAttribute("role", "status");
  t.innerHTML = `<span>${esc(text)}</span>${undo ? `<button type="button">Undo</button>` : ""}`;
  // inside the open sheet, or it would lie under its backdrop
  ([...document.querySelectorAll("dialog[open]")].at(-1) || document.body).append(t);
  if (undo) $("button", t).onclick = () => { t.remove(); undo(); };
  toastTimer = setTimeout(() => t.remove(), undo ? 6000 : 3000);
}

function onHold(root, selector, fn) {
  let timer, from = null, held = false;
  const stop = () => { clearTimeout(timer); from = null; };
  const hold = (el) => { stop(); held = true; fn(el); };
  root.addEventListener("pointerdown", (e) => {
    stop();
    held = false;
    const el = e.button === 0 && e.target.closest(selector);
    if (!el) return;
    from = [e.clientX, e.clientY];
    timer = setTimeout(() => { navigator.vibrate?.(25); hold(el); }, 450);
  });
  root.addEventListener("pointermove", (e) => { if (from && Math.hypot(e.clientX - from[0], e.clientY - from[1]) > 10) stop(); });
  for (const t of ["pointerup", "pointercancel", "pointerleave"]) root.addEventListener(t, stop);
  root.addEventListener("contextmenu", (e) => {
    const el = e.target.closest(selector);
    if (!el) return;
    e.preventDefault();
    if (!held) hold(el); // a phone sends this during the press too
  });
  // letting go isn't a tap
  root.addEventListener("click", (e) => { if (held && e.detail) { held = false; if (e.target.closest(selector)) { e.preventDefault(); e.stopImmediatePropagation(); } } }, true);
}

const stepper = (name, value, { min = 0, max = 99, label = name } = {}) =>
  `<span class="stepper"><button type="button" data-step="-1" aria-label="${esc(label)}: one less">−</button><input type="number" inputmode="numeric" name="${esc(name)}" value="${esc(value)}" min="${min}" max="${max}" aria-label="${esc(label)}"><button type="button" data-step="1" aria-label="${esc(label)}: one more">+</button></span>`;

const seg = (legend, name, options, current) => `<fieldset class="seg"><legend>${esc(legend)}</legend><div>${options.map(([v, l]) =>
  `<label><input type="radio" name="${esc(name)}" value="${esc(v)}"${String(current ?? "") === String(v) ? " checked" : ""}><span>${esc(l)}</span></label>`).join("")}</div></fieldset>`;

const fillChips = (name, values) => values.length ? `<div class="chips">${values.map((v) => `<button type="button" class="chip-btn" data-fill="${esc(name)}" data-v="${esc(v)}">${esc(v)}</button>`).join("")}</div>` : "";

const tagChip = (t, on) => `<button type="button" class="chip-btn" data-tag="${esc(t)}" aria-pressed="${on}">${esc(t)}</button>`;
function tagInput(name, values, known = []) {
  const all = [...new Set([...values, ...known])];
  return `<div class="tag-input"><input type="hidden" name="${esc(name)}" value="${esc(values.join(", "))}"><div class="chips">${all.map((t) => tagChip(t, values.includes(t))).join("")}<input class="tag-new" placeholder="add a tag" enterkeyhint="done" autocomplete="off" aria-label="Add a tag"></div></div>`;
}
function writeTags(box) {
  const h = $("input[type=hidden]", box);
  h.value = [...box.querySelectorAll('[aria-pressed="true"]')].map((b) => b.dataset.tag).join(", ");
  h.dispatchEvent(new Event("change", { bubbles: true }));
}
function addTag(input) {
  const box = input.closest(".tag-input");
  for (const t of splitTags(input.value)) {
    const old = [...box.querySelectorAll("[data-tag]")].find((b) => b.dataset.tag.toLowerCase() === t.toLowerCase());
    if (old) old.setAttribute("aria-pressed", "true");
    else input.insertAdjacentHTML("beforebegin", tagChip(t, true));
  }
  input.value = "";
  writeTags(box);
}

document.addEventListener("click", (e) => {
  const step = e.target.closest(".stepper [data-step]");
  if (step) {
    const i = $("input", step.parentNode);
    i.value = Math.min(+i.max, Math.max(+i.min, (parseInt(i.value) || 0) + Number(step.dataset.step)));
    i.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  const fill = e.target.closest("[data-fill]");
  if (fill) { const i = fill.closest("form").elements[fill.dataset.fill]; i.value = fill.dataset.v; i.dispatchEvent(new Event("change", { bubbles: true })); return; }
  const tag = e.target.closest(".tag-input [data-tag]");
  if (tag) { tag.setAttribute("aria-pressed", tag.getAttribute("aria-pressed") !== "true"); writeTags(tag.closest(".tag-input")); }
});
document.addEventListener("keydown", (e) => {
  if (e.target.matches?.(".tag-new") && (e.key === "Enter" || e.key === ",")) { e.preventDefault(); if (e.target.value.trim()) addTag(e.target); }
}, true);
// a tag typed but not confirmed counts too (before the form's own submit handler reads it)
document.addEventListener("focusout", (e) => { if (e.target.matches?.(".tag-new") && e.target.value.trim()) addTag(e.target); });
