"""Synthetic merchant transaction streams with labelled attacks and hard negatives (flash sale, bulk order). Written by us: results are on synthetic data."""
import random, collections, statistics, numpy as np
DAY = 86400
ATTACKS = ["card_testing", "refund_abuse", "duplicate_payment", "new_customer_large", "failed_streak", "concentration_shift"]
FEATS = ["log_amt", "amt_vs_median", "is_new", "n_10m", "n_1h", "small_amt", "n_small_10m", "fails_1h", "is_fail", "is_refund", "refunds_30d", "dup_120s", "share_7d", "distinct_cust_1h", "amt_vs_own", "pays_30d"]
LOGCOLS = [1, 3, 4, 6, 7, 10, 13, 14, 15]
FEATS_EXT = FEATS + ["g_small_10m", "g_new_10m", "g_pay_10m", "g_fail_10m"]   # merchant-wide 10-minute context (sees attacks spread over many throwaway customers)
LOGCOLS_EXT = LOGCOLS + [16, 17, 18, 19]
def make_stream(seed, hard=True):
    r = random.Random(seed); T = 30 * DAY; tx = []
    def add(t, c, a, k="pay", y=0, atk="", hn=0): tx.append(dict(t=t, c=c, a=round(a, 2), k=k, y=y, atk=atk, hn=hn))
    regs = {f"c{i}": r.choice([15, 25, 40, 60, 90]) for i in range(40)}
    for c, base in regs.items():
        for _ in range(r.randint(3, 10)):
            t = r.uniform(0, T); a = max(2, r.gauss(base, base * .3)); add(t, c, a, "fail" if r.random() < .02 else "pay")
            if r.random() < .03: add(t + r.uniform(3600, 3 * DAY), c, a, "refund")
    for _ in range(60): add(r.uniform(0, T), f"n{r.randrange(10**6)}", r.uniform(10, 150), "fail" if r.random() < .03 else "pay")
    if hard:
        t0 = r.uniform(3 * DAY, 25 * DAY)
        for _ in range(30): add(t0 + r.uniform(0, 3600), f"n{r.randrange(10**6)}", r.uniform(15, 60), hn=1)
        c = r.choice(list(regs)); add(r.uniform(3 * DAY, 25 * DAY), c, regs[c] * 3, hn=1)
    st = lambda: r.uniform(5 * DAY, 28 * DAY)
    t, c = st(), f"n{r.randrange(10**6)}"
    for i in range(12): add(t + i * 40, c, r.uniform(1, 2), "fail" if r.random() < .3 else "pay", 1, "card_testing")
    t, c, a = st(), r.choice(list(regs)), r.uniform(30, 90)
    for i in range(3): add(t + i * 6 * 3600, c, a, "pay", 1, "refund_abuse"); add(t + i * 6 * 3600 + 3600, c, a, "refund", 1, "refund_abuse")
    t, c, a = st(), r.choice(list(regs)), r.uniform(20, 80); add(t, c, a); add(t + 30, c, a, "pay", 1, "duplicate_payment")
    add(st(), f"n{r.randrange(10**6)}", r.uniform(900, 1500), "pay", 1, "new_customer_large")
    t, c = st(), f"n{r.randrange(10**6)}"
    for i in range(6): add(t + i * 50, c, r.uniform(20, 80), "fail", 1, "failed_streak")
    t, c = st(), r.choice(list(regs))
    for i in range(12): add(t + i * 5 * 3600, c, regs[c] * 3, "pay", 1, "concentration_shift")
    return sorted(tx, key=lambda x: x["t"])

def featurize(tx, extended=False):
    hist, pays, allx, X = collections.defaultdict(list), [], [], []
    for x in tx:
        h, t, a, k = hist[x["c"]], x["t"], x["a"], x["k"]
        r10, r1h, r30 = ([e for e in h if t - e[0] <= w] for w in (600, 3600, 30 * DAY))
        med = statistics.median([p[1] for p in pays[-100:]]) if pays else 40.
        own = [e[1] for e in r30 if e[2] == "pay"]; own_med = statistics.median(own) if own else med
        p7 = sum(e[1] for e in h if e[2] == "pay" and t - e[0] <= 7 * DAY); tot7 = sum(p[1] for p in pays if t - p[0] <= 7 * DAY) + 1e-9
        row = [np.log1p(a), a / (med + 1e-9), float(not h), len(r10), len(r1h), float(a < 3), sum(e[1] < 3 for e in r10), sum(e[2] == "fail" for e in r1h),
                  float(k == "fail"), float(k == "refund"), sum(e[2] == "refund" for e in r30), float(any(abs(e[0] - t) <= 120 and abs(e[1] - a) < 1e-9 for e in h)),
                  p7 / tot7, len({p[2] for p in pays if t - p[0] <= 3600}), a / (own_med + 1e-9), sum(e[2] == "pay" for e in r30)]
        if extended:
            g = []
            for e in reversed(allx):
                if t - e[0] > 600: break
                g.append(e)
            row += [sum(e[2] == "pay" and e[1] < .2 * med for e in g), sum(e[3] for e in g), sum(e[2] == "pay" for e in g), sum(e[2] == "fail" for e in g)]
        X.append(row); allx.append((t, a, k, row[2]))
        h.append((t, a, k))
        if k == "pay": pays.append((t, a, x["c"]))
    return np.array(X, float)

def rule_flags(X):
    """Our Python re-implementation of simple threshold rules (NOT HIVE's TypeScript engine)."""
    f = lambda n: X[:, FEATS.index(n)]
    return (f("n_small_10m") >= 4) | (f("dup_120s") == 1) | ((f("is_new") == 1) & (f("amt_vs_median") > 8)) | (f("fails_1h") >= 4) | (f("refunds_30d") >= 2) | ((f("share_7d") > .35) & (f("amt_vs_own") > 2))
