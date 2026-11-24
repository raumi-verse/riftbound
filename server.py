#!/usr/bin/env python3
"""Sync server for the page's collection, decks and matches (and the Tabletop Simulator table).

    python3 server.py adduser NAME         # asks for a password (or reads one line from stdin when piped)
    python3 server.py passwd NAME
    python3 server.py nopasswd NAME        # passkey only (it must have one); passwd NAME gives it a password again
    python3 server.py revoke NAME          # ends every session and table token, unlinks the passkey, no password
    python3 server.py users
    python3 server.py serve [--port 8080] [--db rb.sqlite] [--proxy]

Standard library only. The server mostly doesn't understand the data: the page keeps typed records (kind, id, data)
and /sync swaps changes both ways, newest edit wins per record. Each user has their own records; accounts are made
here, or by the first passkey login of someone the OpenID provider (Pocket ID) lets in.

    POST /login   {name, password, label?}         -> {token, name}
    GET  /login/methods                            -> {passkey: bool}
    POST /oidc/start {challenge, return, link?}    -> {url}     the provider's login page; link: to the logged in account
    GET  /oidc/callback                            the provider sends the browser back here, it goes on to return#code=…
    POST /oidc/finish {code, verifier}             -> {token, name}
    POST /logout                                   (the token used)
    GET  /me                                       -> {name}
    POST /sync    {since, changes:[{kind, id, data, updated, deleted}]}  -> {changes, cursor, more}
    GET  /tokens  POST /tokens {label}  DELETE /tokens/<id>              tokens for the Tabletop Simulator table
    GET  /tts/decks                                -> [{n, id, name, legend, status, version}]  pinned first, no archived
    GET  /tts/deck/<n | id | name>                 -> {id, name, legend, version, code, ids, list}
    POST /tts/match {id, deck?, result, me, opp, log, …}  a game from the table (sent again: the same game)
    GET  /health

Tokens go in "Authorization: Bearer …". A table token ("tts") only opens /tts/… .
--proxy trusts the client address in CF-Connecting-IP / X-Forwarded-For (behind Caddy or a Cloudflare Tunnel).
Passkeys: RB_OIDC_ISSUER, RB_OIDC_CLIENT_ID, RB_OIDC_CLIENT_SECRET, RB_PUBLIC_URL (this server's address), and
RB_OIDC_INTERNAL (the provider's address from here, if not the issuer's). Without them there are only passwords.
Allowed page origins: RB_ORIGINS (comma separated, default https://rb.raumi.dev), plus localhost and file:// pages.
"""
import argparse
import base64
import getpass
import hashlib
import hmac
import json
import os
import re
import secrets
import signal
import sqlite3
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlencode, urlsplit

MAX_BODY = 8 << 20  # a full sync of years of matches stays far below this
PAGE = 2000  # records per /sync answer; the page asks again while "more"
KIND = re.compile(r"^[a-z]{1,16}$")
LOGIN_TRIES = (10, 600)  # failed logins per address per that many seconds
SCHEMA = """
create table if not exists users (id integer primary key, name text unique not null collate nocase,
    pw text not null, seq integer not null default 0, created integer not null);
create table if not exists tokens (id integer primary key, user integer not null references users(id) on delete cascade,
    hash text unique not null, scope text not null, label text not null default '',
    created integer not null, used integer not null);
create table if not exists records (user integer not null references users(id) on delete cascade,
    kind text not null, id text not null, data text, updated integer not null, deleted integer not null default 0,
    seq integer not null, primary key (user, kind, id));
create table if not exists identities (issuer text not null, sub text not null,
    user integer not null references users(id) on delete cascade, created integer not null, primary key (issuer, sub));
create index if not exists records_seq on records (user, seq);
"""


def now_ms():
    return int(time.time() * 1000)


# --- passwords and tokens ---------------------------------------------------------------------------------------

def hash_pw(pw, salt=None, n=1 << 14, r=8, p=1):
    salt = salt or secrets.token_bytes(16)
    h = hashlib.scrypt(pw.encode(), salt=salt, n=n, r=r, p=p, dklen=32)
    return f"scrypt${n}${r}${p}${salt.hex()}${h.hex()}"


