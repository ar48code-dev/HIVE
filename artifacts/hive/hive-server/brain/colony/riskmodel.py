"""Logistic-regression risk scorer (numpy, from scratch) with per-feature explanations."""
import json, numpy as np
from colony.sim import FEATS, LOGCOLS
class Logit:
    def __init__(self, feats=None, logcols=None): self.feats, self.logcols = list(feats or FEATS), list(logcols or LOGCOLS)
    @property
    def extended(self): return len(self.feats) > len(FEATS)
    def _prep(self, X, fit=False):
        Z = np.array(X, float).copy(); Z[:, self.logcols] = np.log1p(np.abs(Z[:, self.logcols]))
        if fit: self.mu, self.sd = Z.mean(0), Z.std(0) + 1e-9
        return (Z - self.mu) / self.sd
    def fit(self, X, y, iters=800, lr=.5, l2=1e-3, pos_w=10.):
        Z, y = self._prep(X, True), np.asarray(y, float); w, b, sw = np.zeros(Z.shape[1]), 0., np.where(y == 1, pos_w, 1.)
        for _ in range(iters):
            g = sw * (1 / (1 + np.exp(-(Z @ w + b))) - y); w -= lr * (Z.T @ g / len(y) + l2 * w); b -= lr * g.mean()
        self.w, self.b = w, b; return self
    def proba(self, X): return 1 / (1 + np.exp(-(self._prep(X) @ self.w + self.b)))
    def explain(self, x, k=3):
        c = self._prep(np.array([x]))[0] * self.w; return [(self.feats[i], round(float(c[i]), 2)) for i in np.argsort(-c)[:k] if c[i] > 0]
    def save(self, p): json.dump({k: getattr(self, k).tolist() if hasattr(getattr(self, k), "tolist") else getattr(self, k) for k in ("w", "b", "mu", "sd")} | {"feats": self.feats, "logcols": self.logcols}, open(p, "w"))
    @classmethod
    def load(cls, p):
        d = json.load(open(p)); m = cls(d.get("feats"), d.get("logcols")); m.w, m.b, m.mu, m.sd = np.array(d["w"]), d["b"], np.array(d["mu"]), np.array(d["sd"]); return m
