"""Local JSON API for HIVE's brain.   python -m colony.server

Environment:
  BRAIN_HOST   address to bind (default 127.0.0.1). Anything other than loopback REQUIRES BRAIN_TOKEN.
  PORT / BRAIN_PORT   port (default 8787)
  BRAIN_TOKEN  if set, every request except GET /health must send 'Authorization: Bearer <token>'.
"""
import hmac, json, os, sys, threading, traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from colony.brain import Brain

MAX_BODY = 64 * 1024
LOOPBACK = {"127.0.0.1", "localhost", "::1"}
ROUTES = {
    "/route": lambda b, d: b.route(d["text"]),
    "/check": lambda b, d: b.check_text(d["text"]),
    "/score": lambda b, d: b.score(d["txns"]),
    "/index": lambda b, d: b.index_records(d["records"]),
    "/search": lambda b, d: b.search(d["q"], d.get("k", 5)),
    "/policy/create": lambda b, d: b.create_policy(d["text"], d.get("now")),
    "/policy/confirm": lambda b, d: b.confirm_policy(d["id"]),
    "/policy/authorize": lambda b, d: b.authorize(d["id"], d["order"], d.get("now")),
}


def make_handler(brain):
    lock = threading.Lock()  # the models and indexes are plain Python objects; serialise access

    class H(BaseHTTPRequestHandler):
        def _authed(self):
            token = os.environ.get("BRAIN_TOKEN", "")
            return not token or hmac.compare_digest(self.headers.get("authorization", ""), f"Bearer {token}")

        def _send(self, out, code):
            body = json.dumps(out).encode()
            self.send_response(code)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path == "/health":
                return self._send({"ok": True}, 200)  # public: hosting platforms probe it
            if not self._authed():
                return self._send({"error": "unauthorized"}, 401)
            self._send({"error": "not found"}, 404)

        def do_POST(self):
            if not self._authed():
                return self._send({"error": "unauthorized"}, 401)
            route = ROUTES.get(self.path)
            if route is None:
                return self._send({"error": "not found"}, 404)
            try:
                n = int(self.headers.get("content-length", 0))
            except ValueError:
                return self._send({"error": "bad content-length"}, 400)
            if n < 0 or n > MAX_BODY:
                return self._send({"error": "request too large"}, 413)
            try:
                data = json.loads(self.rfile.read(n) or b"{}")
                if not isinstance(data, dict):
                    raise ValueError
            except ValueError:
                return self._send({"error": "invalid json"}, 400)
            try:
                with lock:
                    out = route(brain, data)
            except KeyError as e:
                return self._send({"error": f"missing field {e}"}, 400)
            except (ValueError, TypeError):
                return self._send({"error": "invalid input"}, 400)
            except Exception:
                traceback.print_exc(file=sys.stderr)  # details stay in the server log, never in the response
                return self._send({"error": "internal error"}, 500)
            self._send(out, 200)

        def log_message(self, *a):
            pass

    return H


def main():
    host = os.environ.get("BRAIN_HOST", "127.0.0.1")
    port = int(os.environ.get("PORT") or os.environ.get("BRAIN_PORT") or 8787)
    if host not in LOOPBACK and not os.environ.get("BRAIN_TOKEN"):
        sys.exit("Refusing to start: BRAIN_TOKEN is required when BRAIN_HOST is not a loopback address.")
    print(f"HIVE brain on {host}:{port} (auth {'on' if os.environ.get('BRAIN_TOKEN') else 'off'})", flush=True)
    ThreadingHTTPServer((host, port), make_handler(Brain())).serve_forever()


if __name__ == "__main__":
    main()
