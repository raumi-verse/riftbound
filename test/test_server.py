"""The sync server over real HTTP on a free port with a fresh database: python3 -m unittest discover test"""
import base64
import json
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
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
        self.assertEqual(self.call("GET", "/me", token=t)[1], {"name": "ann", "passkey": False, "password": True})
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

    def test_table_reads_decks_and_saves_games(self):
        app = self.login()
        tts = self.call("POST", "/tokens", {"label": "TTS"}, app)[1]["token"]
        self.sync(app, 0, [
            {"kind": "deck", "id": "d1", "data": {"name": "Jinx aggro", "status": "active", "legend": "OGN-251", "version": "v1"}, "updated": 1},
            {"kind": "deck", "id": "d2", "data": {"name": "Voli", "status": "pinned", "legend": "OGN-249", "version": "v2"}, "updated": 1},
            {"kind": "deck", "id": "d3", "data": {"name": "Old", "status": "archived", "version": None}, "updated": 1},
            {"kind": "deckver", "id": "v1", "data": {"deck": "d1", "n": 3, "code": "CEAAA", "ids": "OGN-251 OGN-030", "list": "Legend:\n1 Jinx"}, "updated": 1},
            {"kind": "deckver", "id": "v2", "data": {"deck": "d2", "n": 1, "code": "", "ids": "OGN-249", "list": "Legend:\n1 Volibear"}, "updated": 1},
        ])
        s, decks, _ = self.call("GET", "/tts/decks", token=tts)
        self.assertEqual(s, 200)
        self.assertEqual([(d["n"], d["name"], d["version"]) for d in decks], [(1, "Voli", 1), (2, "Jinx aggro", 3)])
        for key in ("2", "d1", "jinx", "JINX AGGRO", "aggro"):
            s, d, _ = self.call("GET", "/tts/deck/" + urllib.parse.quote(key), token=tts)
            self.assertEqual((s, d["id"], d["code"], d["n"]), (200, "d1", "CEAAA", 3), key)
        self.assertEqual(self.call("GET", "/tts/deck/nope", token=tts)[0], 404)
        self.assertEqual(self.call("GET", "/tts/deck/old", token=tts)[0], 404)  # found by name, but has no list
        self.assertEqual(self.call("GET", "/tts/decks", token=self.login("bob"))[1], [])  # another account

        game = {"id": "tts-abc", "deck": "d1", "result": "win", "first": True, "me": {"conquer": 5, "hold": 3, "extra": 0},
                "opp": {"conquer": 2, "hold": 2, "extra": 0}, "oppLegend": "OGN-249", "oppList": "1 Volibear", "hacked": 1}
        self.assertEqual(self.call("POST", "/tts/match", game, tts)[0], 200)
        m = {c["id"]: c["data"] for c in self.sync(app)["changes"] if c["kind"] == "match"}["tts-abc"]
        self.assertEqual((m["deckver"], m["source"], m["needsNotes"], m["result"]), ("v1", "tts", True, "win"))
        self.assertNotIn("hacked", m)
        # notes written in the app survive the table sending the game again
        self.sync(app, 0, [{"kind": "match", "id": "tts-abc", "data": {**m, "notes": "close one", "tags": ["bo3"]}, "updated": server.now_ms()}])
        self.call("POST", "/tts/match", {**game, "result": "loss"}, tts)
        m = {c["id"]: c["data"] for c in self.sync(app)["changes"] if c["kind"] == "match"}["tts-abc"]
        self.assertEqual((m["notes"], m["tags"], m["result"], m["needsNotes"]), ("close one", ["bo3"], "loss", False))
        # pasted at the table instead of "rb deck": found by its code
        self.call("POST", "/tts/match", {"id": "tts-pasted", "code": "CEAAA", "result": "win"}, tts)
        m = {c["id"]: c["data"] for c in self.sync(app)["changes"] if c["kind"] == "match"}["tts-pasted"]
        self.assertEqual((m.get("deck"), m.get("deckver")), ("d1", "v1"))
        self.assertNotIn("code", m)
        self.call("POST", "/tts/match", {"id": "tts-other", "code": "ZZZZ", "result": "win"}, tts)
        m = {c["id"]: c["data"] for c in self.sync(app)["changes"] if c["kind"] == "match"}["tts-other"]
        self.assertNotIn("deck", m)
        self.assertEqual(self.call("POST", "/tts/match", {"result": "win"}, tts)[0], 400)
        self.assertEqual(self.call("POST", "/tts/match", {"id": "x", "result": "maybe"}, tts)[0], 400)

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