def check_pw(pw, stored):
    try:
        _, n, r, p, salt, h = stored.split("$")
        return hmac.compare_digest(hash_pw(pw, bytes.fromhex(salt), int(n), int(r), int(p)).split("$")[-1], h)
    except ValueError:
        return False


def token_hash(t):
    return hashlib.sha256(t.encode()).hexdigest()


# --- database ---------------------------------------------------------------------------------------------------

class DB:
    """One connection per thread; writes in BEGIN IMMEDIATE so a user's seq counter never races."""

    def __init__(self, path):
        self.path = path
        self.local = threading.local()
        with self.conn() as c:
            c.executescript(SCHEMA)

    def conn(self):
        c = getattr(self.local, "c", None)
        if c is None:
            c = sqlite3.connect(self.path, timeout=30, isolation_level=None)
            c.row_factory = sqlite3.Row
            c.execute("pragma journal_mode=wal")
            c.execute("pragma foreign_keys=on")
            c.execute("pragma busy_timeout=30000")
            self.local.c = c
        return c

    def write(self):
        return Tx(self.conn())

    def one(self, sql, *a):
        return self.conn().execute(sql, a).fetchone()

    def all(self, sql, *a):
        return self.conn().execute(sql, a).fetchall()

    # users
    def add_user(self, name, pw):
        with self.write() as c:
            c.execute("insert into users (name, pw, created) values (?, ?, ?)", (name, hash_pw(pw), now_ms()))

    def set_password(self, name, pw):
        with self.write() as c:
            u = c.execute("select id from users where name = ?", (name,)).fetchone()
            if not u:
                return False
            c.execute("update users set pw = ? where id = ?", (hash_pw(pw), u["id"]))
            c.execute("delete from tokens where user = ? and scope = 'app'", (u["id"],))  # log out every device
            return True

    def linked(self, user):
        return self.one("select 1 from identities where user = ?", user) is not None

    def no_password(self, name):
        """-> None, or why not"""
        u = self.one("select id from users where name = ?", name)
        if not u:
            return f"no user {name}"
        if not self.linked(u["id"]):
            return f"{name} has no passkey yet (they add it in the page's account sheet)"
        with self.write() as c:
            c.execute("update users set pw = '' where id = ?", (u["id"],))

    def revoke(self, name):
        """Locked out everywhere; the records stay. The provider may still let them in there, but the name is taken."""
        with self.write() as c:
            u = c.execute("select id from users where name = ?", (name,)).fetchone()
            if not u:
                return False
            c.execute("delete from tokens where user = ?", (u["id"],))
            c.execute("delete from identities where user = ?", (u["id"],))
            c.execute("update users set pw = '' where id = ?", (u["id"],))
            return True

    def identity(self, issuer, sub, name, link=None):
        """The account of a passkey login. Only (issuer, sub) identifies anyone: names and emails can be changed at
        the provider. link: the logged in account this identity is added to."""
        with self.write() as c:
            row = c.execute("select u.id, u.name from identities i join users u on u.id = i.user where issuer = ? and sub = ?",
                            (issuer, sub)).fetchone()
            if row and link and row["id"] != link:
                raise HTTPError(409, f"this passkey already belongs to {row['name']}")
            if row:
                return row["id"], row["name"]
            if link:
                u = c.execute("select id, name from users where id = ?", (link,)).fetchone()
                if not u:
                    raise HTTPError(401, "not logged in")
                uid, name = u["id"], u["name"]
            else:
                name = re.sub(r"[^\w .-]", "", name).strip()[:40]
                if not name:
                    raise HTTPError(400, "the login has no username")
                if c.execute("select 1 from users where name = ?", (name,)).fetchone():
                    raise HTTPError(409, f"there is already an account {name}: log in with its password, then add the passkey there")
                uid = c.execute("insert into users (name, pw, created) values (?, '', ?)", (name, now_ms())).lastrowid
            c.execute("insert into identities (issuer, sub, user, created) values (?, ?, ?, ?)", (issuer, sub, uid, now_ms()))
            return uid, name

    # tokens
    def new_token(self, user, scope, label):
        t = secrets.token_urlsafe(32)
        with self.write() as c:
            cur = c.execute("insert into tokens (user, hash, scope, label, created, used) values (?, ?, ?, ?, ?, ?)",
                            (user, token_hash(t), scope, label[:80], now_ms(), now_ms()))
        return t, cur.lastrowid

    def auth(self, t):
        row = self.one("select t.id, t.user, t.scope, t.used, u.name from tokens t join users u on u.id = t.user "
                       "where t.hash = ?", token_hash(t))
        if row and now_ms() - row["used"] > 3600_000:  # "last used" to the hour is plenty
            with self.write() as c:
                c.execute("update tokens set used = ? where id = ?", (now_ms(), row["id"]))
        return row

    # records
    def sync(self, user, since, changes):
        """Apply the changes (newest `updated` wins), then return what the device hasn't seen yet."""
        with self.write() as c:
            seq = c.execute("select seq from users where id = ?", (user,)).fetchone()["seq"]
            for ch in changes:
                old = c.execute("select updated from records where user = ? and kind = ? and id = ?",
                                (user, ch["kind"], ch["id"])).fetchone()
                if old and old["updated"] >= ch["updated"]:
                    continue
                seq += 1
                c.execute("insert into records (user, kind, id, data, updated, deleted, seq) values (?, ?, ?, ?, ?, ?, ?) "
                          "on conflict (user, kind, id) do update set data = excluded.data, updated = excluded.updated, "
                          "deleted = excluded.deleted, seq = excluded.seq",
                          (user, ch["kind"], ch["id"], None if ch["deleted"] else json.dumps(ch["data"], ensure_ascii=False),
                           ch["updated"], int(ch["deleted"]), seq))
            c.execute("update users set seq = ? where id = ?", (seq, user))
        if since > seq:  # the database came back from a backup: the device gets everything again
            since = 0
        rows = self.all("select kind, id, data, updated, deleted, seq from records where user = ? and seq > ? "
                        "order by seq limit ?", user, since, PAGE + 1)
        more = len(rows) > PAGE
        rows = rows[:PAGE]
        out = [{"kind": r["kind"], "id": r["id"], "updated": r["updated"], "deleted": bool(r["deleted"]),
                "data": None if r["deleted"] else json.loads(r["data"])} for r in rows]
        return {"changes": out, "cursor": rows[-1]["seq"] if rows else since, "more": more}


