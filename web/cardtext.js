"use strict";
// The game's symbols and a card's rules text as HTML. Needs ui.js and query.js first.

// the game's symbols, in web/icons/ (sync.py downloads them)
const icon = (file, alt, cls = "") => `<img class="ic${cls ? " " + cls : ""}" src="icons/${file}" alt="${esc(alt)}" title="${esc(alt)}">`;
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const ICONS = {
  domain: (d) => icon(`${d.toLowerCase()}.webp`, cap(d.toLowerCase())),
  energy: (n) => icon(`${n}.svg`, `${n} energy`, "en"),
  might: () => icon("might.webp", "Might"),
  exhaust: () => icon("tap.webp", "Exhaust"),
  rune: () => icon("rune.webp", "Any rune"),
  type: (t) => ["legend", "unit", "spell", "gear", "battlefield", "rune"].includes(t.split(" ")[0].toLowerCase()) ? icon(`type-${t.split(" ")[0].toLowerCase()}.webp`, t, "ty") : "",
  rarity: (r) => ["common", "uncommon", "rare", "epic", "showcase"].includes(r.toLowerCase()) ? icon(`rarity-${r.toLowerCase()}.webp`, r, "ra") : "",
};
// A keyword's reminder text: the most common "(…)" right after it on the cards, "assault 2" and "assault" apart
const REMINDERS = (() => {
  const counts = {};
  for (const c of CARDS) for (const [, k, t] of c.alltext.matchAll(/\[([A-Za-z][A-Za-z -]*?(?: \d+)?)\] ?\(([^)]+)\)/g)) {
    const key = k.toLowerCase(), text = t[0].toUpperCase() + t.slice(1);
    ((counts[key] ??= {})[text] = (counts[key][text] || 0) + 1);
  }
  return Object.fromEntries(Object.entries(counts).map(([k, ts]) => [k, Object.entries(ts).sort((a, b) => b[1] - a[1])[0][0]]));
})();

// The reminder for a keyword on card r: none if the card prints it, else the usual one with its runes in the
// card's domain (Accelerate costs a rune of the card's domain)
function reminder(low, base, r) {
  if (r && [...r.alltext.matchAll(/\[([A-Za-z][A-Za-z -]*?(?: \d+)?)\] ?\(/g)].some((m) => m[1].toLowerCase() === low)) return null;
  const t = REMINDERS[low] || REMINDERS[base];
  if (!t || !r) return t;
  return t.replace(/:rb_rune_(?!rainbow)\w+:/g, r.domains.length === 1 ? `:rb_rune_${r.domains[0].toLowerCase()}:` : ":rb_rune_rainbow:");
}
// [Assault 2]: its own banner, else the [Assault] banner and the number, else bold text; hover or focus shows
// the reminder text. r: the card (for its reminders); null for no tooltips.
function keywordBadge(k, r) {
  const low = k.toLowerCase(), [, base, n] = low.match(/^(.*?)(?: (\d+))?$/);
  const tip = r !== null && reminder(low, base, r);
  const title = tip ? "" : ` title="${esc(k)}"`;
  const badge = KW_ICONS[low] ? `<img class="kwb" src="${KW_ICONS[low]}" alt="[${esc(k)}]"${title}>`
    : KW_ICONS[base] ? `<img class="kwb" src="${KW_ICONS[base]}" alt="[${esc(k)}]"${title}><b class="kwn">${n}</b>`
    : `<b class="kw">${esc(k)}</b>`;
  return tip ? `<span class="kwt" tabindex="0">${badge}<span class="tip"><b>${esc(k)}</b> ${richText(tip, null)}</span></span>` : badge;
}
function richText(t, r) {
  return esc(t)
    .replace(/:rb_energy_(\d+):/g, (_, n) => ICONS.energy(n))
    .replace(/:rb_might:/g, ICONS.might)
    .replace(/:rb_exhaust:/g, ICONS.exhaust)
    .replace(/:rb_rune_rainbow:/g, ICONS.rune)
    .replace(/:rb_rune_(\w+):/g, (_, d) => ICONS.domain(d))
    .replace(/\[(&gt;)+\]/g, "▶")
    .replace(/\[([A-Za-z][A-Za-z -]*?(?: \d+)?)\]/g, (_, k) => keywordBadge(k, r))
    .replace(/\n/g, "<br>");
}

const dots = (ds) => ds.map(ICONS.domain).join("");
// power is paid in runes of the card's domain; with two domains the split isn't in the data
const powerIcons = (r) => !r.power ? "" : r.domains.length === 1 ? ICONS.domain(r.domains[0]).repeat(r.power) : `${r.power}${ICONS.rune()}`;
const cost = (r) => [r.energy != null ? ICONS.energy(r.energy) : "", powerIcons(r)].join("");
