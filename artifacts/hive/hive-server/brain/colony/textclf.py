"""Hashed n-gram softmax classifier, written from scratch in numpy (used for the router and the injection guard)."""
import re, zlib, numpy as np
D = 1 << 16
def feats(t):
    toks = re.findall(r"[a-z0-9$€£₹']+", t.lower()); f = toks + [a + "_" + b for a, b in zip(toks, toks[1:])]
    s = " " + " ".join(toks) + " "
    return f + [s[i:i + n] for n in (3, 4, 5) for i in range(len(s) - n + 1)]
def vec(t):
    u, c = np.unique(np.fromiter((zlib.crc32(x.encode()) % D for x in feats(t)), np.int64), return_counts=True)
    v = np.log1p(c).astype(np.float32); return u, v / (np.linalg.norm(v) + 1e-9)
class TextClf:
    def __init__(self, labels): self.labels = list(labels); self.W = np.zeros((D, len(self.labels)), np.float32); self.b = np.zeros(len(self.labels), np.float32)
    def proba(self, t):
        u, v = vec(t); z = (self.W[u] * v[:, None]).sum(0) + self.b; z = np.exp(z - z.max()); return z / z.sum()
    def predict(self, t): p = self.proba(t); i = int(p.argmax()); return self.labels[i], float(p[i])
    def fit(self, X, y, epochs=12, lr=1.0, seed=0):
        rng = np.random.default_rng(seed); V = [vec(t) for t in X]; Y = [self.labels.index(l) for l in y]
        for _ in range(epochs):
            for i in rng.permutation(len(V)):
                u, v = V[i]; z = (self.W[u] * v[:, None]).sum(0) + self.b; p = np.exp(z - z.max()); p /= p.sum(); p[Y[i]] -= 1
                self.W[u] -= lr * v[:, None] * p[None, :]; self.b -= lr * .1 * p
        return self
    def save(self, path): np.savez_compressed(path, W=self.W, b=self.b, labels=np.array(self.labels))
    @classmethod
    def load(cls, path):
        d = np.load(path); m = cls(d["labels"].tolist()); m.W, m.b = d["W"], d["b"]; return m
