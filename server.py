#!/usr/bin/env python3
"""Sync server for the page's collection, decks and matches (and the Tabletop Simulator table).

    python3 server.py adduser NAME         # asks for a password (or reads one line from stdin when piped)
    python3 server.py passwd NAME
    python3 server.py users
    python3 server.py serve [--port 8080] [--db rb.sqlite] [--proxy]

Standard library only. The server mostly doesn't understand the data: the page keeps typed records (kind, id, data)
and /sync swaps changes both ways, newest edit wins per record. Each user has their own records; accounts are made
here, there is no sign-up.

    POST /login   {name, password, label?}         -> {token, name}
    POST /logout                                   (the token used)
    GET  /me                                       -> {name}
    POST /sync    {since, changes:[{kind, id, data, updated, deleted}]}  -> {changes, cursor, more}
    GET  /tokens  POST /tokens {label}  DELETE /tokens/<id>              tokens for the Tabletop Simulator table
    GET  /health

Tokens go in "Authorization: Bearer …". A table token ("tts") only opens /tts/… .
--proxy trusts the client address in CF-Connecting-IP / X-Forwarded-For (behind Caddy or a Cloudflare Tunnel).
Allowed page origins: RB_ORIGINS (comma separated, default https://rb.raumi.dev), plus localhost and file:// pages.
"""
import argparse
import getpass
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit

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


class Tx:
    def __init__(self, c):
        self.c = c

    def __enter__(self):
        self.c.execute("begin immediate")
        return self.c

    def __exit__(self, exc, *_):
        self.c.execute("rollback" if exc else "commit")


# --- HTTP -------------------------------------------------------------------------------------------------------

class HTTPError(Exception):
    def __init__(self, status, msg):
        super().__init__(msg)
        self.status = status


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
    def __init__(self, db, origins=("https://rb.raumi.dev",), proxy=False):
        self.db, self.origins, self.proxy = db, set(origins), proxy
        self.fails, self.fails_lock = {}, threading.Lock()
        self.routes = []  # (method, regex, handler, scopes)
        self.route("GET", r"/health", self.health, None)
        self.route("POST", r"/login", self.login, None)
        self.route("POST", r"/logout", self.logout, {"app", "tts"})
        self.route("GET", r"/me", self.me, {"app"})
        self.route("POST", r"/sync", self.do_sync, {"app"})
        self.route("GET", r"/tokens", self.tokens, {"app"})
        self.route("POST", r"/tokens", self.make_token, {"app"})
        self.route("DELETE", r"/tokens/(\d+)", self.drop_token, {"app"})

    def route(self, method, path, fn, scopes):
        self.routes.append((method, re.compile(path + "$"), fn, scopes))

    def origin_ok(self, o):
        return o in self.origins or o == "null" or re.match(r"^http://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$", o or "")

    # handlers get (req, tok, *groups) and return a JSON-able value
    def health(self, req, tok):
        self.db.one("select 1")
        return {"ok": True}

    def login(self, req, tok):
        ip = req.client_ip()
        with self.fails_lock:
            recent = [t for t in self.fails.get(ip, []) if t > time.time() - LOGIN_TRIES[1]]
            self.fails[ip] = recent
            if len(recent) >= LOGIN_TRIES[0]:
                raise HTTPError(429, "too many failed logins, try again later")
        b = req.json()
        name, pw = str(b.get("name", "")).strip(), str(b.get("password", ""))
        u = self.db.one("select id, name, pw from users where name = ?", name)
        if not u or not check_pw(pw, u["pw"]):
            with self.fails_lock:
                self.fails.setdefault(ip, []).append(time.time())
            raise HTTPError(401, "wrong name or password")
        t, _ = self.db.new_token(u["id"], "app", str(b.get("label") or req.headers.get("User-Agent", ""))[:80])
        return {"token": t, "name": u["name"]}

    def logout(self, req, tok):
        with self.db.write() as c:
            c.execute("delete from tokens where id = ?", (tok["id"],))
        return {"ok": True}

    def me(self, req, tok):
        return {"name": tok["name"]}

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
        sys.stderr.write(f"{self.client_ip()} {fmt % a}\n")

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


def make_server(db_path, host="0.0.0.0", port=8080, origins=None, proxy=False):
    origins = origins or [o.strip() for o in os.environ.get("RB_ORIGINS", "https://rb.raumi.dev").split(",") if o.strip()]
    handler = type("H", (Handler,), {"app": App(DB(db_path), origins, proxy)})
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
    for c in ("adduser", "passwd"):
        sub.add_parser(c).add_argument("name")
    sub.add_parser("users")
    a = ap.parse_args()

    if a.cmd == "serve":
        srv = make_server(a.db, a.host, a.port, proxy=a.proxy)
        print(f"rb sync on {a.host}:{srv.server_address[1]}, {a.db}", file=sys.stderr, flush=True)
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
