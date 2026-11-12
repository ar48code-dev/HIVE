# Methodology: what HIVE detects and how it scores

HIVE evaluates each new transaction against the history before it. Detection is a pure function (`../src/risk/engine.ts`): same input, same output, no model calls.

## Rules

| Rule | Fires when | Weight |
|---|---|---|
| CARD_TESTING | 6 or more payment or failed attempts, each tiny, within 15 minutes (weight 0.85); or 8 or more within 3 hours (weight 0.7). "Tiny" means at most $2 and under 40% of the shop's 20th-percentile payment, measured on payments older than 3 hours so an attacker cannot lower the bar for themselves | 0.85 or 0.7 |
| VELOCITY_BURST | 5 or more payments from one customer within 10 minutes | 0.60 |
| DUPLICATE_PAYMENT | Same customer, same amount, within 2 minutes | 0.55 |
| AMOUNT_OUTLIER | Robust z-score of 4 or more against the last 60 days (median and MAD) | 0.60 for new customers, 0.20 for established ones (5 or more prior payments) |
| REFUND_ABUSE | A customer has 2 or more refunds in 30 days totalling at least half of what they paid | 0.75 (0.80 with 3 or more) |
| REFUND_SURGE | 4 or more refunds in 7 days and at least 3 times the expected number | 0.40 |
| FAILED_STREAK | 3 or more failed payments from one customer within 30 minutes | 0.65 |
| CONCENTRATION_SHIFT | One customer is 50% or more of 30-day revenue, up from under 25% in the prior 30 days (needs 10 or more payments) | 0.50 |

## Scoring

Signals combine with noisy-or: `score = 1 - product(1 - weight)`. An alert is raised at 0.35 or higher. Severity: 0.85 or more is high, 0.60 or more is medium, otherwise low. Every signal carries a plain-language reason and the IDs of the transactions behind it.

## Known limits

- "Tiny" is relative to the shop's low end. In an extreme cheap-goods shop (typical payment about $3.60) test charges look like normal sales, so card testing is caught only 4 of 10 times and slow card testing 2 of 10. An attacker more than about 12x slower than the 3-hour window is missed by the rules (the learned model catches it).

- Rules were designed for small merchants with steady traffic. Seasonal shops need longer baselines.
- Needs at least 15 payments of history for amount-based rules.
- Refund customer matching depends on the original capture being stored.
- Wasp Lab results are on synthetic data and say nothing certain about real-world performance.
- Thresholds are first guesses and are not yet tuned on held-out data.
