# RelayBoard — Feedback and usability improvements

## Feedback record

- **Source:** Project owner's own usability review, based on the current demo screens.
- **Type:** Self-review, not independent user feedback.
- **Feedback summary:** "Make it easier to use and improve the UI."
- **Date recorded:** 11 October 2026.
- **Independent tester feedback:** Pending. This record does not represent a separate student or an external tester.

## Improvement selected

Make the report submission form easier to understand and use, especially on a phone.

## Changes made

- Added a short introduction explaining what to include in a report.
- Marked required fields and added browser-level validation.
- Added plain-language hints for the title, location, optional category, and description.
- Replaced developer-style length errors with clearer guidance.
- Improved spacing, borders, focus states, button sizing, and responsive layout.
- Made the submission confirmation easier to scan and gave the next steps clear links.
- Kept the existing report submission and clustering flow.

## Verification status

- **Automated tests:** Not run from this GitHub editing workflow.
- **TypeScript check:** Not run from this GitHub editing workflow.
- **Production build:** Not run from this GitHub editing workflow.
- **Manual mobile check:** Pending.

Before treating this change as verified, run `npm run typecheck` and `npm run build` in the project environment, then test submitting a report on both desktop and a phone.

## Evidence still needed for the challenge

The requested UI improvement is based on the project owner's self-review. To document independent real-world feedback, invite an actual student or other tester to use the demo, save their genuine response with permission, and add privacy-safe evidence here. Do not represent self-review or test data as feedback from an independent user.
