"""ColonyBrain: wires every model together. Models PROPOSE; the deterministic Firewall DECIDES; a human CONFIRMS policies."""
import os, re
from dataclasses import asdict
import numpy as np
from colony import router_data as rd, sim, pii
from colony.textclf import TextClf
from colony.riskmodel import Logit
from colony.retriever import BM25
from colony.eval import rx_flag
from colony import backstop, guard_data as gd
from firewall import Firewall
MD = os.path.join(os.path.dirname(__file__), "models")
ALERT_NO = re.compile(r"\balert\s*(?:#|no\.?|number)?\s*(\d{1,6})\b", re.I)

def train_all():
    os.makedirs(MD, exist_ok=True)
    TextClf(list(rd.ROUTER)).fit(*rd.make("train", 8)).save(f"{MD}/router.npz")
    from colony.eval import pick_guard_threshold
    g = TextClf(["inj", "ok"]).fit(*gd.build("train"), epochs=15); g.save(f"{MD}/guard.npz"); open(f"{MD}/guard_threshold.txt", "w").write(str(pick_guard_threshold(g)))
    Xs, ys = [], []
    for s in range(1, 41): tx = sim.make_stream(s); Xs.append(sim.featurize(tx)); ys += [x["y"] for x in tx]
    X, y = np.vstack(Xs), np.array(ys); m = Logit().fit(X, y); m.save(f"{MD}/risk.json")
    open(f"{MD}/threshold.txt", "w").write(str(float(np.quantile(m.proba(X)[y == 0], .995))))

def _read_float(path):
    with open(path) as f: return float(f.read())

class Brain:
    def __init__(self):
        if not os.path.exists(f"{MD}/risk.json"): train_all()
        self.router, self.guard = TextClf.load(f"{MD}/router.npz"), TextClf.load(f"{MD}/guard.npz")
        hive = os.path.exists(f"{MD}/risk_hive.json")   # prefer the model trained on HIVE's own Wasp Lab streams (python -m colony.hive_train)
        self.risk_source = "hive-wasplab" if hive else "colony-sim"
        self.risk, self.thr = Logit.load(f"{MD}/risk_hive.json" if hive else f"{MD}/risk.json"), _read_float(f"{MD}/risk_hive_threshold.txt" if hive else f"{MD}/threshold.txt")
        self.gthr = _read_float(f"{MD}/guard_threshold.txt")
        self.index, self.policies = BM25(), {}
    def check_text(self, text):
        masked, found = pii.mask(text); p = float(self.guard.proba(text)[0]); regex = rx_flag(text)
        return {"injection": p >= self.gthr or regex, "injection_prob": round(p, 3), "regex_flag": regex, "pii_found": found, "masked": masked}
    def route(self, q):
        m = ALERT_NO.search(q)
        if m: return {"intent": "alert_detail", "alert_no": int(m.group(1)), "confidence": 1.0, "refuse": False}
        lab, conf = self.router.predict(q); g = self.check_text(q); bs = backstop.check(q)
        if bs["action"]: lab, conf = "action_request", max(conf, .99)      # deterministic backstop overrides the learned router
        elif bs["forecast"]: lab, conf = "forecast", max(conf, .99)
        return {"intent": "overview" if conf < .4 else lab, "confidence": round(conf, 2), "refuse": lab in ("action_request", "forecast") or g["regex_flag"],   # learned guard is for untrusted NOTES (/check), not the merchant's own questions
                "injection": g["regex_flag"], "backstop": bs["action"] or bs["forecast"]}
    def score(self, txns):
        txns = sorted(txns, key=lambda x: x["t"]); X = sim.featurize(txns, extended=self.risk.extended); p = self.risk.proba(X); fl = sim.rule_flags(X)
        return [{"i": i, "risk": round(float(p[i]), 3), "flag_model": bool(p[i] >= self.thr), "flag_rules": bool(fl[i]), "why": self.risk.explain(X[i])} for i in range(len(txns))]
    def index_records(self, recs):
        for r in recs: self.index.add(r["id"], r["text"])
        return {"indexed": len(recs)}
    def search(self, q, k=5): return [{"id": i, "score": s} for i, s in self.index.search(q, k)]
    def create_policy(self, text, now=None):
        try: from tinyllm.model import tiny_parse
        except Exception: tiny_parse = None
        if tiny_parse:
            try: m, conf = tiny_parse(text, now); src = "tiny-llm"
            except ValueError as e: return {"ok": False, "needs_review": str(e)}   # model output failed a safety check: do NOT fall back silently
        else:
            from firewall import parse_rule
            try: m, conf, src = parse_rule(text, now), None, "regex-fallback"
            except ValueError: return {"ok": False, "needs_review": "could not read a valid spending limit (for example 'up to $50') from that text"}
        pid = f"p{len(self.policies) + 1}"; self.policies[pid] = {"fw": Firewall(m), "confirmed": False}
        return {"ok": True, "policy_id": pid, "source": src, "confidence": conf, "mandate": {k: v for k, v in asdict(m).items() if k != "sig"}, "needs_human_confirmation": True}
    def confirm_policy(self, pid):
        if pid not in self.policies: return {"ok": False, "error": "unknown policy"}
        self.policies[pid]["confirmed"] = True; return {"policy_id": pid, "confirmed": True}
    def authorize(self, pid, order, now=None):
        p = self.policies.get(pid)
        if p is None: return {"verdict": "deny", "reasons": ["unknown policy"], "risk": 1.0}   # fail closed
        if not p["confirmed"]: return {"verdict": "deny", "reasons": ["policy not confirmed by a human"], "risk": 1.0}
        return asdict(p["fw"].authorize(order, now))
