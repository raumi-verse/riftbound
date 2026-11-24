"use strict";
// What every page has around its content: the bar of the game being played (store record game/current), above the
// navigation, and the service worker. Needs query.js, store.js and ui.js first.

(() => {
  if (document.body.dataset.page !== "play") {
    const bar = document.createElement("a");
    bar.id = "now";
    bar.href = "play.html";
    document.body.append(bar);
    const sum = (s) => ["conquer", "hold", "extra"].reduce((n, k) => n + (s?.[k] || 0), 0);
    const show = () => {
      const g = STORE.get("game", "current");
      bar.hidden = !g;
      document.body.toggleAttribute("data-now", !!g);
      if (!g) return;
      const deck = STORE.get("deck", g.deck), legend = CARDS.find((c) => c.id === deck?.legend), opp = CARDS.find((c) => c.id === g.oppLegend);
      const img = cardImg(legend);
      bar.style.cssText = domainStyle(legend);
      bar.innerHTML = `<span class="art"${img ? ` style="background-image:url('${esc(img)}')"` : ""}></span>
        <span class="txt"><b>${esc(deck?.name || "Game")}</b><small>vs ${esc(g.oppName || opp?.champion || "opponent")} · turn ${g.turn}</small></span>
        <span class="score">${sum(g.me)}–${sum(g.opp)}</span><span class="go" aria-hidden="true">▶</span>`;
      bar.setAttribute("aria-label", `Back to the game, ${sum(g.me)} to ${sum(g.opp)}`);
    };
    STORE.on((kinds) => { if (kinds.has("game") || kinds.has("deck")) show(); });
    show();
  }
  // offline use on the website (sw.js); file:// has no service workers
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js");
})();
