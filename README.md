# Job Search Desk

A local job-search assistant for **Naukri** and **LinkedIn**. It connects to your own
signed-in Chrome session, scans configured searches, scores new postings against your
profile, and keeps a separate job library for each portal. The dashboard is available
only on this PC at `http://127.0.0.1:4173`.

The tool does not silently submit applications. Application flows are guided and ask
for your input and confirmation. External-apply jobs must be completed on the employer's
website.

## First-time setup (Windows)

Use PowerShell in the project folder for the commands below.

1. **Install dependencies**

   ```powershell
   npm install
   ```

2. **Create your local environment file**

   ```powershell
   Copy-Item .env.example .env
   ```

   Open `.env` and set:

   - `DASHBOARD_USERNAME` to a username you choose.
   - `DASHBOARD_PASSWORD` to a unique password at least **16 characters** long.
   - `GEMINI_API_KEY` to your Gemini API key. A Gemini key is required for job scoring
     and AI-proposed screening answers. Other provider keys are optional.

   Keep `.env` private; it contains credentials. If `.env` already exists, edit it
   instead of copying over it.

3. **Create your candidate profile**

   ```powershell
   Copy-Item profile.example.json profile.json
   ```

   Edit `profile.json` with your actual experience, skills, preferred roles, and
   constraints. This information is sent to the configured AI provider to score jobs.
   Do not include anything you do not want used for that purpose.

4. **Create application facts**

   ```powershell
   Copy-Item facts.example.json facts.json
   ```

   Fill `facts.json` with accurate answers to common application questions, such as
   experience, notice period, location, and compensation. Leave unknown values empty.
   The apply assistant uses these facts to propose answers; review every answer.

5. **Start Chrome with remote debugging**

   Close Chrome, then run this in PowerShell (adjust the Chrome path if it is installed
   elsewhere):

   ```powershell
   & "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="$env:USERPROFILE\jobdesk-chrome"
   ```

   In this Chrome window, sign in to Naukri and LinkedIn. The dedicated profile keeps
   this session separate from your normal Chrome profile and persists between runs.
   Leave Chrome running while using the dashboard.

6. **Start the dashboard**

   In a second PowerShell window, from the project folder:

   ```powershell
   npm run ui
   ```

   Open [http://127.0.0.1:4173](http://127.0.0.1:4173) in your browser and sign in with
   the dashboard credentials from `.env`. Keep this terminal open while using the app;
   press **Ctrl+C** in it to stop the dashboard.

## Using the dashboard

1. Choose **Naukri** or **LinkedIn** from the portal selector.
2. Select **Find new jobs** / **Start scan**. The app visits the searches in
   `src/config.js`, reads job details, scores new jobs, and saves them to that portal's
   library. The first scan may take a while.
3. Open **Review shortlist** or the **Job library** to inspect scores, reasons, missing
   skills, status, and apply type. Adjust the minimum-score filter as needed.
4. Review **External applications** for roles that redirect to an employer's website.
   These jobs are still kept in the library; open their link and complete the application
   on the employer site yourself.
5. Select **Apply to jobs** to start the guided apply queue. Review each job and answer.
   LinkedIn Easy Apply asks you to approve answers and confirm before final submission.
   Failed LinkedIn attempts remain in the queue so you can retry them after fixing a
   transient issue. Jobs identified as external are recorded as external instead of
   being treated as Easy Apply. If a form cannot be handled safely, complete it manually
   in the browser.

The task activity panel shows progress and presents prompts that need your response.
Do not treat a score as a guarantee of suitability; verify the job and all application
details yourself before submitting.

## Searches and scoring

Edit `searches` in `src/config.js` to set the keywords, location, and experience level
used for both portals. That file also controls the scan limits and shortlist threshold:

- `maxJobsPerSearch`: result cards inspected per search.
- `maxNewJobsPerRun`: maximum new jobs opened and scored in a scan.
- `linkedinPagesPerSearch`: LinkedIn result pages inspected for each search.
- `shortlistScore`: score at or above which a job is marked shortlisted.

Keep scan volume modest. Job sites can change their pages and may restrict automated
access. If a scan reports zero cards, check that Chrome is signed in, look for a
verification/captcha page, and then check the portal selectors in `src/config.js`
(Naukri) or `src/linkedin.js` (LinkedIn).

## Job history and duplicate protection

- Naukri records: `data/jobs.json`
- LinkedIn records: `data/linkedin-jobs.json`

These files are created and updated as jobs are processed; each job is saved as it is
scored. Known job IDs are skipped on later scans, and application status is stored with
the job record. **Do not delete these files if you want to retain your history or avoid
revisiting jobs.** Back them up if the records matter to you. `data/`, `.env`,
`profile.json`, and `facts.json` are ignored by Git because they can contain personal
information.

## Optional command-line use

The dashboard is the recommended way to use the app. From PowerShell, the same main
operations can also be run from the terminal:

```powershell
npm run scan -- --portal naukri
npm run scan -- --portal linkedin

npm run list -- --portal naukri 70
npm run list -- --portal linkedin 70

npm run external -- --portal naukri
npm run external -- --portal linkedin

npm run apply -- --portal naukri
npm run apply -- --portal linkedin
```

The `--portal` value is `naukri` or `linkedin`. Scanning and applying require the
debugging Chrome session. Apply commands also require `facts.json` and guide you through
the flow in the terminal.

## Local-only access and privacy

The dashboard binds to `127.0.0.1`; it is not accessible from your phone or another
computer. Remote hosting is intentionally disabled. Do not expose the dashboard through
port forwarding or a public tunnel: it controls your signed-in browser session.

Your local job records and profile stay on this PC. Job/profile content used for scoring
and screening-answer suggestions is sent to the AI provider configured by your API key.
Check that provider's terms and privacy policy before use. The dashboard password is
local sign-in protection, not a substitute for securing your Windows account and files.

## Troubleshooting

- **Dashboard refuses to start:** check that `.env` has a username and a unique password
  of at least 16 characters, and that port `4173` is not already in use.
- **Chrome connection fails:** make sure Chrome was started with
  `--remote-debugging-port=9222`, the debugging Chrome window is still open, and the
  app and Chrome are running on this same PC.
- **Sign-in to a job site is missing:** sign in to that site in the dedicated Chrome
  window, then retry the scan.
- **No jobs are found:** confirm the right portal is selected and the results page is
  loaded; check for a captcha or changed selectors.
- **Scoring fails:** confirm `GEMINI_API_KEY` is set in `.env` and the key is enabled
  for the Gemini API.
- **Application answers are incomplete:** update `facts.json` with accurate facts.
  The assistant should ask you rather than invent an answer when the facts do not cover
  a question.