# --- what the Tabletop Simulator table may read and write --------------------------------------------------------
# The only server code that knows the page's records: decks (deck), their versions (deckver) and games (match).

TTS_MATCH_FIELDS = {"deck", "deckver", "result", "first", "me", "opp", "log", "turns", "oppLegend", "oppName", "oppList",
                    "date", "event", "game", "color", "table"}


def live(db, user, kind):
    return {r["id"]: json.loads(r["data"]) for r in db.all("select id, data from records where user = ? and kind = ? and not deleted",
                                                           user, kind)}


def tts_decks(db, user):
    decks, vers = live(db, user, "deck"), live(db, user, "deckver")
    out = [{"id": i, "name": d.get("name", ""), "legend": d.get("legend"), "status": d.get("status", "active"),
            "version": vers.get(d.get("version"), {}).get("n")} for i, d in decks.items() if d.get("status") != "archived"]
    out.sort(key=lambda d: (d["status"] != "pinned", d["name"].lower()))
    for n, d in enumerate(out, 1):
        d["n"] = n
    return out


def tts_deck(db, user, key):
    decks = tts_decks(db, user)
    k = key.strip().lower()
    hit = next((d for d in decks if d["id"] == key), None) or (decks[int(k) - 1] if k.isdigit() and 0 < int(k) <= len(decks) else None)
    if not hit:  # by name: exactly, then the start, then anywhere (archived decks too, by name)
        everything = [{"id": i, "name": d.get("name", ""), "legend": d.get("legend"), "status": d.get("status")}
                      for i, d in live(db, user, "deck").items()]
        for test in (lambda n: n == k, lambda n: n.startswith(k), lambda n: k in n):
            found = [d for d in everything if test(d["name"].lower())]
            if found:
                hit = found[0]
                break
    if not hit:
        raise HTTPError(404, f"no deck {key}")
    deck = live(db, user, "deck")[hit["id"]]
    v = live(db, user, "deckver").get(deck.get("version"))
    if not v:
        raise HTTPError(404, f"{deck.get('name')} has no list")
    return {"id": hit["id"], "name": deck.get("name", ""), "legend": deck.get("legend"), "version": deck.get("version"),
            "n": v.get("n"), "code": v.get("code", ""), "ids": v.get("ids", ""), "list": v.get("list", "")}


