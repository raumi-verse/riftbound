"use strict";
// The account button in the header and its sheet: log in to the sync server (passkey or password), sync state, tokens
// for the Tabletop Simulator table. Needs ui.js, store.js and sync.js first.

(() => {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "account";
  $("header").append(btn);
  let dlg = null; // the open sheet
  const body = () => $(".sheet-body", dlg);

  const ago = (t) => {
    if (!t) return "never";
    const s = Math.round((Date.now() - t) / 1000);
    return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(t).toLocaleDateString();
  };
  const LABEL = { local: "on this device only", idle: "synced", syncing: "syncing…", offline: "offline, will sync later", error: "sync failed" };
  const statusLine = (s) => `<span class="dot" data-status="${s.status}"></span> ${LABEL[s.status]}${s.error ? `: ${esc(s.error)}` : ""} · last synced ${ago(s.last)}<br><small>${esc(s.server)}</small>`;

  function badge() {
    const s = SYNC.state(), inn = s.status !== "local";
    btn.dataset.status = s.status;
    btn.innerHTML = `${inn ? esc((s.name || "?")[0].toUpperCase()) : `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.6-4 3.3-6 7-6s6.4 2 7 6"/></svg>`}<span class="dot"></span>`;
    btn.title = inn ? `${s.name}: ${LABEL[s.status]}${s.error ? ` (${s.error})` : ""}` : "Log in";
    btn.setAttribute("aria-label", btn.title);
    if (!dlg) return;
    const line = $(".state", dlg);
    if (line && inn) line.innerHTML = statusLine(s); // not the rest: a token just made would disappear
    else if (inn !== (dlg.dataset.in === "true")) render();
  }

  function render() {
    const s = SYNC.state();
    dlg.dataset.in = s.status !== "local";
    $(".sheet-head h2", dlg).textContent = s.status === "local" ? "Log in" : s.name;
    if (s.status === "local") return renderLogin(s);
    body().innerHTML = `
      <p class="state">${statusLine(s)}</p>
      <div class="row"><button type="button" class="btn tonal sync">Sync now</button><button type="button" class="btn text out">Log out</button></div>
      <div class="pk"></div>
      <h3>Tabletop Simulator</h3>
      <p class="note">A token lets the table load your decks and save your games here. In the game's chat: <code>rb login &lt;token&gt;</code></p>
      <div class="tokens"><p class="note">loading…</p></div>`;
    $(".sync", dlg).onclick = () => SYNC.now();
    $(".out", dlg).onclick = async () => { await SYNC.logout(); };
    passkey();
    tokens();
  }

  async function passkey() {
    let me, how;
    try { [me, how] = await Promise.all([SYNC.call("GET", "/me"), SYNC.call("GET", "/login/methods")]); } catch { return; } // offline, or an older server
    const box = dlg && $(".pk", dlg);
    if (!box || !how.passkey) return;
    box.innerHTML = `<h3>Passkey</h3>` + (me.passkey ? `<p class="note">You log in with a passkey${me.password ? " or your password" : ""}.</p>`
      : `<p class="note">Log in with your fingerprint or face instead of the password.</p><button type="button" class="btn filled add"${SYNC.canPasskey() ? "" : " disabled"}>Add passkey</button>`);
    const add = $(".add", box);
    if (add) add.onclick = async () => { add.disabled = true; try { await SYNC.passkeyStart({ link: true }); } catch (e) { toast(e.message); add.disabled = false; } };
  }

  async function tokens() {
    let list, err;
    try { list = await SYNC.call("GET", "/tokens"); } catch (e) { err = e; }
    const box = dlg && $(".tokens", dlg);
    if (!box) return;
    if (err) { box.innerHTML = `<p class="note">${esc(err.message)}</p>`; return; }
    box.innerHTML = `
      ${list.filter((t) => t.scope === "tts").map((t) => `<div class="token"><span><b>${esc(t.label)}</b><small>made ${ago(t.created)} · used ${ago(t.used)}</small></span><button type="button" class="btn text danger-text" data-drop="${t.id}">Revoke</button></div>`).join("")}
      <form class="row new"><input name="label" placeholder="Name, e.g. my PC" maxlength="80" aria-label="The token's name"><button class="btn tonal">New token</button></form>
      <div class="made" hidden></div>`;
    box.querySelectorAll("[data-drop]").forEach((b) => (b.onclick = async () => {
      if (!(await ask("The table using this token can't load decks or save games any more.", { yes: "Revoke", danger: true }))) return;
      try { await SYNC.call("DELETE", "/tokens/" + b.dataset.drop); } catch (e) { toast(e.message); }
      tokens();
    }));
    $("form.new", box).onsubmit = async (e) => {
      e.preventDefault();
      let r;
      try { r = await SYNC.call("POST", "/tokens", { label: e.target.label.value.trim() || "Tabletop Simulator" }); } catch (x) { toast(x.message); return; }
      await tokens();
      const made = dlg && $(".made", dlg);
      if (!made) return;
      made.hidden = false;
      made.innerHTML = `<p>Paste this into the Tabletop Simulator chat. It is shown only now.</p>
        <div class="row"><code class="tok">rb login ${esc(r.token)}</code><button type="button" class="btn tonal copy">Copy</button></div>`;
      $(".copy", made).onclick = async (ev) => {
        try { await navigator.clipboard.writeText(`rb login ${r.token}`); ev.target.textContent = "Copied"; } catch { /* select it instead */ }
      };
    };
  }

  function renderLogin(s) {
    body().innerHTML = `<div class="stack">
      <p class="note">Logged in, your collection, decks and games sync between your devices and the Tabletop Simulator table.
        Without it everything stays in this browser.</p>
      ${s.error ? `<p class="err">${esc(s.error)}</p>` : ""}
      <div class="pk" hidden><button type="button" class="btn filled big passkey">Continue with passkey</button></div>
      <details class="more-fields" open><summary>Password</summary><form class="login fields">
        <label class="field"><span>Name</span><input name="name" autocomplete="username" autocapitalize="off" required></label>
        <label class="field"><span>Password</span><input name="password" type="password" autocomplete="current-password" required></label>
        <details><summary class="note">Server</summary><input name="server" value="${esc(s.server)}" spellcheck="false" autocapitalize="off" aria-label="Server"></details>
        <div class="row"><button class="btn tonal">Log in</button><span class="msg" role="status"></span></div>
      </form></details></div>`;
    const f = $("form.login", dlg), pk = $(".pk", dlg), msg = $(".msg", dlg);
    f.onsubmit = async (e) => {
      e.preventDefault();
      if (STORE.owner() && STORE.owner().toLowerCase() !== f.elements.name.value.trim().toLowerCase()
        && !(await ask(`This browser has ${STORE.owner()}'s records. Logging in as someone else removes them here (they stay on the server).`, { yes: "Go on" }))) return;
      msg.textContent = "logging in…";
      try { await SYNC.login(f.server.value, f.elements.name.value.trim(), f.password.value); } catch (x) { msg.textContent = x.message; }
    };
    // the passkey comes first where the server has it
    const look = async () => {
      let on = false;
      if (SYNC.canPasskey()) try { on = (await fetch(f.server.value.trim().replace(/\/+$/, "") + "/login/methods").then((r) => r.json())).passkey === true; } catch { /* */ }
      if (!f.isConnected) return;
      pk.hidden = !on;
      if (on && !f.contains(document.activeElement)) $(".more-fields", dlg).open = false;
    };
    $(".passkey", pk).onclick = async (e) => { e.target.disabled = true; try { await SYNC.passkeyStart({ server: f.server.value }); } catch (x) { e.target.disabled = false; toast(x.message); } };
    f.server.onchange = look;
    look();
  }

  btn.onclick = () => { dlg = sheet({ title: "", cls: "acct", onClose: () => { dlg = null; } }); render(); };
  SYNC.onState(badge);
  badge();
})();
