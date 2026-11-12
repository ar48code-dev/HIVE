"""Agent Payment Firewall core: signed mandates, parsers, deterministic verifier, risk, audit log.
The LLM may PROPOSE a mandate, but only this verifier decides. Untrusted text can never change a verdict."""
import hashlib, hmac, json, math, os, re, time
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone

# Signs mandates held in this process's memory. Set FIREWALL_SECRET to keep signatures valid across restarts;
# otherwise a random key is generated per process (so there is never a guessable default).
SECRET = os.environ.get("FIREWALL_SECRET", "").encode() or os.urandom(32)
KNOWN_CATS = ["electronics", "books", "groceries", "travel", "software", "clothing", "food", "jewelry"]
ALLOWED_KEYS = {"max_amount", "currency", "categories", "blocked_weekdays", "daily_limit", "approval_above", "expires_at"}
INJECTION = [r"ignore (?:all |any |previous |prior )*instructions", r"system prompt", r"you are now",
             r"approve (?:this|the) (?:order|payment|purchase)", r"do not (?:tell|ask|notify)"]

@dataclass
class Mandate:
    max_amount: float
    currency: str = "USD"
    categories: list = field(default_factory=list)       # empty = any
    blocked_weekdays: list = field(default_factory=list)  # 0=Mon .. 6=Sun
    daily_limit: float = 0.0
    approval_above: float = 0.0
    expires_at: float = 0.0
    sig: str = ""
    def _body(self):
        d = asdict(self); d.pop("sig")
        return json.dumps(d, sort_keys=True, separators=(",", ":")).encode()
    def sign(self):
        self.sig = hmac.new(SECRET, self._body(), hashlib.sha256).hexdigest(); return self
    def sig_ok(self):
        return hmac.compare_digest(self.sig, hmac.new(SECRET, self._body(), hashlib.sha256).hexdigest())

def validate(m):
    ok = isinstance(m.max_amount, (int, float)) and math.isfinite(m.max_amount) and m.max_amount > 0
    ok = ok and isinstance(m.currency, str) and len(m.currency) == 3
    ok = ok and isinstance(m.categories, list) and isinstance(m.blocked_weekdays, list)
    if not ok: raise ValueError("invalid mandate")
    return m

def _num(p, t):
    m = re.search(p, t); return float(m.group(1)) if m else 0.0

def parse_rule(text, now=None):
    """Offline fallback parser (no LLM needed)."""
    t, now = text.lower(), now or time.time()
    never = set(re.findall(r"never\s+(?:buy\s+)?(\w+)", t))
    days = _num(r"for\s+(\d+)\s+days?", t)
    m = Mandate(_num(r"(?:up to|under|max(?:imum)?|at most|below)\s*\$?(\d+(?:\.\d+)?)", t), "USD",
                [c for c in KNOWN_CATS if c in t and c not in never],
                [5, 6] if re.search(r"never\s+(?:on\s+)?weekends?", t) else [],
                _num(r"daily limit\s*\$?(\d+(?:\.\d+)?)", t),
                _num(r"(?:ask me|approval) above\s*\$?(\d+(?:\.\d+)?)", t),
                now + days * 86400 if days else 0.0)
    return validate(m).sign()

def parse_llm(text, llm):
    """llm(text) -> JSON string. Strict schema: unknown keys or bad types are rejected."""
    d = json.loads(llm(text))
    if not isinstance(d, dict) or set(d) - ALLOWED_KEYS: raise ValueError("schema violation")
    return validate(Mandate(**d)).sign()

class AuditLog:
    """Hash-chained, tamper-evident log."""
    def __init__(self): self.entries = []
    @staticmethod
    def _h(prev, ev): return hashlib.sha256((prev + json.dumps(ev, sort_keys=True, default=str)).encode()).hexdigest()
    def append(self, ev):
        prev = self.entries[-1]["hash"] if self.entries else "0" * 64
        self.entries.append({"ev": ev, "prev": prev, "hash": self._h(prev, ev)})
    def verify(self):
        prev = "0" * 64
        for e in self.entries:
            if e["prev"] != prev or e["hash"] != self._h(prev, e["ev"]): return False
            prev = e["hash"]
        return True

@dataclass
class Decision:
    verdict: str   # allow | needs_approval | deny
    reasons: list
    risk: float

class Firewall:
    def __init__(self, mandate):
        self.m, self.log, self.spent, self.known = mandate, AuditLog(), {}, set()
    def authorize(self, order, now=None):
        now, m, hard, soft = now or time.time(), self.m, [], []
        amt = order.get("amount")
        valid_amt = isinstance(amt, (int, float)) and not isinstance(amt, bool) and math.isfinite(amt) and amt > 0
        if not valid_amt: hard.append("invalid amount")
        if not m.sig_ok(): hard.append("mandate signature invalid")
        if m.expires_at and now > m.expires_at: hard.append("mandate expired")
        if order.get("currency") != m.currency: hard.append("currency not allowed")
        if m.categories and order.get("category") not in m.categories: hard.append("category not allowed")
        d = datetime.fromtimestamp(now, timezone.utc)
        if d.weekday() in m.blocked_weekdays: hard.append("blocked weekday")
        if valid_amt and not hard:
            day = d.strftime("%Y-%m-%d")
            if amt > m.max_amount: hard.append("over max amount")
            if m.daily_limit and self.spent.get(day, 0) + amt > m.daily_limit: hard.append("daily limit exceeded")
            if m.approval_above and amt > m.approval_above: soft.append("above approval threshold")
        text = str(order.get("untrusted_text", "")).lower()
        inj = any(re.search(p, text) for p in INJECTION)
        if inj: soft.append("prompt-injection pattern in untrusted text")
        risk = 1.0 if not valid_amt else min(1.0, 0.5 * amt / m.max_amount + 0.4 * (order.get("merchant") not in self.known) + 0.5 * inj)
        if risk >= 0.8: soft.append("high risk score")
        verdict = "deny" if hard else "needs_approval" if soft else "allow"
        if verdict == "allow":
            self.spent[d.strftime("%Y-%m-%d")] = self.spent.get(d.strftime("%Y-%m-%d"), 0) + amt
            self.known.add(order.get("merchant"))
        dec = Decision(verdict, hard + soft, round(risk, 2))
        self.log.append({"t": now, "order": {k: v for k, v in order.items() if k != "untrusted_text"}, "decision": asdict(dec)})
        return dec
