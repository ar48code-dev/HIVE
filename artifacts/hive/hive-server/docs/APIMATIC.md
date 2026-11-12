# Using APIMatic (sponsor prize)

HIVE does not claim APIMatic usage and should not be listed for the APIMatic sponsor prize yet.

## What was checked

- The official PayPal Context Plugin page lists the install command `npx context-plugins install paypal` and says it supports Claude Code, Cursor, and VS Code.
- The installer advertises Codex as another target, but a test install in a clean temporary directory reported that Codex is not installed. Replit Agent is not detected as a supported target.
- The official hackathon page says the APIMatic plugin needs no extra credential or APIMatic sign-in. No APIMatic credential is needed to install it in a supported coding environment.
- HIVE's PayPal client remains its own Sandbox HTTP client. The retry-safety fix in the Shop was made without installing or invoking the plugin.
- Replit's available integrations do not include APIMatic.

Reviewing APIMatic's public documentation and trying its installer in this unsupported environment do **not** establish that the Context Plugin was used to build HIVE. Do not say that HIVE used APIMatic in Devpost or the demo video.

## Remaining action

Open this project in Claude Code, Cursor, or VS Code Copilot and run the official install command there. Have the plugin review or improve HIVE's PayPal implementation, then record the actual interaction and resulting code change below. Keep screenshot/video evidence for the submission. Do not add APIMatic as a runtime dependency just to display its name; it is a development tool.

## Plugin-use log
| Date | File | What the plugin checked or corrected | Result |
|---|---|---|---|
| _No actual plugin session yet_ | — | — | — |

## Where to mention it
- README, section "Hackathon criteria map" and the tools list.
- Devpost "Built with" and the tools description.
- One sentence in the video, with the screen showing the plugin in use.

## Honesty note
The plugin is a development tool. HIVE does not call APIMatic at runtime; only claim plugin use after a real plugin session and evidence exist.
