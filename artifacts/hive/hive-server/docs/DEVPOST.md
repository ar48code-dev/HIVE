# Devpost text and video script (draft)

Replace every `[TO CONFIRM]` after the live run. Do not submit claims that are not yet true.

## Tagline
The colony that investigates your money and shows its evidence.

## Inspiration
Small online sellers get paid through PayPal but cannot afford a fraud team. Card testing, refund abuse and duplicate charges show up as lines in a list, and dashboards that only draw charts do not tell you what to check first. We wanted an assistant that investigates, explains itself with the exact transactions behind every conclusion, and never moves money without a human decision.

## What it does
HIVE watches PayPal events for a merchant and:
- **Wasp Radar** flags suspicious patterns with transparent rules: card testing, duplicate payments, unusually large first orders, repeated refunds, failed-payment streaks, refund surges and revenue concentration. Every alert lists the reasons, the transactions behind it, and a suggested next step.
- **Queen AI** answers questions and investigates alerts. Each claim must cite real transactions, and dollar figures must come from the data. Drafts that fail the checks are retried, then replaced with rule-based text. Forecasts are refused rather than guessed.
- **Investigate then act:** HIVE drafts a refund or an evidence packet. Nothing happens until you approve and confirm, and every step is in an audit log.
- **Wasp Lab** plays realistic attacks against HIVE and publishes a scorecard that includes the misses. Its stress tests found a real gap (a slow card-testing attacker slipped past the rules), which we then fixed.
- **Optional learned second opinion:** a small separate model flags what no rule did, shown as hints only. We measured that it does not generalise on its own, so it never raises alerts.
- **An animated hive** turns the story into the interface: payments are bees, alerts are wasps, the Queen's shield holds them off, and a launched attack plays out as a full-screen defence that mirrors the real result. A Calm mode turns it all off.
- **Hive, Customers, Analytics (AG Grid), Calendar and Colony** show revenue, who pays, searchable transactions, estimated recurring payments (labelled as estimates), and a honeycomb that grows as you review.

## How we built it
Node and TypeScript API, a HIVE-specific PostgreSQL database, and a React/Vite dashboard. PayPal Sandbox OAuth is verified, but a Sandbox buyer has not completed checkout/capture and webhook delivery remains unverified. The Shop uses a fixed four-item catalogue and retry-stable order IDs. Detection is deterministic; Queen uses Gemini through Vertex AI when configured and checks answers against evidence. Wasp Lab uses synthetic attack scenarios and does not measure real-world fraud rates. HIVE alerts use a send-only Gmail connection; its test message was accepted but landed in Spam. AG Grid, AG Charts, AG Studio, and Bryntum Calendar are used in the dashboard. Do not claim end-to-end PayPal, APIMatic use, inbox delivery, or a published deployment until each is actually verified.

## Challenges
- Making the AI trustworthy: we validate every answer against the fact sheet instead of trusting the model.
- Transaction text is attacker-controlled, so notes reach the model only as quoted, flagged data. The demo plants an instruction in a buyer note to show this.
- Keeping alerts useful: related alerts merge into one incident, and we measured false alarms instead of hiding them.
- PayPal will not let you backdate payments, so live attack testing only covers attacks that unfold within minutes.

## Accomplishments we are proud of
- A scorecard that reports misses and false alarms on synthetic scenarios, without presenting those results as real-world fraud performance.
- 174 server tests pass; frontend and server TypeScript checks pass; the production frontend build succeeds.
- The same detection code runs on demo data, simulated attacks and real webhooks.

## What we learned
Trust comes from showing the evidence and refusing to guess, not from a confident tone.

## What's next
Real forecasting, more rules tuned on held-out data, a live Wasp Lab for slower attacks, and PayPal dispute filing from the evidence packet.

## How HIVE differs from existing tools
AI finance dashboards with natural-language questions and anomaly detection already exist, and some connect to PayPal. HIVE's difference is evidence-checked answers, a built-in attack simulator with a published scorecard, human-approved actions, and treating transaction text as untrusted input.

## Built with
PayPal Sandbox API (OAuth verified; buyer flow not verified), Gemini through Google Cloud Vertex AI, AG Grid, AG Charts, AG Studio, Bryntum Calendar trial, Gmail send-only alert delivery, PostgreSQL, Node.js, TypeScript, React, Vite, Vitest.

## Built during the Submission Period
The repository was started on 1 Nov 2026 and everything in it was written during the Submission Period.

## Demo video script (target 2:50)
| Time | On screen | Say |
|---|---|---|
| 0:00 to 0:15 | Hub with the current mode/status label visible | "HIVE is a PayPal-focused fraud investigation workspace. I’ll identify which activity is synthetic and which is PayPal Sandbox." |
| 0:15 to 0:40 | Wasp Lab: open the scorecard and launch card testing | "Wasp Lab sends a known attack through the same detection engine. The scorecard includes misses; the animation follows the actual detector result." |
| 0:40 to 1:10 | Open the resulting Wasp Radar alert and evidence list | "The alert explains which rules fired and links the exact synthetic transactions behind the finding." |
| 1:10 to 1:40 | Queen AI: ask about the alert and inspect evidence chips | "Queen answers from a prepared fact sheet. HIVE checks that claims and amounts are supported by transaction evidence." |
| 1:40 to 2:00 | Show the suspicious buyer note in the transaction details | "The note contains an instruction aimed at the AI. HIVE treats transaction text as untrusted data." |
| 2:00 to 2:25 | Show the proposed action, confirmation step, then audit log | "Actions are proposals, not automatic payments. In this synthetic preview, approval is recorded as simulated and no money moves." |
| 2:25 to 2:45 | Shop tab; show Sandbox checkout only after buyer capture and webhook have been verified | "HIVE’s Shop uses PayPal Sandbox. Until a buyer-approved capture and signed webhook are confirmed, I do not claim the payment flow as end-to-end verified." |
| 2:45 to 2:55 | Return to Hub, show the colony and evidence summary | "HIVE: the colony that investigates your money and shows its evidence." |

Recording notes: keep the synthetic-data label visible, use English audio or captions, do not use unlicensed music, and keep the strongest moment inside the first minute.
