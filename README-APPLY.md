# Phase 2: apply flow

Copy the files into your existing project (nothing is overwritten):

- `src/apply.js`, `src/answers.js`, `src/apply-config.js`  ->  your `src/`
- `facts.example.json`  ->  project root, then `cp facts.example.json facts.json` and fill it in

Add this line to `scripts` in your `package.json`:

    "apply": "node src/apply.js"

Add `facts.json` to `.gitignore` (it holds salary and notice period).

## Run

    npm run apply -- --portal naukri --dry-run
    npm run apply -- --portal naukri
    npm run apply -- --portal naukri --auto-answers
    npm run apply -- --portal linkedin
    npm run apply -- --portal linkedin --dry-run

## What happens

1. Takes shortlisted jobs (score >= minScore) from the selected portal's data file, best first.
2. Shows the job and asks y / n / s / q.
3. Opens the page and clicks Apply (Naukri may submit instantly if there are no questions).
4. If a questionnaire appears, reads each question, asks Gemini using ONLY facts.json,
   and shows the proposed answer. Enter accepts, typing overrides, `m` lets you finish by hand.
5. Saves status (applied / unconfirmed / external / already_applied / failed / skipped)
   and every answer given to the selected portal's data file.

If a selector breaks or a question is unclear, the agent stops and hands the browser to you.

## LinkedIn Easy Apply

LinkedIn applications use the separate `data/linkedin-jobs.json` queue and the same
`facts.json`. Run `npm run apply -- --portal linkedin`; it offers shortlisted LinkedIn
jobs one at a time, asks before each job, only fills answers you approve, and asks again
before the final submit. External applications and unsupported form steps are left for
you to complete in the browser. Jobs identified as external are marked as external
without starting an Easy Apply flow. Failed jobs remain eligible for a manual retry on
the next run. Review every answer and the application before confirming submission.
