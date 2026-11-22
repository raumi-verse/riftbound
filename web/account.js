"use strict";
// The account button in the header and its dialog: log in to the sync server, sync state, tokens for the Tabletop
// Simulator table. Needs store.js and sync.js first.

(() => {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "account";
  btn.title = "Account and sync";
  document.querySelector("header").append(btn);

  const dlg = document.createElement("dialog");
  dlg.className = "acct";
  document.body.append(dlg);
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); }); // a click on the backdrop

  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const ago = (t) => {
    if (!t) return "never";
    const s = Math.round((Date.now() - t) / 1000);
    return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(t).toLocaleDateString();
  };
  const LABEL = { local: "on this device only", idle: "synced", syncing: "syncing…", offline: "offline, will sync later", error: "sync failed" };

  function badge() {
    const s = SYNC.state();
    btn.dataset.status = s.status;
    btn.innerHTML = `<span class="dot"></span><span class="who">${s.status !== "local" ? esc(s.name) : "Log in"}</span>`;
    btn.title = `Account and sync: ${LABEL[s.status]}${s.error ? ` (${s.error})` : ""}`;
    if (dlg.open && !dlg.querySelector("form.login input:focus, .tokens input:focus")) render();
  }

  function render() {
    const s = SYNC.state();
    if (s.status === "local") return renderLogin(s);
    dlg.innerHTML = `
      <h2>${esc(s.name)} <button type="button" class="x" aria-label="Close">✕</button></h2>
      <p class="line"><span class="dot" data-status="${s.status}"></span> ${LABEL[s.status]}${s.error ? `: ${esc(s.error)}` : ""} · last synced ${ago(s.last)}<br>
        <small>${esc(s.server)}</small></p>
      <div class="row"><button type="button" class="sync">Sync now</button><button type="button" class="out">Log out</button></div>
      <h3>Tabletop Simulator</h3>
      <p class="note">A token lets the table load your decks and save your games here. In the game's chat: <code>rb login &lt;token&gt;</code></p>
      <div class="tokens"><p class="note">loading…</p></div>`;
    dlg.querySelector(".x").onclick = () => dlg.close();
    dlg.querySelector(".sync").onclick = () => SYNC.now();
    dlg.querySelector(".out").onclick = async () => { await SYNC.logout(); render(); };
    tokens();
  }

  async function tokens() {
    const box = dlg.querySelector(".tokens");
    let list;
    try { list = await SYNC.call("GET", "/tokens"); } catch (e) { box.innerHTML = `<p class="note">${esc(e.message)}</p>`; return; }
    const tts = list.filter((t) => t.scope === "tts");
    box.innerHTML = `
      ${tts.length ? `<table class="gf-table">${tts.map((t) => `<tr><td>${esc(t.label)}</td><td><small>made ${ago(t.created)} · used ${ago(t.used)}</small></td>
        <td><button type="button" data-drop="${t.id}">Revoke</button></td></tr>`).join("")}</table>` : ""}
      <form class="row new"><input name="label" placeholder="Name, e.g. my PC" maxlength="80"><button>New token</button></form>
      <div class="made" hidden></div>`;
    box.querySelectorAll("[data-drop]").forEach((b) => (b.onclick = async () => {
      if (!confirm("Revoke this token? The table using it can't load decks or save games any more.")) return;
      try { await SYNC.call("DELETE", "/tokens/" + b.dataset.drop); } catch (e) { alert(e.message); }
      tokens();
    }));
    box.querySelector("form.new").onsubmit = async (e) => {
      e.preventDefault();
      let r;
      try { r = await SYNC.call("POST", "/tokens", { label: e.target.label.value.trim() || "Tabletop Simulator" }); } catch (x) { alert(x.message); return; }
      await tokens();
      const made = dlg.querySelector(".tokens .made");
      made.hidden = false;
      made.innerHTML = `<p>Paste this into the Tabletop Simulator chat. It is shown only now.</p>
        <div class="row"><code class="tok">rb login ${esc(r.token)}</code><button type="button" class="copy">Copy</button></div>`;
      made.querySelector(".copy").onclick = async (ev) => {
        try { await navigator.clipboard.writeText(`rb login ${r.token}`); ev.target.textContent = "Copied"; } catch { /* select it instead */ }
      };
    };
  }

  function renderLogin(s) {
    dlg.innerHTML = `
      <h2>Log in <button type="button" class="x" aria-label="Close">✕</button></h2>
      <p class="note">Logged in, your collection, decks and games sync between your devices (and the Tabletop Simulator table).
        Without it everything stays in this browser. Accounts are made on the server; there is no sign-up.</p>
      ${s.error ? `<p class="err">${esc(s.error)}</p>` : ""}
      <form class="login">
        <label>Name <input name="name" autocomplete="username" required></label>
        <label>Password <input name="password" type="password" autocomplete="current-password" required></label>
        <details><summary>Server</summary><input name="server" value="${esc(s.server)}" spellcheck="false"></details>
        <div class="row"><button>Log in</button><span class="msg"></span></div>
      </form>`;
    dlg.querySelector(".x").onclick = () => dlg.close();
    const f = dlg.querySelector("form.login");
    f.onsubmit = async (e) => {
      e.preventDefault();
      const msg = f.querySelector(".msg");
      if (STORE.owner() && STORE.owner().toLowerCase() !== f.name.value.trim().toLowerCase()
        && !confirm(`This browser has ${STORE.owner()}'s records. Logging in as someone else removes them here (they stay on the server). Go on?`)) return;
      msg.textContent = "logging in…";
      try { await SYNC.login(f.server.value, f.name.value.trim(), f.password.value); render(); } catch (x) { msg.textContent = x.message; }
    };
    f.name.focus();
  }

  btn.onclick = () => { render(); dlg.showModal(); };
  SYNC.onState(badge);
  badge();
})();
