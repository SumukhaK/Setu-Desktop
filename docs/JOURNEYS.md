# Setu product design plan

## Goal

Help a developer debug an Android device remotely while the person holding the phone can see who is connected, control access, and share what happened. The desktop app is for Windows, macOS, and Linux. The Android app is a native companion. This design round uses browser prototypes with fictional accounts, devices, and sessions.

## User journeys

| Journey | Desktop developer | Android tester or device owner | Recovery |
| --- | --- | --- | --- |
| Create an account or sign in | Choose Create account or Sign in, enter email, verify a one-time email code, then land in the appropriate workspace. | Same email options. Get a phone-ready checklist after sign-in. | Resend after a cooldown; allow editing the address. Preserve the email on an invalid or expired code. Keep email verification separate from device pairing. |
| Choose a workspace | Solo opens personal devices. Corporate opens the assigned organization and its allowed devices. | Solo offers to host and show a code. Corporate shows enrollment and managed policy. | When Solo is disabled by verified organization policy, show it locked with a reason and block attempts to start or resume Solo. Request administrator help for enrollment or missing grants. |
| Prepare the phone | Show what the phone owner needs to finish, plus a copyable support instruction where appropriate. | Check Developer options and Wireless debugging. Explain how to tap Build number seven times, then open Developer options and enable Wireless debugging. Show USB debugging separately for USB workflows. Recheck after returning from Settings. Explain Wi-Fi, Android-version, and managed-device restrictions. | Show an alternate manual path for OEM Settings. Give a specific reason if Android returns a policy restriction. USB debugging is optional for wireless hosting. |
| Pair a device and start debugging | Enter the expiring code shown on the phone or choose an authorized corporate device. Show the connection request, tunnel readiness, a copyable `adb connect` command, and Android Studio instructions. | Start hosting, show the expiring code in Solo, and review the incoming request. Keep an ongoing notification while hosting or connected. Corporate enrollment uses managed configuration and device grants. | Recover from expired codes, declined requests, offline phones, missing local ADB, and Wireless debugging pairing or trust problems. Distinguish tunnel ready from ADB attached. |
| Work in the background | Keep the tunnel running when the workspace closes to the tray. Restore the session from the tray and offer Disconnect there. | Background the app with a foreground service notification and an accessible End session action. Stop hosting separately when the user wants to stop accepting sessions. | Show reconnecting while a network path recovers. Stop on user disconnect, revocation, or policy changes that block the session. Show a retry when auto-reconnect expires. |
| Share evidence | Browse or import screenshots and recordings, preview, annotate with a short outcome, then choose an allowed destination or export. | Capture or import a screenshot or recording, preview it, label what happened, and choose a share destination. Ask for Android capture consent each time screen capture starts. Keep Stop recording visible. | Save reviewable drafts locally if a share fails. Handle declined capture permission, blocked destinations, and Android-protected content. Keep media out of the audit record. |
| End a session and review it | Disconnect and view session history. In an authorized corporate workspace, view audit events and export reports. Forget a paired device separately from disconnecting. | End the active session promptly. Show who connected, the end reason, and elapsed time. Let the phone owner pause hosting or clear remembered access. | Show ended-state reasons such as user stopped, device unavailable, access revoked, and administrator policy. Remove active credentials on sign-out. |
| Manage account and policy | Profile, email, workspace, relay health, local ADB detection, tray preference, history, and sign out. | Profile, current workspace, device name, debugging readiness, service notifications, trusted access, and sign out. | Explain what is controlled by an administrator. Keep managed and personal history and evidence separate. |

## Tenant rules and product boundaries

- Email sign-in identifies a person. Corporate access also requires independently verified organization membership, device enrollment, and a per-device grant. Email domain alone grants no access.
- In a managed deployment, disable Solo at the account or enrolled device policy boundary. Enforce this in the desktop session service, Android host and managed configuration, and organization gateway. A disabled control only communicates the decision. A managed device with missing or invalid policy cannot start an ungoverned host as a fallback.
- The phone is explicit about hosting, requested access, and active debugging. A per-session approval experience needs product-layer coordination beyond Setu’s existing solo pairing and remembered identity. Background desktop work needs the local daemon and tray integration. Android hosting needs a foreground service.
- Setu supplies the encrypted tunnel, device identity, local ADB endpoint, reconnecting behavior, corporate grants and revocation, and audit/report facilities. Account provisioning, evidence storage/sharing, user-facing session consent, and app distribution require application integration.
- Separate device-side Wireless debugging from Solo pairing and from ADB authorization if the phone’s system debugger requests it. Treat audit reports and shared evidence as distinct. When the underlying ADB stream uses device TLS, Setu can provide session-level audit details while operation-level details can be unavailable.

## Design directions

| Direction | Desktop | Android |
| --- | --- | --- |
| **Relay** · light / cobalt | Sidebar workspace with an active session card, remembered devices, and actionable setup. | Familiar bottom navigation, clear checklists, and a single prominent next step. |
| **Signal** · dark / mint | Compact connection console with an endpoint, timeline, and network state in view. | Status-first device panel with the current session, transport state, and stop action close together. |
| **Field** · warm / plum | Tester handoff desk that gives session context, evidence, and follow-up work more space. | Guided one-task-at-a-time flow from setup to hosting to evidence review. |

The same screen inventory and policy states apply across all six designs. Prototype controls allow reviewers to switch directions and replay key scenarios without a phone or relay. Use visible status labels, keyboard focus, readable contrast, reduced motion, and on Android a 48 dp touch-target design baseline.

## Production sequence after design selection

1. Agree on scope and identity/tenant policy. Build desktop/Android onboarding, email verification, and managed enrollment first.
2. Integrate the Setu daemon and Android SDK, and prove a two-device connection, a managed grant, backgrounding, and disconnect before extending the experience.
3. Add evidence capture, preview and sharing, session history, report export, and organization permissions. Run tests on Windows, macOS, Linux, and physical Android devices, including OEM Settings differences and managed restrictions.

## Research sources

- [Mobbin mobile flows](https://mobbin.com/explore/mobile/flows) and [email sign-in](https://help.mobbin.com/en/articles/691072). Used for sequential onboarding, permission handoffs, and verification that offers both a clear action and a recovery path.
- [Dribbble desktop app gallery](https://dribbble.com/tags/desktop-app) and [Kevin Dukkon’s workspace onboarding](https://dribbble.com/shots/24191425-Onboarding-Workspace). Used for workspace hierarchy and focused setup screens.
- [RonDesignLab mobile UI board](https://www.pinterest.com/rondesignlab/mobile-app-ui-design/) and the [studio’s mobile portfolio](https://dribbble.com/RonDesignLab/). Finance and care app examples informed focused status cards, clear action hierarchy, and the warmer guided mobile direction.
- [Android developer options](https://developer.android.com/studio/debug/dev-options) and [Android MediaProjection](https://developer.android.com/media/grow/media-projection). Used for platform-specific Settings and screen capture steps.
- [Setu API specification](https://github.com/SumukhaK/Setu/blob/main/API_SPEC.md) and [architecture and modes](https://github.com/SumukhaK/Setu/blob/main/README.md#architecture). Used to define the boundary between the connectivity SDK and the proposed product.
