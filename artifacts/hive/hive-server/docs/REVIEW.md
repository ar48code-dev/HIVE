# Review of "hive-with-brain" and "agent-payment-firewall", and what was done about it

This is a historical engineering review; the test totals and browser runs noted below are from the time of the review, not the current suite. See the root README and `docs/GO_LIVE.md` for current verification status.

## Verdict
The HIVE app from the other chat is good and mostly an improvement. The learned "brain" was real but its headline results were circular, the policy firewall is off-theme for the submission, and there were real bugs and one security gap. All of those are addressed below, with the limits stated honestly.

## Good changes in the other chat's version (kept)
- Webhook payer lookup fails loudly instead of silently turning every payer into a stranger.
- A refund arriving before its payment is handled.
- Question router and per-question facts in Queen; recorded answers are re-validated against current data.
- Admin token with timing-safe compare, proxy-aware rate limits, brain calls that fail soft.
- AG Studio dashboard (trial mode without a licence key).

## Findings and final status
| # | Finding | Status |
|---|---|---|
| 1 | With no `ADMIN_TOKEN`, every write route (including refund approval) was open even when connected to a database | **Fixed.** The server refuses to start against a database without a token. 5 tests, each failing for the right reason. |
| 2 | One invalid policy made the brain return a 500, and HIVE switched the whole brain off for 30 s | **Fixed** on both sides. Tested. |
| 3 | Brain server leaked raw errors, had no body limit, used a hard-coded `change-me` signing key | **Fixed.** Tested. |
| 4 | "20/20" was measured on the training generator. On a different generator the model catches 7 to 10 of 20 for duplicates, refund abuse and concentration | **Cannot be fixed without real fraud data.** Now measured on every retrain (built into `hive_train.py`), documented, and the model is a second opinion that never raises alerts. |
| 5 | The model was scale sensitive (30.9 false alarms on a luxury shop) | **Fixed** for the tested range (flat 6.7 on every shop size). **Outside its range it fails badly (299 false alarms on a $3.60 shop), so it now switches itself off** via an applicability guard. |
| 6 | The rules missed a slow card-testing attacker entirely | **Fixed.** A longer-window rule plus a Wasp Lab scenario (20 of 20). |
| 7 | **Found while fixing #6:** a first version let the attacker's own tiny charges lower the "tiny" cut-off and blind the rule; a second version could be blinded by an earlier campaign of just 5% of payments | **Fixed.** The cut-off uses the shop's 20th-percentile payment and excludes the window being judged. Regression tests for both. The second one was only found by running the real demo flow. |
| 8 | The second opinion was invisible unless a Python service was hosted | **Fixed.** The model now runs natively inside HIVE, checked against Python on real data (same probabilities, flags and explanations). |
| 9 | Brain endpoint rescored all history on every request | **Fixed:** rate-limited and cached 30 s. |
| 10 | No `requirements.txt` | **Fixed** (numpy only). |
| 11 | Two of my own tests were wrong (a harness failing for the wrong reason; an ambiguous selector) | **Fixed.** I also learned to check exit codes, not only grep output. |
| 12 | **New, animation:** honeycomb cells continuously scaled, so every click target was always moving | **Fixed.** The shimmer changes brightness only. |
| 13 | **New, animation:** switching to Calm did not stop a sequence already playing | **Fixed.** Tested in the browser. |

## Recommendation on the "agent payment firewall"
**Leave it out of the HIVE submission.** It guards agents that *buy* things, while HIVE protects merchants who *get paid*. Different product, crowded space, plus JAX, pickled weights and an unfinished retraining step. It is not included in this repo.

## Still open
- **Current external-service status:** PayPal Sandbox OAuth and Gemini through Vertex AI have been tested in the workspace. A buyer-approved PayPal capture and signed webhook delivery remain unverified. Gmail accepted a test email, which landed in Spam. See `docs/GO_LIVE.md`.
- **Rule limits:** in an extreme cheap-goods shop (typical payment about $3.60) the rules catch card testing 4 of 10 and slow card testing 2 of 10, because test charges look like normal sales; an attacker 12x slower than the rule's 3-hour window is missed by the rules (the model catches it). Documented, not patched, because a blunt fix would raise false alarms.
- **The Python brain** (router and note screening) is optional and not hosted. The risk second opinion no longer needs it.
- **AG Studio** runs in trial mode until you request a licence key from AG Grid; its bundle is about 6 MB, loaded only when opened. Its totals cover all data while the Hive tab shows 30 days.
- `/api/queen/ask` is open in public mode and only rate-limited. If you host publicly with a Gemini key, watch your usage.
- The landing page was checked in desktop and mobile browser previews. Physical-device and low-end-device performance are not certified.
