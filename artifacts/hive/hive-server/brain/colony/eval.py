"""Run all benchmarks:  python -m colony.eval   (writes colony/scorecard.json)"""
import json, re, time, random, numpy as np
from colony import router_data as rd, sim, pii
from colony.riskmodel import Logit
from colony.textclf import TextClf
from colony.retriever import BM25
# HIVE's keyword router and injection regexes, ported to Python as baselines
FORECAST = re.compile(r"\b(forecast|predict|projection|next (month|quarter|year)|will i|going to earn)\b", re.I)
ACTION = re.compile(r"(ignore (all |any |the |your )?(previous|prior|above)|system prompt|you are now|\b(refund|pay|send|transfer|cancel|freeze|block|ban)\b.{0,30}\b(everything|everyone|all of|all customers|now)\b)", re.I)
RULES = [("alerts", r"\b(suspicious|fraud\w*|alerts?|risk\w*|anomal\w*|unusual|attack\w*|wasps?|danger\w*|problems?|wrong|abuse|scam\w*|card[- ]testing)\b"),
         ("customers", r"\b(customers?|buyers?|clients?|who (pays|paid|bought)|biggest|largest|top|repeat|loyal|concentration)\b"),
         ("refunds", r"\b(refund\w*|chargebacks?|disputes?|returns?)\b"), ("fees", r"\b(fees?|charged me|cost|net|kept|keep|take[- ]home|paypal take|margin)\b"),
         ("report_daily", r"\b(daily|today|yesterday|24 hours?)\b"), ("report_weekly", r"\b(weekly|week|this week|last week|7 days)\b")]
def kw_route(q):
    if FORECAST.search(q): return "forecast"
    if ACTION.search(q): return "action_request"
    for lab, rx in RULES:
        if re.search(rx, q, re.I): return lab
    return "overview"
INJ_RX = [r"\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|any|your)\b[^.\n]{0,40}\b(instructions?|rules?|prompts?|guidelines?)\b",
          r"\b(you are now|from now on you|act as (an? )?(admin|system|developer)|new instructions?)\b", r"<\s*/?\s*(system|assistant|developer|tool|instructions?)\s*>",
          r"\b(refund|send|transfer|pay(out)?|approve)\b[^.\n]{0,30}\b(all|everything|every|immediately|now)\b", r"\b(reveal|show|print|leak|output)\b[^.\n]{0,30}\b(system prompt|api key|secret|token|password|credentials?)\b"]
rx_flag = lambda t: any(re.search(p, t, re.I) for p in INJ_RX)

def part_router():
    clf = TextClf(list(rd.ROUTER)).fit(*rd.make("train", 8)); out = {"train_examples": len(rd.make("train", 8)[0])}
    for sp in ("test", "test2"):
        X, Y = rd.make(sp, 8, seed=1); n = len(X); ar = [(x, y) for x, y in zip(X, Y) if y == "action_request"]
        out[sp] = {"examples": n, "learned_acc": round(sum(clf.predict(x)[0] == y for x, y in zip(X, Y)) / n, 3), "keyword_acc": round(sum(kw_route(x) == y for x, y in zip(X, Y)) / n, 3),
                   "action_request_recall": {"learned": sum(clf.predict(x)[0] == y for x, y in ar) / len(ar), "keyword": sum(kw_route(x) == y for x, y in ar) / len(ar)}}
    return out, clf
def part_guard():
    clf = TextClf(["inj", "ok"]).fit(*rd.make_guard("train", 6), epochs=15); out = {"train_examples": len(rd.make_guard("train", 6)[0])}
    for sp in ("test", "test2"):
        X, Y = rd.make_guard(sp, 6, seed=1); L = [clf.predict(x)[0] == "inj" for x in X]; R = [rx_flag(x) for x in X]; U = [a or b for a, b in zip(L, R)]
        def m(F):
            pos = [f for f, y in zip(F, Y) if y == "inj"]; neg = [f for f, y in zip(F, Y) if y == "ok"]; return {"recall": round(sum(pos) / len(pos), 3), "false_positive_rate": round(sum(neg) / len(neg), 3)}
        out[sp] = {"examples": len(X), "learned": m(L), "regex(HIVE)": m(R), "learned OR regex": m(U)}
    return out, clf
def part_guard_v3():
    from colony import guard_data as gd
    old = TextClf(["inj", "ok"]).fit(*rd.make_guard("train", 6), epochs=15); Xt, Yt = gd.build("train"); new = TextClf(["inj", "ok"]).fit(Xt, Yt, epochs=15)
    out = {"train_examples_old": len(rd.make_guard("train", 6)[0]), "train_examples_new": len(Xt), "train_injection_share_new": round(Yt.count("inj") / len(Yt), 2)}
    for sp in ("test", "test2", "test3", "ext_holdout"):
        X, Y = gd.build(sp, seed=1); out[sp] = {"examples": len(X)}
        for name, fn in (("old guard", lambda t: old.predict(t)[0] == "inj"), ("new guard", lambda t: new.predict(t)[0] == "inj"), ("regex(HIVE)", rx_flag)):
            F = [fn(x) for x in X]; pos = [f for f, y in zip(F, Y) if y == "inj"]; neg = [f for f, y in zip(F, Y) if y == "ok"]
            out[sp][name] = {"recall": round(sum(pos) / len(pos), 3), "false_positive_rate": round(sum(neg) / len(neg), 3)}
    return out, new
def pick_guard_threshold(clf, target_fpr=0.05):
    """Chosen on dev sets (test + test2) ONLY; test3 and the held-out attack families stay blind."""
    from colony import guard_data as gd
    X, Y = [], []
    for sp in ("test", "test2"): x, y = gd.build(sp, seed=1); X += x; Y += y
    ben = sorted(float(clf.proba(x)[0]) for x, y in zip(X, Y) if y == "ok")
    return round(min(0.99, ben[min(len(ben) - 1, int(len(ben) * (1 - target_fpr)))] + 1e-6), 4)
