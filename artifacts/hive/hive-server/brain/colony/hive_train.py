"""Train the risk model on HIVE's Wasp Lab streams and evaluate it.   python -m colony.hive_train [--no-augment]

Training uses streams from seeds 1-50. Evaluation uses held-out seeds 100-119 with HIVE's own metric (the first 30 days are warm-up and not scored;
hard negatives are reported separately). Because held-out seeds of the SAME generator only test familiarity, it also reports a CROSS-GENERATOR
result: the same model scored on streams from a different generator (colony/sim.py).

Augmentation (on by default) replays every training stream with a random shop size (prices 0.15x to 10x) and, for card testing and failed streaks,
the attack played faster or slower, so the model does not learn "big basket" or "this exact tempo" as signals.
"""
import gzip, json, random, sys
import numpy as np
from colony import sim
from colony.riskmodel import Logit

MD = "colony/models"; SRC = "colony/data/hive_streams.json.gz"
TINY_ATTACKS = {"card_testing", "slow_card_testing"}      # testers charge about $1 whatever the shop sells
WARPABLE = {"card_testing", "slow_card_testing", "failed_streak"}
WARPS = (0.5, 1, 1, 2, 5)


def prep(s):
    R = s["rows"]
    X = sim.featurize([dict(t=r[0], c=r[1], a=r[2], k=r[3]) for r in R], extended=True)
    col = lambda i, dt=int: np.array([r[i] for r in R], dtype=dt)
    return X, col(4), col(5), col(6, bool), col(7, bool)


def variant(s, rng):
    """The same stream for a different shop (price level) and, for some attacks, a different tempo."""
    k = float(np.exp(rng.uniform(np.log(0.15), np.log(10))))
    rows = [[r[0], r[1], r[2] if (s["attack"] in TINY_ATTACKS and r[4]) else round(max(r[2] * k, 0.2), 2), *r[3:]] for r in s["rows"]]
    if s["attack"] in WARPABLE:
        f = rng.choice(WARPS); t0 = min(r[0] for r in rows if r[4])
        rows = [[t0 + (r[0] - t0) * f if r[4] else r[0], *r[1:]] for r in rows]
        rows.sort(key=lambda r: r[0])
    return dict(s, rows=rows)


def cross_generator(m, thr, seeds=range(100, 120)):
    """Score streams from a DIFFERENT generator (colony/sim.py) with the HIVE-trained model."""
    caught, total, fa, ben = {}, {}, 0, 0
    for sd in seeds:
        tx = sim.make_stream(sd); X = sim.featurize(tx, extended=True); fl = m.proba(X) >= thr
        for a in {x["atk"] for x in tx if x["y"]}:
            idx = [i for i, x in enumerate(tx) if x["atk"] == a]
            total[a] = total.get(a, 0) + 1; caught[a] = caught.get(a, 0) + int(fl[idx].any())
        b = [i for i, x in enumerate(tx) if not x["y"] and not x["hn"] and tx[i]["t"] > 5 * sim.DAY]
        fa += int(fl[b].sum()); ben += len(b)
    return {a: f"{caught[a]}/{total[a]}" for a in sorted(total)} | {"false_alarms_per_1000_benign": round(1000 * fa / max(ben, 1), 1)}


def main(augment=True):
    D = json.load(gzip.open(SRC, "rt")); rng = np.random.default_rng(0); pyrng = random.Random(0)
    streams = list(D["train"])
    if augment: streams += [variant(s, rng) for s in D["train"] for _ in range(5)]
    tr = [prep(s) for s in streams]
    X = np.vstack([x[ev] for x, y, hn, ev, rf in tr]); y = np.concatenate([y[ev] for x, y, hn, ev, rf in tr]); hn = np.concatenate([hn[ev] for x, y, hn, ev, rf in tr])
    m = Logit(sim.FEATS_EXT, sim.LOGCOLS_EXT).fit(X, y); p = m.proba(X)
    thr = float(np.quantile(p[(y == 0) & (hn == 0)], .99))   # fixed in advance: ~1% false alarms on benign training rows
    m.save(f"{MD}/risk_hive.json")
    with open(f"{MD}/risk_hive_threshold.txt", "w") as f: f.write(str(thr))
    res = {"augmented": augment, "train": {"streams": len(tr), "rows": int(len(y)), "attack_rows": int(y.sum())}, "threshold": round(thr, 3), "test_seeds": "100-119 (held out, same generator)"}
    agg = {k: dict(fa=0, hard=0, ben=0, hn=0) for k in ("model", "hive rules", "model OR rules")}
    for attack in sorted({s["attack"] for s in D["test"]}):
        c = {k: 0 for k in agg}; n = 0
        for s in [s for s in D["test"] if s["attack"] == attack]:
            Xt, yt, hnt, evt, rft = prep(s); fl = {"model": m.proba(Xt) >= thr, "hive rules": rft}; fl["model OR rules"] = fl["model"] | fl["hive rules"]; n += 1
            for k, f in fl.items():
                c[k] += int((f & (yt == 1) & evt).any()); b = evt & (yt == 0) & (hnt == 0); h = evt & (hnt == 1)
                agg[k]["fa"] += int((f & b).sum()); agg[k]["ben"] += int(b.sum()); agg[k]["hard"] += int((f & h).sum()); agg[k]["hn"] += int(h.sum())
        res[attack] = {k: f"{c[k]}/{n}" for k in agg}
    res["false_alarms_per_1000_benign"] = {k: round(1000 * v["fa"] / v["ben"], 1) for k, v in agg.items()}
    res["hard_negative_false_alarm_rate"] = {k: round(v["hard"] / v["hn"], 3) for k, v in agg.items()}
    res["cross_generator (colony/sim.py streams, never trained on)"] = cross_generator(m, thr)
    print(json.dumps(res, indent=1))
    with open("colony/hive_scorecard.json", "w") as f: json.dump(res, f, indent=1)


if __name__ == "__main__": main(augment="--no-augment" not in sys.argv)
