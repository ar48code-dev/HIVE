"""PII masker: emails, Luhn-valid card numbers, IPv4, phone numbers. Limitation: long digit runs (e.g. 10-digit timestamps) can be masked as phones."""
import re
def _luhn(s):
    d = [int(c) for c in re.sub(r"\D", "", s)][::-1]
    return 13 <= len(d) <= 19 and sum(x if i % 2 == 0 else (x * 2 - 9 if x * 2 > 9 else x * 2) for i, x in enumerate(d)) % 10 == 0
CARD = re.compile(r"\b(?:\d[ -]?){12,18}\d\b"); PHONE = re.compile(r"(?<![\w.])\+?\d[\d ()-]{8,}\d")
SIMPLE = [("EMAIL", re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")), ("IPV4", re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b"))]
def mask(text):
    found = []
    def card(m):
        if _luhn(m.group()): found.append("CARD"); return "[CARD]"
        return m.group()
    out = CARD.sub(card, text)
    for name, rx in SIMPLE: out = rx.sub(lambda m, n=name: (found.append(n), f"[{n}]")[1], out)
    def ph(m):
        if len(re.sub(r"\D", "", m.group())) >= 9: found.append("PHONE"); return "[PHONE]"
        return m.group()
    return PHONE.sub(ph, out), found