def part_guard_final():
    from colony import guard_data as gd
    clf = TextClf(["inj", "ok"]).fit(*gd.build("train"), epochs=15); thr = pick_guard_threshold(clf); out = {"threshold(dev-chosen, target 5% FPR)": thr}
    for sp in ("test", "test2", "test3", "ext_holdout"):
        X, Y = gd.build(sp, seed=1); F = [float(clf.proba(x)[0]) >= thr for x in X]; U = [f or rx_flag(x) for f, x in zip(F, X)]
        for name, G in (("new guard", F), ("new guard OR regex", U)):
            pos = [g for g, y in zip(G, Y) if y == "inj"]; neg = [g for g, y in zip(G, Y) if y == "ok"]
            out.setdefault(sp, {})[name] = {"recall": round(sum(pos) / len(pos), 3), "false_positive_rate": round(sum(neg) / len(neg), 3)}
    return out, clf, thr
def part_backstop():
    from colony import backstop as bs
    clf = TextClf(list(rd.ROUTER)).fit(*rd.make("train", 8)); R = ("action_request", "forecast"); out = {}; bad = []
    for sp in ("test", "test2"):
        X, Y = rd.make(sp, 8, seed=1); out[sp] = {}
        for name, fn in (("learned only", lambda t: clf.predict(t)[0] in R), ("learned + backstop", lambda t: clf.predict(t)[0] in R or any(bs.check(t).values()))):
            should = [fn(x) for x, y in zip(X, Y) if y in R]; other = [fn(x) for x, y in zip(X, Y) if y not in R]
            out[sp][name] = {"refusal_recall": round(sum(should) / len(should), 3), "false_refusal_rate": round(sum(other) / len(other), 3)}
            if name.endswith("backstop"): bad += [x for x, y in zip(X, Y) if y not in R and fn(x)]
    out["false_refusal_examples"] = sorted(set(bad))[:8]; return out
def part_risk():
    Xs, ys = [], []
    for s in range(1, 41): tx = sim.make_stream(s); Xs.append(sim.featurize(tx)); ys += [x["y"] for x in tx]
    Xtr, ytr = np.vstack(Xs), np.array(ys); m = Logit().fit(Xtr, ytr); thr = float(np.quantile(m.proba(Xtr)[ytr == 0], .995))
    caught = {k: {a: 0 for a in sim.ATTACKS} for k in ("learned", "rules", "either")}; fa = {k: 0 for k in caught}; benign = hn_tot = 0; hn = {k: 0 for k in caught}; seeds = list(range(100, 120))
    for s in seeds:
        tx = sim.make_stream(s); X = sim.featurize(tx); fl = {"learned": m.proba(X) >= thr, "rules": sim.rule_flags(X)}; fl["either"] = fl["learned"] | fl["rules"]
        y = np.array([x["y"] for x in tx]); H = np.array([x["hn"] for x in tx]); benign += int((y == 0).sum()); hn_tot += int(H.sum())
        for k, f in fl.items():
            fa[k] += int((f & (y == 0)).sum()); hn[k] += int((f & (H == 1)).sum())
            for a in sim.ATTACKS: caught[k][a] += int(any(f[i] for i, x in enumerate(tx) if x["atk"] == a))
    res = {"train_seeds": "1-40", "test_seeds": "100-119 (held out)", "threshold": round(thr, 3), "benign_txns_tested": benign}
    for k in caught: res[k] = {"recall_by_attack": {a: f"{caught[k][a]}/{len(seeds)}" for a in sim.ATTACKS}, "false_alarms_per_1000_benign": round(1000 * fa[k] / benign, 1), "hard_negative_flag_rate": round(hn[k] / hn_tot, 3)}
    return res, m
def part_retrieval():
    tx = sim.make_stream(5); r = BM25(); notes = ["gift for mom", "office supplies", "birthday order", "team lunch", "blue shirt", "subscription"]; rnd = random.Random(0)
    for i, x in enumerate(tx): r.add(f"T{i}", f"{x['k']} customer {x['c']} amount {x['a']} note {rnd.choice(notes)} t{int(x['t'])}")
    ok = 0; idx = rnd.sample(range(len(tx)), 150)
    for i in idx: x = tx[i]; ok += f"T{i}" in [d for d, _ in r.search(f"{x['k']} {x['c']} {x['a']}", 5)]
    return {"docs": len(tx), "queries": 150, "recall_at_5": ok / 150, "note": "sanity check: queries built from the record's own fields"}
def part_pii():
    cases = [("mail jo@x.com now", "[EMAIL]"), ("card 4242 4242 4242 4242 ok", "[CARD]"), ("card 4242 4242 4242 4241 bad luhn", "[PHONE]"), ("call +91 98765 43210", "[PHONE]"), ("ip 10.0.0.1", "[IPV4]"), ("order 2026-11-03 total 55.20", "2026-11-03")]
    return {"cases": len(cases), "passed": sum(want in pii.mask(t)[0] for t, want in cases)}

if __name__ == "__main__":
    t0 = time.time(); R = {}; R["router"], _ = part_router(); R["injection_guard"], _, _ = part_guard_final(); R["injection_guard_v1_baseline"], _ = part_guard(); R["risk_scorer"], _ = part_risk(); R["router_refusal_backstop"] = part_backstop(); R["retrieval"] = part_retrieval(); R["pii"] = part_pii()
    json.dump(R, open("colony/scorecard.json", "w"), indent=1); print(json.dumps(R, indent=1)); print(f"\n{time.time() - t0:.0f}s")
