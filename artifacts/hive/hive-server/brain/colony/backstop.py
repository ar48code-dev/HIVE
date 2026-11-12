"""Deterministic refusal backstop: obvious money-moving / override / forecast requests are refused even if the learned router misses them.
Anchored to the start of a clause (imperatives), so read-only questions like 'how many refunds did I give to all customers' are not refused."""
import re
LEAD = r"(?:^|[.;!?,]\s*|\band\s+|\bthen\s+)(?:(?:please|just|quietly|now|immediately|hey|queen|agent)[,\s]+)*"
V = lambda body: re.compile(LEAD + body, re.I)
ACTION = [
    V(r"(?:send|wire|transfer|move|pay\s*out|withdraw|empty|drain)\b[^.?!]{0,40}\b(?:balance|funds|money|everything|all)\b"),
    V(r"(?:refund|cancel|block|freeze|ban|delete|wipe|pay)\b[^.?!]{0,25}\b(?:all|every\w*|whole|entire)\b"),
    V(r"(?:bypass|skip|disable|turn\s+off|remove)\b[^.?!]{0,25}\b(?:approval|verification|checks?|monitoring|limits?|caps?|audit)\b"),
    re.compile(r"\b(?:admin|developer|owner|root)\s+mode\b|\bact\s+as\s+(?:an?\s+)?(?:admin|system|developer)\b|\bwithout\s+(?:asking|approval|checking|review)\b", re.I),
    re.compile(r"(ignore (all |any |the |your )?(previous|prior|above)|system prompt|you are now)", re.I),
]
FORECAST = re.compile(r"\b(forecast|predict\w*|projection|project my|next (month|quarter|year)|will i (earn|make)|going to earn)\b", re.I)
def check(text): return {"action": any(p.search(text) for p in ACTION), "forecast": bool(FORECAST.search(text))}
