"""BM25 retriever (from scratch). Returns evidence IDs so every answer can cite real records."""
import math, re, collections
def tok(t): return re.findall(r"[a-z0-9]+(?:\.[0-9]+)?", t.lower())
class BM25:
    def __init__(self, k1=1.5, b=.75): self.k1, self.b, self.ids, self.tf, self.len, self.df = k1, b, [], [], [], collections.Counter()
    def add(self, id_, text):
        c = collections.Counter(tok(text)); self.ids.append(id_); self.tf.append(c); self.len.append(sum(c.values())); self.df.update(c.keys())
    def search(self, q, k=5):
        N, avg, out = len(self.ids), sum(self.len) / max(len(self.ids), 1), []
        for i, c in enumerate(self.tf):
            s = sum(math.log(1 + (N - self.df[w] + .5) / (self.df[w] + .5)) * c[w] * (self.k1 + 1) / (c[w] + self.k1 * (1 - self.b + self.b * self.len[i] / avg)) for w in set(tok(q)) if w in c)
            out.append((s, i))
        return [(self.ids[i], round(s, 3)) for s, i in sorted(out, reverse=True)[:k] if s > 0]
