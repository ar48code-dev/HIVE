# HIVE submission checklist

Use this to keep the submission accurate. Complete only the items that apply; do not present an unverified integration as live.

## Project and repository

- [ ] Public source repository and MIT license are visible.
- [ ] Repository history and README accurately describe the project and its development period.
- [ ] No secrets, buyer passwords, access tokens, or private URLs are committed.
- [x] Published artifact configuration remains demo-only; the development preview is persistent and identifies PayPal activity as Sandbox.
- [x] Server unit tests, frontend/server type checks, and production build pass in this workspace.
- [ ] Test the published app from a clean browser.

## PayPal and AI

- [x] PayPal Sandbox credentials are configured through Replit Secrets and Sandbox OAuth accepts them.
- [ ] A Sandbox buyer approves and captures an order.
- [ ] The registered Sandbox webhook verifies and the captured transaction appears in HIVE.
- [ ] Gemini answers one Queen question through Vertex AI; keep its evidence validation visible and confirm billing is attached to the user's GCP project.
- [ ] State clearly that Wasp Lab uses synthetic attack data; do not present its results as real-world fraud rates.
- [ ] Show that demo-mode approvals are simulated and do not move money.

## Sponsor tools

- [x] PayPal Sandbox integration is implemented; its live end-to-end flow is not yet verified.
- [x] Vertex AI Gemini 3.8 Flash connection and a Studio tool-call continuation are verified.
- [x] AG Grid and AG Charts are used in the dashboard.
- [x] AG Studio and Bryntum Calendar are included; note their license/trial status.
- [x] Postman collection is included.
- [ ] APIMatic may be listed only after the Context Plugin has actually been used and recorded in `APIMATIC.md`.
- [x] Gmail send-only alert delivery is configured; Gmail accepted a test message, but the recipient reported Spam placement.
- [x] HIVE alerts do not depend on Zapier's premium Webhooks trigger.

## Demo video

- [ ] Keep the synthetic-data label visible.
- [ ] Show Wasp Lab, an evidence-linked alert, Queen's checked answer, and the simulated-action label.
- [ ] Add a real Sandbox checkout scene only after buyer approval, capture, and webhook delivery are verified.
- [ ] Keep the video under three minutes, with English speech or captions and licensed media only.

## Devpost entry

- [ ] Add an accurate project description and sponsor-tool list.
- [ ] Add screenshots from the final preview.
- [ ] Link the public demo and source repository.
- [ ] Remove every placeholder and every claim that was not verified.
