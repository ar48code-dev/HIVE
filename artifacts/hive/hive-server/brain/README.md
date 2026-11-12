# HIVE brain

The learned parts of HIVE. **The risk model now runs natively inside HIVE** (a TypeScript port, `src/brain/risk.ts`), so the "Second opinion" works on any host with no Python service. This folder is where it is **trained**, and where the optional text classifiers live.

| Part | Where it runs | What it does |
|---|---|---|
| **Risk second opinion** | Inside HIVE (TypeScript port of the trained weights) | A 20-weight logistic regression scores every transaction. It never raises alerts. The dashboard shows only what it flags that no rule did, labelled as hints. |
| Question router | Optional Python service | Maps paraphrased questions to Queen's intents when the keyword router is unsure. |
| Note screening | Optional Python service | Flags instruction-style text in buyer notes and masks personal details. |

Everything is deterministic numpy code trained on synthetic data. No large model, no GPU.

## Run and train

```bash
cd artifacts/hive/hive-server/brain
pip install -r requirements.txt     # numpy only
python3 -m colony.server            # optional text-classifier service on 127.0.0.1:8787
python3 -m unittest tests.test_colony
python3 -m colony.hive_train         # retrain the risk model
```

From the workspace root, the deterministic stress simulation is `pnpm --filter @workspace/hive run stress`.

The Python service binds to loopback by default. A non-loopback address **requires** `BRAIN_TOKEN` (it refuses to start without one). `GET /health` is public; everything else needs the token. Bodies are capped at 64 KB, internal errors are logged and never returned, and one bad request never disables the service.

## The native port is checked against Python

`tests/risk-native.test.ts` scores 254 real transactions with the Python model and with the TypeScript port: same probabilities (to the 3 decimals Python rounds to), the same flag decision on every row, and the same leading explanation. Regenerate the fixture after retraining with `npx tsx scripts/parity-fixture.ts`.

## What the evidence does and does not show

**1. In-distribution (the headline).** On held-out seeds of the same generator the model catches all seven attacks 20/20 with 11.1 false alarms per 1,000 (the rules: 10.2). This only shows it learned the attack shapes it was trained on.

**2. Different generator (the honest test).** Scored on streams from a *different* generator (`colony/sim.py`, never trained on):

| Attack | Caught |
|---|---|
| Card testing, failed streak, large first order | 20/20 each |
| Duplicate payment | 10/20 |
| Refund abuse | 9/20 |
| Concentration shift | 7/20 |
| False alarms per 1,000 benign | 33.9 |

So the model generalises partly, not fully. (An earlier model trained the other way round caught card testing 0/20.) That is why it is a second opinion that never raises alerts. This check is built into `hive_train.py` and prints every time the model is retrained.

**3. Stress test: change the shop or the attacker** (`pnpm --filter @workspace/hive run stress`, 10 runs per attack, rules and model on identical streams, no Python needed):

| Situation | Rules: false alarms /1,000 | Model: false alarms /1,000 | Misses |
|---|---|---|---|
| Same as training | 8.5 | 6.7 | none |
| Cheap-goods shop (prices x0.25) | 8.5 | 6.7 | none |
| Luxury shop (prices x6) | 8.5 | 6.7 | none |
| Slow attacker (6x slower) | 8.5 | 6.7 | none |
| Cheap shop AND slow attacker | 8.5 | 6.7 | none |
| *Outside training range:* extreme cheap shop (x0.08) | 8.5 | **299** (model switched off, see below) | rules: card testing 4/10, slow card testing 2/10 |
| *Outside training range:* extreme luxury shop (x14) | 8.5 | 6.7 (model switched off) | none |
| *Outside training range:* very slow attacker (12x slower) | 8.5 | 6.7 | rules: slow card testing 0/10 (slower than the rules' 3-hour window); model 10/10 |

**Applicability guard.** The model was trained for shops whose typical payment is roughly $7 to $450. Outside that it can fail badly (299 false alarms on a shop with a $3.60 typical payment), so it **switches itself off and says so** instead of giving confident wrong answers. The rules keep running.

## What changed because of this testing
- The original model was scale sensitive (30.9 false alarms on a luxury shop). Training now replays each stream at random prices from 0.15x to 10x and attacks at 0.5x to 5x tempo.
- **The rules missed a slow card-testing attacker entirely**, then a first fix let an older campaign blind them (it dragged the "tiny payment" cut-off down to the attacker's own amounts). The rule now judges "tiny" against the shop's 20th-percentile payment and excludes the window being judged from the baseline, with tests for both failures.
- The model never raises alerts, and it is shown only when it applies to the shop.

## Remaining limits
All training data is synthetic and the attack families are ones we wrote; real merchants differ. Where a shop's normal purchases are as small as an attacker's test charges, no amount-based method can separate them. Treat the model as a hint generator.

## Not included
The earlier "agent payment firewall" experiment (a policy language for AI agents that spend money, with a tiny JAX language model and pickled weights) is not part of this repo. It addresses a different product, the space is crowded, and it would blur HIVE's story. `firewall.py` (a small regex policy parser and mandate checker) remains because the Python service exposes policy endpoints, but nothing in the dashboard uses it.