def tts_match(db, user, b):
    mid = b.get("id")
    if not isinstance(mid, str) or not 0 < len(mid) <= 128:
        raise HTTPError(400, "a game needs an id (the same one when sent again)")
    data = {k: v for k, v in b.items() if k in TTS_MATCH_FIELDS}
    if data.get("result") not in (None, "win", "loss", "draw"):
        raise HTTPError(400, "result is win, loss or draw")
    # a deck pasted at the table: the deck of yours with that code, if there is one (newest version wins)
    code = b.get("code")
    if not data.get("deck") and isinstance(code, str) and code.strip():
        for vid, v in sorted(live(db, user, "deckver").items(), key=lambda kv: kv[1].get("n", 0), reverse=True):
            if v.get("code") == code.strip() and v.get("deck") in live(db, user, "deck"):
                data["deck"], data["deckver"] = v["deck"], vid
                break
    if data.get("deck"):
        deck = live(db, user, "deck").get(data["deck"])
        if deck is None:
            data.pop("deck")
        elif not data.get("deckver"):
            data["deckver"] = deck.get("version")
    old = db.one("select data from records where user = ? and kind = 'match' and id = ? and not deleted", user, mid)
    old = json.loads(old["data"]) if old else {}
    # what was written in the app stays: notes, tags
    merged = {"tags": [], "notes": "", **old, **data, "source": "tts", "needsNotes": not (old.get("notes") or "").strip()}
    merged.setdefault("date", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    db.sync(user, 0, [{"kind": "match", "id": mid, "data": merged, "updated": now_ms(), "deleted": False}])
    return {"ok": True, "id": mid}


class Tx:
    def __init__(self, c):
        self.c = c

    def __enter__(self):
        self.c.execute("begin immediate")
        return self.c

    def __exit__(self, exc, *_):
        self.c.execute("rollback" if exc else "commit")


# --- passkey login (OpenID Connect, authorization code with PKCE) ------------------------------------------------

def b64url(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def s256(verifier):
    return b64url(hashlib.sha256(verifier.encode()).digest())


class Once:
    """Values handed out once, for a while, kept in memory (a restart only means logging in again)."""

    def __init__(self, ttl, most=2000):
        self.ttl, self.most, self.d, self.lock = ttl, most, {}, threading.Lock()

    def put(self, value):
        k, now = secrets.token_urlsafe(32), time.time()
        with self.lock:
            self.d = {i: x for i, x in self.d.items() if x[0] > now}
            if len(self.d) >= self.most:
                raise HTTPError(429, "too many logins at once, try again later")
            self.d[k] = (now + self.ttl, value)
        return k

    def take(self, k):
        with self.lock:
            until, value = self.d.pop(k, (0, None))
        return value if until > time.time() else None


class OIDC:
    """The client's secret stays here. The page only gets a code at its return address, worth something only together
    with the verifier it kept, so neither a stolen code nor somebody else's login link gets anyone a session."""

    def __init__(self, issuer, client_id, secret, public, internal=None):
        self.issuer, self.client_id, self.secret = issuer.rstrip("/"), client_id, secret
        self.callback = public.rstrip("/") + "/oidc/callback"
        self.token_url = (internal or issuer).rstrip("/") + "/api/oidc/token"
        self.states, self.codes = Once(600), Once(60)

    @classmethod
    def from_env(cls, env=os.environ):
        v = [env.get(k, "").strip() for k in ("RB_OIDC_ISSUER", "RB_OIDC_CLIENT_ID", "RB_OIDC_CLIENT_SECRET", "RB_PUBLIC_URL")]
        return cls(*v, env.get("RB_OIDC_INTERNAL", "").strip() or None) if all(v) else None

    def start(self, challenge, ret, link):
        nonce, verifier = secrets.token_urlsafe(24), secrets.token_urlsafe(48)
        state = self.states.put({"challenge": challenge, "return": ret, "link": link, "nonce": nonce, "verifier": verifier})
        return f"{self.issuer}/authorize?" + urlencode({
            "response_type": "code", "client_id": self.client_id, "redirect_uri": self.callback, "scope": "openid profile",
            "state": state, "nonce": nonce, "code_challenge": s256(verifier), "code_challenge_method": "S256"})

    def claims(self, code, st):
        body = urlencode({"grant_type": "authorization_code", "code": code, "redirect_uri": self.callback, "client_id": self.client_id,
                          "client_secret": self.secret, "code_verifier": st["verifier"]}).encode()
        req = urllib.request.Request(self.token_url, data=body, headers={"Content-Type": "application/x-www-form-urlencoded",
                                                                          "Accept": "application/json", "User-Agent": "rb-sync"})
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                c = json.loads(r.read(1 << 20))["id_token"].split(".")[1]
            c = json.loads(base64.urlsafe_b64decode(c + "=" * (-len(c) % 4)))
        except (OSError, ValueError, KeyError, IndexError, AttributeError, TypeError):
            raise HTTPError(502, "the login couldn't be checked, try again")
        # The token comes straight from the provider's token endpoint, over a network of just the two, so its signature
        # needs no checking (OpenID Connect Core 3.1.3.7); who it is from and for does.
        aud = c.get("aud") if isinstance(c, dict) else None
        ok = (isinstance(c, dict) and c.get("iss") == self.issuer
              and (aud == self.client_id or (isinstance(aud, list) and self.client_id in aud and c.get("azp", self.client_id) == self.client_id))
              and isinstance(c.get("exp"), (int, float)) and c["exp"] > time.time() - 30
              and isinstance(c.get("nonce"), str) and hmac.compare_digest(c["nonce"].encode(), st["nonce"].encode())
              and isinstance(c.get("sub"), str) and c["sub"])
        if not ok:
            raise HTTPError(401, "the login wasn't valid, try again")
        return c


# --- HTTP -------------------------------------------------------------------------------------------------------

class HTTPError(Exception):
    def __init__(self, status, msg):
        super().__init__(msg)
        self.status = status


class Redirect(Exception):
    pass


def clean_change(ch, now):
    if not isinstance(ch, dict) or not isinstance(ch.get("kind"), str) or not KIND.match(ch["kind"]):
        raise HTTPError(400, "bad change: kind")
    if not isinstance(ch.get("id"), str) or not 0 < len(ch["id"]) <= 128:
        raise HTTPError(400, "bad change: id")
    upd = ch.get("updated")
    if not isinstance(upd, int) or isinstance(upd, bool) or upd < 0:
        raise HTTPError(400, "bad change: updated")
    deleted = bool(ch.get("deleted"))
    if not deleted and not isinstance(ch.get("data"), dict):
        raise HTTPError(400, "bad change: data")
    # a device whose clock runs ahead must not win every later edit forever
    return {"kind": ch["kind"], "id": ch["id"], "updated": min(upd, now + 60_000), "deleted": deleted, "data": ch.get("data")}


class App:
    def __init__(self, db, origins=("https://rb.raumi.dev",), proxy=False, oidc=None):
        self.db, self.origins, self.proxy, self.oidc = db, set(origins), proxy, oidc
        self.fails, self.fails_lock = {}, threading.Lock()
        self.routes = []  # (method, regex, handler, scopes)
        self.route("GET", r"/health", self.health, None)
        self.route("POST", r"/login", self.login, None)
        self.route("GET", r"/login/methods", lambda req, tok: {"passkey": self.oidc is not None}, None)
        self.route("POST", r"/oidc/start", self.oidc_start, None)
        self.route("GET", r"/oidc/callback", self.oidc_callback, None)
        self.route("POST", r"/oidc/finish", self.oidc_finish, None)
        self.route("POST", r"/logout", self.logout, {"app", "tts"})
        self.route("GET", r"/me", self.me, {"app"})
        self.route("POST", r"/sync", self.do_sync, {"app"})
        self.route("GET", r"/tokens", self.tokens, {"app"})
        self.route("POST", r"/tokens", self.make_token, {"app"})
        self.route("DELETE", r"/tokens/(\d+)", self.drop_token, {"app"})
        self.route("GET", r"/tts/decks", lambda req, tok: tts_decks(self.db, tok["user"]), {"tts", "app"})
        self.route("GET", r"/tts/deck/(.+)", lambda req, tok, key: tts_deck(self.db, tok["user"], key), {"tts", "app"})
        self.route("POST", r"/tts/match", lambda req, tok: tts_match(self.db, tok["user"], req.json()), {"tts", "app"})

    def route(self, method, path, fn, scopes):
        self.routes.append((method, re.compile(path + "$"), fn, scopes))

    def origin_ok(self, o):
        return o in self.origins or o == "null" or re.match(r"^http://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$", o or "")

    # handlers get (req, tok, *groups) and return a JSON-able value
    def health(self, req, tok):
        self.db.one("select 1")
        return {"ok": True}

    def limit(self, key, tries, text):
        """The times noted for key in the last LOGIN_TRIES[1] seconds, at most `tries`."""
        with self.fails_lock:
            recent = [t for t in self.fails.get(key, []) if t > time.time() - LOGIN_TRIES[1]]
            self.fails[key] = recent
            if len(recent) >= tries:
                raise HTTPError(429, text)

    def note(self, key):
        with self.fails_lock:
            self.fails.setdefault(key, []).append(time.time())

    def session(self, req):
        """The logged in account of a request that may come without one."""
        h = req.headers.get("Authorization", "")
        tok = self.db.auth(h[7:].strip()) if h.startswith("Bearer ") else None
        return tok if tok and tok["scope"] == "app" else None

    def oidc_start(self, req, tok):
        if not self.oidc:
            raise HTTPError(404, "this server has no passkey login")
        key = ("oidc", req.client_ip())
        self.limit(key, 30, "too many logins, try again later")
        self.note(key)
        b = req.json()
        challenge, ret, link = b.get("challenge"), b.get("return"), None
        if not isinstance(challenge, str) or not re.fullmatch(r"[\w-]{43}", challenge):
            raise HTTPError(400, "bad challenge")
        # back only to a login page of an allowed origin
        u = re.fullmatch(r"(https?://[^/?#@\\\s]+)(/[\w./-]*)?/login\.html", ret) if isinstance(ret, str) else None
        if not u or not self.origin_ok(u[1]):
            raise HTTPError(400, "can't return to that page")
        if b.get("link"):
            me = self.session(req)
            if not me:
                raise HTTPError(401, "not logged in")
            link = me["user"]
        return {"url": self.oidc.start(challenge, ret, link)}

    def oidc_callback(self, req, tok):
        q = {k: v[0] for k, v in parse_qs(urlsplit(req.path).query).items()}
        st = self.oidc.states.take(q.get("state", "")) if self.oidc else None
        if not st:
            raise HTTPError(400, "this login has expired: go back to the page and start again")
        try:
            if q.get("error") or not q.get("code"):
                raise HTTPError(401, "the login was cancelled")
            if q.get("iss", self.oidc.issuer) != self.oidc.issuer:
                raise HTTPError(401, "the login wasn't valid, try again")
            c = self.oidc.claims(q["code"], st)
            code = self.oidc.codes.put({"sub": c["sub"], "name": str(c.get("preferred_username") or c.get("name") or ""),
                                        "challenge": st["challenge"], "link": st["link"]})
            frag = {"code": code}
        except HTTPError as e:
            frag = {"error": str(e)}
        raise Redirect(st["return"] + "#" + urlencode(frag))

    def oidc_finish(self, req, tok):
        b = req.json()
        code, verifier = b.get("code"), b.get("verifier")
        got = self.oidc.codes.take(code) if self.oidc and isinstance(code, str) else None
        if not got or not isinstance(verifier, str) or not hmac.compare_digest(s256(verifier), got["challenge"]):
            raise HTTPError(401, "this login has expired, try again")
        if got["link"]:  # only for the account that asked, still logged in: a link sent to somebody else adds nothing
            me = self.session(req)
            if not me or me["user"] != got["link"]:
                raise HTTPError(401, "log in again, then add the passkey")
        uid, name = self.db.identity(self.oidc.issuer, got["sub"], got["name"], got["link"])
        if got["link"]:
            return {"name": name, "linked": True}
        t, _ = self.db.new_token(uid, "app", str(b.get("label") or req.headers.get("User-Agent", ""))[:80])
        return {"token": t, "name": name}

    def login(self, req, tok):
        ip = req.client_ip()
        self.limit(ip, LOGIN_TRIES[0], "too many failed logins, try again later")
        b = req.json()
        name, pw = str(b.get("name", "")).strip(), str(b.get("password", ""))
        u = self.db.one("select id, name, pw from users where name = ?", name)
        if not u or not check_pw(pw, u["pw"]):
            self.note(ip)
            raise HTTPError(401, "wrong name or password")
        t, _ = self.db.new_token(u["id"], "app", str(b.get("label") or req.headers.get("User-Agent", ""))[:80])
        return {"token": t, "name": u["name"]}

    def logout(self, req, tok):
        with self.db.write() as c:
            c.execute("delete from tokens where id = ?", (tok["id"],))
        return {"ok": True}

    def me(self, req, tok):
        u = self.db.one("select pw != '' p from users where id = ?", tok["user"])
        return {"name": tok["name"], "passkey": self.db.linked(tok["user"]), "password": bool(u["p"])}

    def do_sync(self, req, tok):
        b = req.json()
        since = b.get("since", 0)
        if not isinstance(since, int) or isinstance(since, bool) or since < 0:
            raise HTTPError(400, "bad since")
        changes = b.get("changes", [])
        if not isinstance(changes, list):
            raise HTTPError(400, "bad changes")
        now = now_ms()
        return self.db.sync(tok["user"], since, [clean_change(c, now) for c in changes])

    def tokens(self, req, tok):
        rows = self.db.all("select id, scope, label, created, used from tokens where user = ? order by created",
                           tok["user"])
        return [dict(r) | {"current": r["id"] == tok["id"]} for r in rows]

    def make_token(self, req, tok):
        b = req.json()
        t, i = self.db.new_token(tok["user"], "tts", str(b.get("label") or "Tabletop Simulator"))
        return {"token": t, "id": i}

    def drop_token(self, req, tok, i):
        with self.db.write() as c:
            n = c.execute("delete from tokens where id = ? and user = ?", (int(i), tok["user"])).rowcount
        if not n:
            raise HTTPError(404, "no such token")
        return {"ok": True}

    def handle(self, req, method):
        path = urlsplit(req.path).path.rstrip("/") or "/"
        allowed = []
        for m, rx, fn, scopes in self.routes:
            g = rx.match(path)
            if not g:
                continue
            allowed.append(m)
            if m != method:
                continue
            tok = None
            if scopes is not None:
                h = req.headers.get("Authorization", "")
                tok = self.db.auth(h[7:].strip()) if h.startswith("Bearer ") else None
                if not tok:
                    raise HTTPError(401, "not logged in")
                if tok["scope"] not in scopes:
                    raise HTTPError(403, "this token can't do that")
            return fn(req, tok, *(unquote(x) for x in g.groups()))
        raise HTTPError(405 if allowed else 404, "method not allowed" if allowed else "not found")


class Handler(BaseHTTPRequestHandler):
    app: App = None
    server_version = "rb-sync/1"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *a):  # no request bodies or tokens in the log, just the line
        line = re.sub(r"\?\S*", "?…", fmt % a)  # nor login codes
        sys.stderr.write(f"{self.client_ip()} {line}\n")

    def client_ip(self):
        if self.app.proxy:
            ip = self.headers.get("CF-Connecting-IP") or (self.headers.get("X-Forwarded-For") or "").split(",")[0].strip()
            if ip:
                return ip
        return self.client_address[0]

    def json(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BODY:
            raise HTTPError(413, "too large")
        try:
            b = json.loads(self.rfile.read(n) or b"{}")
        except ValueError:
            raise HTTPError(400, "not JSON")
        if not isinstance(b, dict):
            raise HTTPError(400, "expected an object")
        return b

    def cors(self):
        o = self.headers.get("Origin")
        if o and self.app.origin_ok(o):
            self.send_header("Access-Control-Allow-Origin", o)
            self.send_header("Vary", "Origin")

    def reply(self, status, body):
        data = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.cors()
        self.end_headers()
        self.wfile.write(data)

    def run(self, method):
        try:
            self.reply(200, self.app.handle(self, method))
        except Redirect as e:
            self.send_response(303)
            self.send_header("Location", str(e))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Length", "0")
            self.end_headers()
        except HTTPError as e:
            self.reply(e.status, {"error": str(e)})
        except Exception as e:  # keep the connection answering; the details go to the log only
            self.log_error("error: %r", e)
            self.reply(500, {"error": "server error"})

    def do_GET(self):
        self.run("GET")

    def do_POST(self):
        self.run("POST")

    def do_DELETE(self):
        self.run("DELETE")

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Max-Age", "86400")
        self.send_header("Content-Length", "0")
        self.end_headers()


def make_server(db_path, host="0.0.0.0", port=8080, origins=None, proxy=False, oidc=None):
    origins = origins or [o.strip() for o in os.environ.get("RB_ORIGINS", "https://rb.raumi.dev").split(",") if o.strip()]
    handler = type("H", (Handler,), {"app": App(DB(db_path), origins, proxy, oidc)})
    srv = ThreadingHTTPServer((host, port), handler)
    srv.daemon_threads = True
    return srv


# --- command line -----------------------------------------------------------------------------------------------

def ask_password():
    if not sys.stdin.isatty():
        return sys.stdin.readline().rstrip("\n")
    pw = getpass.getpass("password: ")
    if pw != getpass.getpass("again: "):
        sys.exit("the passwords differ")
    return pw


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--db", default=os.environ.get("RB_DB", "rb.sqlite"))
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("serve")
    s.add_argument("--host", default="0.0.0.0")
    s.add_argument("--port", type=int, default=int(os.environ.get("RB_PORT", 8080)))
    s.add_argument("--proxy", action="store_true", default=os.environ.get("RB_PROXY") == "1")
    for c in ("adduser", "passwd", "nopasswd", "revoke"):
        sub.add_parser(c).add_argument("name")
    sub.add_parser("users")
    a = ap.parse_args()

    if a.cmd == "serve":
        srv = make_server(a.db, a.host, a.port, proxy=a.proxy, oidc=OIDC.from_env())
        print(f"rb sync on {a.host}:{srv.server_address[1]}, {a.db}", file=sys.stderr, flush=True)
        # in a container it's process 1, which ignores SIGTERM unless told: stop at once (docker stop, the backup)
        signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            pass
        return
    db = DB(a.db)
    if a.cmd == "users":
        for u in db.all("select name, created, (select count(*) from records r where r.user = users.id and not deleted) n "
                        "from users order by name"):
            print(f"{u['name']}\t{u['n']} records\tsince {time.strftime('%Y-%m-%d', time.localtime(u['created'] / 1000))}")
        return
    if a.cmd == "nopasswd":
        why = db.no_password(a.name)
        sys.exit(why) if why else print(f"{a.name} logs in with the passkey only")
        return
    if a.cmd == "revoke":
        if not db.revoke(a.name):
            sys.exit(f"no user {a.name}")
        print(f"{a.name} is logged out everywhere and can't log in; the records are kept")
        return
    pw = ask_password()
    if len(pw) < 8:
        sys.exit("use at least 8 characters")
    if a.cmd == "adduser":
        try:
            db.add_user(a.name, pw)
        except sqlite3.IntegrityError:
            sys.exit(f"{a.name} exists already (passwd changes the password)")
        print(f"added {a.name}")
    elif not db.set_password(a.name, pw):
        sys.exit(f"no user {a.name}")
    else:
        print(f"new password for {a.name}; their devices have to log in again")


if __name__ == "__main__":
    main()
