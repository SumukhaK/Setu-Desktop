# Setu Desktop

Three clickable design directions for the Setu desktop companion on Windows, macOS, and Linux. The developer can pair or select a phone, attach ADB or an IDE, keep the tunnel running in the background, and review or share evidence from a session.

## Open the prototype

Open `index.html` in a browser. Choose **Relay**, **Signal**, or **Field** in the top bar. **Demo scenarios** loads example accounts and connections so you can compare the same tasks in each design. The prototype uses fictional data and runs locally without a build step.

| Direction | Layout | Preview |
| --- | --- | --- |
| Relay | Light, cobalt-accented workspace with sidebar navigation and a prominent device session. | [Screenshot](docs/previews/relay.png) |
| Signal | Dark, mint-accented console with the transport, local ADB endpoint, and event timeline in view. | [Screenshot](docs/previews/signal.png) |
| Field | Warm, plum-accented desk with more room for session context and tester evidence. | [Screenshot](docs/previews/field.png) |

## Review the critical paths

1. Start with email onboarding or open a Solo workspace. Pair a new device, inspect the difference between tunnel readiness and ADB attachment, and open its IDE handoff instructions.
2. Use the tray preview to keep debugging in the background. Restore the session, try a connection recovery, and then disconnect.
3. Review a screenshot or recording and add context before sharing. Open the managed workspace and inspect its Solo lock, allowed and denied access, audit history, and report export.

The [journey map](docs/JOURNEYS.md) describes recovery paths, research references, and the proposed integration boundaries. Authentication, ADB, the operating system tray, and corporate access use simulated states in this design round.
