"""The sync server over real HTTP on a free port with a fresh database: python3 -m unittest discover test"""
import json
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import server  # noqa: E402

server.Handler.log_message = lambda *a: None  # no request lines in the test output


class Server(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        db = str(Path(self.dir.name) / "rb.sqlite")
        server.DB(db).add_user("ann", "secret-ann")
        server.DB(db).add_user("bob", "secret-bob")
        self.srv = server.make_server(db, "127.0.0.1", 0, origins=["https://rb.raumi.dev"])
        self.url = f"http://127.0.0.1:{self.srv.server_address[1]}"
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def tearDown(self):
        self.srv.shutdown()
        self.srv.server_close()
        self.dir.cleanup()

    def call(self, method, path, body=None, token=None, headers=None):
        h = {"Content-Type": "application/json", **(headers or {})}
        if token:
            h["Authorization"] = "Bearer " + token
        req = urllib.request.Request(self.url + path, method=method, headers=h,
                                     data=None if body is None else json.dumps(body).encode())
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, json.load(r) if r.status != 204 else None, r.headers
        except urllib.error.HTTPError as e:
            with e:
                return e.code, json.load(e), e.headers

    def login(self, name="ann", pw=None):
        s, b, _ = self.call("POST", "/login", {"name": name, "password": pw or f"secret-{name}"})
        self.assertEqual(s, 200, b)
        return b["token"]

    def sync(self, token, since=0, changes=()):
        s, b, _ = self.call("POST", "/sync", {"since": since, "changes": list(changes)}, token)
        self.assertEqual(s, 200, b)
        return b

    def test_health_and_login(self):
        self.assertEqual(self.call("GET", "/health")[0], 200)
        self.assertEqual(self.call("POST", "/login", {"name": "ann", "password": "nope"})[0], 401)
        self.assertEqual(self.call("POST", "/login", {"name": "nobody", "password": "x"})[0], 401)
        t = self.login("ANN", "secret-ann")  # names ignore case
        self.assertEqual(self.call("GET", "/me", token=t)[1], {"name": "ann"})
        self.assertEqual(self.call("GET", "/me")[0], 401)
        self.assertEqual(self.call("GET", "/me", token="made-up")[0], 401)
        self.assertEqual(self.call("POST", "/logout", token=t)[0], 200)
        self.assertEqual(self.call("GET", "/me", token=t)[0], 401)

    def test_login_attempts_are_limited(self):
        for _ in range(server.LOGIN_TRIES[0]):
            self.assertEqual(self.call("POST", "/login", {"name": "ann", "password": "nope"})[0], 401)
        self.assertEqual(self.call("POST", "/login", {"name": "ann", "password": "secret-ann"})[0], 429)

    def test_sync_between_two_devices(self):
        phone, pc = self.login(), self.login()
        r = self.sync(phone, 0, [{"kind": "coll", "id": "OGN-001", "data": {"n": 3}, "updated": 100},
                                 {"kind": "deck", "id": "d1", "data": {"name": "Jinx"}, "updated": 100}])
        self.assertEqual(len(r["changes"]), 2)  # its own changes come back too, with the cursor after them
        got = self.sync(pc)
        self.assertEqual({(c["kind"], c["id"]) for c in got["changes"]}, {("coll", "OGN-001"), ("deck", "d1")})
        self.assertEqual(self.sync(pc, got["cursor"])["changes"], [])
        # the pc edits and deletes, the phone sees both
        self.sync(pc, got["cursor"], [{"kind": "coll", "id": "OGN-001", "data": {"n": 4}, "updated": 200},
                                      {"kind": "deck", "id": "d1", "deleted": True, "updated": 200}])
        back = {c["id"]: c for c in self.sync(phone, r["cursor"])["changes"]}
        self.assertEqual(back["OGN-001"]["data"], {"n": 4})
        self.assertTrue(back["d1"]["deleted"])
        self.assertIsNone(back["d1"]["data"])

    def test_newest_edit_wins(self):
        t = self.login()
        self.sync(t, 0, [{"kind": "coll", "id": "x", "data": {"n": 2}, "updated": 500}])
        self.sync(t, 0, [{"kind": "coll", "id": "x", "data": {"n": 9}, "updated": 400}])  # older, offline edit
        self.assertEqual(self.sync(t)["changes"][0]["data"], {"n": 2})
        far = server.now_ms() + 10**9  # a clock far ahead is capped, so a normal edit later still wins
        self.sync(t, 0, [{"kind": "coll", "id": "x", "data": {"n": 5}, "updated": far}])
        self.sync(t, 0, [{"kind": "coll", "id": "x", "data": {"n": 6}, "updated": server.now_ms() + 120_000}])
        self.assertEqual(self.sync(t)["changes"][0]["data"], {"n": 6})

    def test_users_are_separate(self):
        a, b = self.login("ann"), self.login("bob")
        self.sync(a, 0, [{"kind": "coll", "id": "OGN-001", "data": {"n": 1}, "updated": 1}])
        self.assertEqual(self.sync(b)["changes"], [])
        self.sync(b, 0, [{"kind": "coll", "id": "OGN-001", "data": {"n": 7}, "updated": 1}])
        self.assertEqual(self.sync(a)["changes"][0]["data"], {"n": 1})

    def test_paging(self):
        t = self.login()
        n = server.PAGE + 5
        self.sync(t, 0, [{"kind": "coll", "id": f"c{i}", "data": {"n": 1}, "updated": 1} for i in range(n)])
        first = self.sync(t)
        self.assertTrue(first["more"])
        second = self.sync(t, first["cursor"])
        self.assertFalse(second["more"])
        self.assertEqual(len(first["changes"]) + len(second["changes"]), n)

    def test_restored_database_sends_everything(self):
        t = self.login()
        self.sync(t, 0, [{"kind": "coll", "id": "a", "data": {"n": 1}, "updated": 1}])
        self.assertEqual(len(self.sync(t, 999)["changes"]), 1)

    def test_bad_input(self):
        t = self.login()
        for ch in [{"kind": "Coll!", "id": "a", "data": {}, "updated": 1}, {"kind": "coll", "id": "", "data": {}, "updated": 1},
                   {"kind": "coll", "id": "a", "data": {}, "updated": "1"}, {"kind": "coll", "id": "a", "data": 3, "updated": 1}]:
            self.assertEqual(self.call("POST", "/sync", {"changes": [ch]}, t)[0], 400, ch)
        self.assertEqual(self.call("POST", "/sync", {"since": -1}, t)[0], 400)
        self.assertEqual(self.call("GET", "/nothing")[0], 404)
        self.assertEqual(self.call("DELETE", "/sync", token=t)[0], 405)

    def test_table_tokens(self):
        t = self.login()
        s, b, _ = self.call("POST", "/tokens", {"label": "my TTS"}, t)
        self.assertEqual(s, 200)
        tts = b["token"]
        self.assertEqual(self.call("POST", "/sync", {}, tts)[0], 403)  # a table token can't read the records
        self.assertEqual(self.call("GET", "/tokens", token=tts)[0], 403)
        listed = self.call("GET", "/tokens", token=t)[1]
        self.assertEqual({x["scope"] for x in listed}, {"app", "tts"})
        self.assertEqual([x["label"] for x in listed if x["scope"] == "tts"], ["my TTS"])
        bob = self.login("bob")
        self.assertEqual(self.call("DELETE", f"/tokens/{b['id']}", token=bob)[0], 404)  # not his
        self.assertEqual(self.call("DELETE", f"/tokens/{b['id']}", token=t)[0], 200)
        self.assertEqual(self.call("POST", "/logout", token=tts)[0], 401)

    def test_new_password_logs_devices_out(self):
        t = self.login()
        db = server.DB(self.srv.RequestHandlerClass.app.db.path)
        self.assertTrue(db.set_password("ann", "another-one"))
        self.assertEqual(self.call("GET", "/me", token=t)[0], 401)
        self.login("ann", "another-one")

    def test_cors(self):
        _, _, h = self.call("GET", "/health", headers={"Origin": "https://rb.raumi.dev"})
        self.assertEqual(h["Access-Control-Allow-Origin"], "https://rb.raumi.dev")
        _, _, h = self.call("GET", "/health", headers={"Origin": "http://localhost:8000"})
        self.assertEqual(h["Access-Control-Allow-Origin"], "http://localhost:8000")
        _, _, h = self.call("GET", "/health", headers={"Origin": "https://evil.example"})
        self.assertIsNone(h["Access-Control-Allow-Origin"])
        req = urllib.request.Request(self.url + "/sync", method="OPTIONS", headers={"Origin": "https://rb.raumi.dev"})
        with urllib.request.urlopen(req) as r:
            self.assertEqual(r.status, 204)
            self.assertIn("Authorization", r.headers["Access-Control-Allow-Headers"])


if __name__ == "__main__":
    unittest.main()
