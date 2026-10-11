# RelayBoard — Real-world feedback and usability improvements

## Feedback record

- **Source:** Aditya, via WhatsApp (screenshot supplied by the project owner).
- **Date:** 11 October 2026.
- **Feedback, transcribed:** "Bro I think you should make it more easy to use and enhance the ui"
- **Themes:** Easier to use; improve the UI.
- **Evidence:** The original screenshot is held by the project owner. It shows the feedback in a private WhatsApp conversation. Obtain the sender's permission before publishing the screenshot publicly, and redact their name, profile photo, phone number, and unrelated messages if needed.

## Improvement delivered

The report submission flow was updated to be easier to understand and use, particularly on mobile, while improving visual hierarchy and touch-friendly controls.

- Added a short introduction explaining what to include in a report.
- Marked required fields and added browser-level validation.
- Added plain-language hints for the title, location, optional category, and description.
- Replaced developer-style length errors with clearer guidance.
- Improved spacing, borders, focus states, button sizing, and responsive layout.
- Made the submission confirmation easier to scan and gave the next steps clear links.
- Kept the existing report submission and clustering flow.

The changes were merged to `master` in commit `ea287aa55a2df5ac535f135c9bd6ddf5701cb4e9` via pull request [#1](https://github.com/amithsharma91/relayboard-campus-fix/pull/1).

## Verification results

The project owner reports that these checks were run locally on branch `feedback/usability-ui` after fetching the branch and running `npm ci`. These results are transcribed from the local verification report; they were not executed by GitHub during this documentation update.

- `npm run typecheck`: passed, exit code 0.
- `npm run build`: passed, exit code 0; 18/18 static pages generated.
- Existing test suites: all 7 passed — seed verification (`a21ee8d7`), 90/90, 68/68, 21/21, 76/76, 49/49, and 124/124 assertions.
- `git diff --check`: passed.
- Desktop browser check (Firefox 157, 1280px): required-field validation, successful submission, persistence, report/incident links, and near-duplicate workflow checked; zero console/page errors reported.
- Mobile browser check (Firefox 157, 360px): successful submission, no horizontal overflow, and logical keyboard tab order reported.
- Screenshots were saved locally under `/tmp/relayboard-demo-evidence/pr1-*.png`; they are not included in this repository by this documentation update.

## Remaining actions

- Before relying on a public deployment, review the previously identified Vercel alias/security concern and check current Next.js security advisories against the installed dependency lockfile.
- Confirm whether merging to `master` triggered an automatic Vercel deployment; do not share a public URL until the deployment and access controls are verified.
- If sharing the WhatsApp screenshot publicly, obtain permission and redact private or unrelated information.
- Add the actual feedback screenshot to challenge evidence only after reviewing privacy and permission.
