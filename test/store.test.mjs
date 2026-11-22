// The page's record store and its sync, against the real server.py on a free port: node --test test/
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const plain = (x) => JSON.parse(JSON.stringify(x));

// a "device": its own window, localStorage and timers, sharing node's fetch
function device(server) {
  const data = new Map();
  const localStorage = {
    getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k),
    key: (i) => [...data.keys()][i] ?? null, get length() { return data.size; },
  };
  const net = { up: true };
  const f = (...a) => (net.up ? fetch(...a) : Promise.reject(new TypeError("network down")));
  const ctx = vm.createContext({ localStorage, fetch: f, console, setTimeout: () => 0, clearTimeout: () => {}, Date, Math, JSON, Promise });
  ctx.window = ctx;
  ctx.SETTINGS = { syncServer: server };
  for (const f of ["web/store.js", "web/sync.js"]) vm.runInContext(readFileSync(new URL(f, root), "utf8"), ctx, { filename: f });
  return { STORE: vm.runInContext("STORE", ctx), SYNC: vm.runInContext("SYNC", ctx), data, net };
}

let srv, url, dir;
before(async () => {
  dir = mkdtempSync(join(tmpdir(), "rb-"));
  const db = join(dir, "rb.sqlite"), py = new URL("server.py", root).pathname;
  for (const [n, pw] of [["ann", "secret-ann"], ["bob", "secret-bob"]]) {
    const r = spawnSync("python3", [py, "--db", db, "adduser", n], { input: pw + "\n" });
    assert.equal(r.status, 0, String(r.stderr));
  }
  srv = spawn("python3", [py, "--db", db, "serve", "--host", "127.0.0.1", "--port", "0"]);
  url = await new Promise((ok, fail) => {
    srv.stderr.on("data", (b) => { const m = String(b).match(/:(\d+),/); if (m) ok(`http://127.0.0.1:${m[1]}`); });
    srv.on("exit", (c) => fail(new Error(`server exited ${c}`)));
  });
});
after(() => { srv?.kill(); rmSync(dir, { recursive: true, force: true }); });

test("put, get, update, delete, listeners", () => {
  const { STORE } = device("http://unused");
  const seen = [];
  STORE.on((k) => seen.push([...k]));
  STORE.put("coll", "OGN-001", { n: 2 });
  STORE.update("coll", "OGN-001", (o) => ({ n: (o?.n ?? 0) + 1 }));
  assert.deepEqual(plain(STORE.get("coll", "OGN-001")), { n: 3 });
  STORE.del("coll", "OGN-001");
  assert.equal(STORE.get("coll", "OGN-001"), null);
  assert.deepEqual(plain(STORE.all("coll")), []);
  assert.deepEqual(seen, [["coll"], ["coll"], ["coll"]]);
  const p = plain(STORE.pending());
  assert.equal(p.length, 1); // one record, its last state
  assert.equal(p[0].deleted, true);
});

test("survives a reload", () => {
  const d = device("http://unused");
  d.STORE.put("deck", "d1", { name: "Jinx" });
  const ctx = vm.createContext({ localStorage: { getItem: (k) => d.data.get(k) ?? null, setItem: () => {} }, console, Date, Math, JSON });
  ctx.window = ctx;
  vm.runInContext(readFileSync(new URL("web/store.js", root), "utf8"), ctx);
  assert.deepEqual(plain(vm.runInContext("STORE", ctx).get("deck", "d1")), { name: "Jinx" });
});

test("two devices of one account", async () => {
  const phone = device(url), pc = device(url);
  phone.STORE.put("coll", "OGN-001", { n: 1 }); // made before logging in: goes up with the first sync
  assert.equal(await phone.SYNC.login(url, "ann", "secret-ann"), "ann");
  assert.deepEqual(plain(phone.STORE.pending()), []);
  await pc.SYNC.login(url, "ann", "secret-ann");
  assert.deepEqual(plain(pc.STORE.get("coll", "OGN-001")), { n: 1 });

  pc.STORE.put("deck", "d1", { name: "Jinx", status: "pinned" });
  pc.STORE.del("coll", "OGN-001");
  await pc.SYNC.now();
  await phone.SYNC.now();
  assert.equal(phone.STORE.get("deck", "d1").name, "Jinx");
  assert.equal(phone.STORE.get("coll", "OGN-001"), null);
  assert.equal(phone.SYNC.state().status, "idle");
});

test("offline edits: newest wins, the other device's older edit loses", async () => {
  const a = device(url), b = device(url);
  await a.SYNC.login(url, "ann", "secret-ann");
  await b.SYNC.login(url, "ann", "secret-ann");
  b.STORE.put("coll", "X", { n: 5 }); // older
  await new Promise((r) => setTimeout(r, 5));
  a.STORE.put("coll", "X", { n: 9 }); // newer
  await a.SYNC.now();
  await b.SYNC.now();
  assert.deepEqual(plain(b.STORE.get("coll", "X")), { n: 9 });
  assert.deepEqual(plain(b.STORE.pending()), []);
});

test("another account on the device starts empty; wrong password; logout", async () => {
  const d = device(url);
  await d.SYNC.login(url, "ann", "secret-ann");
  d.STORE.put("coll", "ann-only", { n: 1 });
  await d.SYNC.now();
  await d.SYNC.logout();
  assert.equal(d.SYNC.state().status, "local");
  await assert.rejects(d.SYNC.login(url, "bob", "nope"), /wrong name or password/);
  await d.SYNC.login(url, "bob", "secret-bob");
  assert.equal(d.STORE.get("coll", "ann-only"), null);
  const bob = device(url);
  await bob.SYNC.login(url, "bob", "secret-bob");
  assert.equal(bob.STORE.get("coll", "ann-only"), null); // didn't go up to bob's account either
});

test("offline: the edit waits in the outbox and goes up when the network is back", async () => {
  const d = device(url), other = device(url);
  await d.SYNC.login(url, "ann", "secret-ann");
  d.net.up = false;
  d.STORE.put("match", "m1", { result: "win", notes: "on the train" });
  await d.SYNC.now();
  assert.equal(d.SYNC.state().status, "offline");
  assert.equal(d.STORE.pending().length, 1);
  d.net.up = true;
  await d.SYNC.now();
  assert.equal(d.SYNC.state().status, "idle");
  assert.equal(d.STORE.pending().length, 0);
  await other.SYNC.login(url, "ann", "secret-ann");
  assert.equal(other.STORE.get("match", "m1").notes, "on the train");
  await assert.rejects(device(url).SYNC.login("http://127.0.0.1:9", "ann", "x"), /can't reach/);
});