class Provider(BaseHTTPRequestHandler):
    """A token endpoint: checks what the server sends for a code and answers with the claims the test put there."""
    codes, seen = {}, []

    def do_POST(self):
        q = dict(urllib.parse.parse_qsl(self.rfile.read(int(self.headers["Content-Length"])).decode()))
        self.seen.append((self.path, q))
        c = self.codes.pop(q["code"], None)
        good = c and q["client_secret"] == "shh" and server.s256(q["code_verifier"]) == c["challenge"]
        part = base64.urlsafe_b64encode(json.dumps(c["claims"]).encode()).rstrip(b"=").decode() if good else ""
        body = json.dumps({"id_token": f"e30.{part}.sig"} if good else {"error": "invalid_grant"}).encode()
        self.send_response(200 if good else 400)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a):
        return None


ISSUER, BACK = "https://id.example", "https://rb.raumi.dev/search/login.html"


class Passkeys(Server):
    def setUp(self):
        super().setUp()
        self.idp = HTTPServer(("127.0.0.1", 0), Provider)
        threading.Thread(target=self.idp.serve_forever, daemon=True).start()
        self.app = self.srv.RequestHandlerClass.app
        self.app.oidc = server.OIDC(ISSUER, "rb", "shh", "https://api.example", f"http://127.0.0.1:{self.idp.server_address[1]}")

    def tearDown(self):
        self.idp.shutdown()
        self.idp.server_close()
        super().tearDown()

    def start(self, verifier="v" * 43, token=None, **kw):
        s, b, _ = self.call("POST", "/oidc/start", {"challenge": server.s256(verifier), "return": BACK, **kw}, token)
        return s, dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(b["url"]).query)) if s == 200 else b

    def callback(self, q):
        try:
            with urllib.request.build_opener(NoRedirect).open(f"{self.url}/oidc/callback?" + urllib.parse.urlencode(q)) as r:
                return r.status, {}
        except urllib.error.HTTPError as e:
            with e:
                loc = e.headers.get("Location") or ""
                if loc:
                    self.assertTrue(loc.startswith(BACK + "#"), loc)
                return e.code, dict(urllib.parse.parse_qsl(loc.partition("#")[2]))

    def provider(self, q, **claims):
        c = {"iss": ISSUER, "aud": "rb", "exp": time.time() + 60, "nonce": q["nonce"], "sub": "sub-1", "preferred_username": "cleo", **claims}
        code = f"c{len(Provider.seen)}-{q['state'][:8]}"
        Provider.codes[code] = {"claims": c, "challenge": q["code_challenge"]}
        return self.callback({"code": code, "state": q["state"]})

    def finish(self, frag, verifier="v" * 43, token=None):
        s, b, _ = self.call("POST", "/oidc/finish", {"code": frag.get("code"), "verifier": verifier}, token)
        return s, b

    def passkey(self, **claims):
        return self.finish(self.provider(self.start()[1], **claims)[1])

    def test_new_account_and_again(self):
        self.assertEqual(self.call("GET", "/login/methods")[1], {"passkey": True})
        _, q = self.start()
        self.assertEqual((q["redirect_uri"], q["code_challenge_method"], q["client_id"]), ("https://api.example/oidc/callback", "S256", "rb"))
        status, frag = self.provider(q)
        self.assertEqual(status, 303)
        s, b = self.finish(frag)
        self.assertEqual((s, b["name"]), (200, "cleo"))
        self.assertEqual(self.call("GET", "/me", token=b["token"])[1], {"name": "cleo", "passkey": True, "password": False})
        self.assertEqual(self.call("POST", "/login", {"name": "cleo", "password": ""})[0], 401)  # no password, not an empty one
        s, b = self.passkey(preferred_username="renamed")  # the same person, whatever the name is now
        self.assertEqual((s, b["name"]), (200, "cleo"))

    def test_codes_and_states_work_once(self):
        _, q = self.start()
        _, frag = self.provider(q)
        self.assertEqual(self.callback({"code": "x", "state": q["state"]})[0], 400)
        self.assertEqual(self.finish(frag)[0], 200)
        self.assertEqual(self.finish(frag)[0], 401)
        self.assertEqual(self.callback({"code": "x", "state": "made-up"})[0], 400)

    def test_wrong_verifier_burns_the_code(self):
        _, frag = self.provider(self.start()[1])
        self.assertEqual(self.finish(frag, "w" * 43)[0], 401)
        self.assertEqual(self.finish(frag)[0], 401)

    def test_expired(self):
        _, q = self.start()
        self.app.oidc.states.d = {k: (0, v) for k, (_, v) in self.app.oidc.states.d.items()}
        self.assertEqual(self.provider(q)[0], 400)
        _, frag = self.provider(self.start()[1])
        self.app.oidc.codes.d = {k: (0, v) for k, (_, v) in self.app.oidc.codes.d.items()}
        self.assertEqual(self.finish(frag)[0], 401)

    def test_bad_claims(self):
        for bad in ({"nonce": "other"}, {"nonce": None}, {"aud": "another-client"}, {"aud": ["x"]}, {"aud": ["rb", "x"], "azp": "x"},
                    {"iss": "https://evil.example"}, {"exp": time.time() - 999}, {"exp": None}, {"sub": ""}, {"sub": None}):
            status, frag = self.provider(self.start()[1], **bad)
            self.assertEqual((status, "code" in frag, "error" in frag), (303, False, True), bad)

    def test_provider_says_no(self):
        _, q = self.start()
        self.assertIn("error", self.callback({"error": "access_denied", "state": q["state"]})[1])
        _, q = self.start()
        self.assertIn("error", self.callback({"code": "unknown", "state": q["state"]})[1])
        _, q = self.start()
        self.assertIn("error", self.callback({"code": "x", "state": q["state"], "iss": "https://evil.example"})[1])

    def test_return_pages(self):
        for ok in (BACK, "http://localhost:8000/login.html"):
            self.assertEqual(self.start(**{"return": ok})[0], 200, ok)
        for bad in ("https://evil.example/login.html", "https://rb.raumi.dev@evil.example/login.html", "https://rb.raumi.dev.evil.example/login.html",
                    "https://rb.raumi.dev/search/decks.html", BACK + "#x", BACK + "?x", "null", "javascript:alert(1)//login.html", None, 3,
                    "https://rb.raumi.dev\\@evil.example/login.html", BACK + "\n"):
            self.assertEqual(self.start(**{"return": bad})[0], 400, bad)
        self.assertEqual(self.call("POST", "/oidc/start", {"challenge": "short", "return": BACK})[0], 400)

    def test_taken_name_and_email_never_match(self):
        s, b = self.passkey(preferred_username="ANN", email="ann@example.org", email_verified=True)
        self.assertEqual(s, 409)
        self.assertNotIn("token", b)

    def test_linking_keeps_the_account(self):
        t = self.login()
        self.sync(t, 0, [{"kind": "coll", "id": "OGN-001", "data": {"n": 3}, "updated": 100}])
        tts = self.call("POST", "/tokens", {"label": "TTS"}, t)[1]["token"]
        self.assertEqual(self.start(link=True)[0], 401)
        self.assertEqual(self.start(link=True, token=tts)[0], 401)
        _, frag = self.provider(self.start(link=True, token=t)[1])
        self.assertEqual(self.finish(frag, token=t)[1], {"name": "ann", "linked": True})
        s, b = self.passkey()
        self.assertEqual((s, b["name"]), (200, "ann"))
        self.assertEqual(self.sync(b["token"])["changes"][0]["data"], {"n": 3})
        self.assertEqual(self.call("GET", "/tts/decks", token=tts)[0], 200)
        bob = self.login("bob")  # the same passkey can't go to a second account
        _, frag = self.provider(self.start(link=True, token=bob)[1])
        self.assertEqual(self.finish(frag, token=bob)[0], 409)

    def test_link_only_by_the_account_that_asked(self):
        t = self.login()
        for other in (None, self.login("bob")):
            _, frag = self.provider(self.start(link=True, token=t)[1])
            self.assertEqual(self.finish(frag, token=other)[0], 401)
        self.assertFalse(self.call("GET", "/me", token=t)[1]["passkey"])

    def test_nopasswd_and_revoke(self):
        db = self.app.db
        self.assertIn("no passkey", db.no_password("ann"))
        t = self.login()
        _, frag = self.provider(self.start(link=True, token=t)[1])
        self.finish(frag, token=t)
        self.assertIsNone(db.no_password("ann"))
        self.assertEqual(self.call("POST", "/login", {"name": "ann", "password": "secret-ann"})[0], 401)
        _, b = self.passkey()
        self.assertTrue(db.revoke("ann"))
        for x in (t, b["token"]):
            self.assertEqual(self.call("GET", "/me", token=x)[0], 401)
        self.assertEqual(self.passkey(preferred_username="ann")[0], 409)  # no way back by making the account anew
        db.set_password("ann", "back-again")
        self.login("ann", "back-again")

    def test_too_many_starts(self):
        for _ in range(30):
            self.assertEqual(self.start()[0], 200)
        self.assertEqual(self.start()[0], 429)

    def test_without_provider(self):
        self.app.oidc = None
        self.assertEqual(self.call("GET", "/login/methods")[1], {"passkey": False})
        self.assertEqual(self.start()[0], 404)
        self.assertEqual(self.callback({"state": "x"})[0], 400)
        self.assertEqual(self.finish({"code": "x"})[0], 401)
        self.assertIsNone(server.OIDC.from_env({}))

    def test_older_database(self):
        p = str(Path(self.dir.name) / "old.sqlite")
        db = server.DB(p)
        db.add_user("old", "secret-old")
        db.conn().execute("drop table identities")
        again = server.DB(p)
        self.assertFalse(again.linked(1))
        self.assertEqual(again.one("select name from users")["name"], "old")


if __name__ == "__main__":
    unittest.main()
