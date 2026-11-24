"use strict";
// Where a passkey login comes back to: #code=… becomes a session (sync.js), then on to the page it started from.

(async () => {
  const q = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, "", location.pathname); // the code stays out of the history
  const fail = (text) => { $("h1").textContent = "That didn't work"; $(".note").textContent = text; $("a.btn").hidden = false; };
  if (q.has("error")) return fail(q.get("error"));
  if (!q.has("code")) return fail("There is no login going on.");
  try {
    const r = await SYNC.passkeyFinish(q.get("code"), (name) => ask(`This browser has ${STORE.owner()}'s records. Logging in as ${name} removes them here (they stay on the server).`, { yes: "Go on" }));
    location.replace(r.back);
  } catch (e) { fail(e.message); }
})();
