# RelayBoard — Real-world feedback and usability improvements

## Feedback record

- **Source:** Aditya, via WhatsApp (screenshot supplied by the project owner).
- **Date:** 11 October 2026.
- **Feedback, transcribed:** "Bro I think you should make it more easy to use and enhance the ui"
- **Themes:** Easier to use; improve the UI.
- **Evidence:** The original screenshot is held by the project owner. It shows the feedback in a private WhatsApp conversation. Obtain the sender's permission before publishing the screenshot publicly, and redact their name, profile photo, phone number, and unrelated messages if needed.

## Improvement selected

Make the report submission flow easier to understand and use, particularly on mobile, while improving visual hierarchy and touch-friendly controls.

## Changes prepared

- Added a short introduction explaining what to include in a report.
- Marked required fields and added browser-level validation.
- Added plain-language hints for the title, location, optional category, and description.
- Replaced developer-style length errors with clearer guidance.
- Improved spacing, borders, focus states, button sizing, and responsive layout.
- Made the submission confirmation easier to scan and gave the next steps clear links.
- Kept the existing report submission and clustering flow.

The code changes are in draft pull request [#1](https://github.com/amithsharma91/relayboard-campus-fix/pull/1). They are not merged yet.

## Verification status

- **Automated tests:** Not run through the GitHub editing workflow.
- **TypeScript check:** Not run through the GitHub editing workflow.
- **Production build:** Not run through the GitHub editing workflow.
- **Manual mobile check:** Pending.

Before merging, run `npm run typecheck` and `npm run build` in the project environment, then test submitting a report on both desktop and a phone.

## Evidence note

This is genuine feedback supplied by the project owner as a screenshot of a real conversation. The transcript above is a summary/transcription of the visible message, not a fabricated review. Keep the original screenshot as challenge evidence and share it publicly only with appropriate permission and privacy redactions.
