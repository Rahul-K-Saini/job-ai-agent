import "dotenv/config";
import fs from "node:fs";
import { config } from "./config.js";
import { connect, pause } from "./browser.js";
import { scrapeSearch, scrapeDetails } from "./naukri.js";
import { scoreJob } from "./scorer.js";
import * as store from "./store.js";

function loadProfile() {
  const file = fs.existsSync(config.profileFile) ? config.profileFile : "profile.example.json";
  if (file !== config.profileFile) {
    console.warn(`No ${config.profileFile} found; using profile.example.json. Copy and edit it first.\n`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

async function scan() {
  if (!process.env.GEMINI_API_KEYS) throw new Error("Set GEMINI_API_KEY in .env");
  const profile = loadProfile();
  const db = store.load();
  const { browser, context } = await connect();
  const listPage = await context.newPage();
  let processed = 0;

  try {
    for (const search of config.searches) {
      console.log(`\nSearching: ${search.keywords} in ${search.location}`);
      const cards = await scrapeSearch(listPage, search, config.maxJobsPerSearch);
      console.log(`  ${cards.length} cards found`);
      if (cards.length === 0) {
        console.log("  Nothing scraped. Check the selectors in src/config.js (SEL) or whether you hit a captcha.");
      }

      for (const job of cards) {
        if (db[job.id]) continue; // already seen
        if (processed >= config.maxNewJobsPerRun) {
          console.log("\nReached maxNewJobsPerRun; stopping.");
          return;
        }
        await pause();
        try {
          const details = await scrapeDetails(context, job);
          const full = { ...job, ...details };
          const result = await scoreJob(full, profile);
          db[job.id] = {
            ...full,
            ...result,
            status: result.score >= config.shortlistScore ? "shortlisted" : "rejected",
            seenAt: new Date().toISOString(),
          };
          store.save(db); // save after every job so a crash loses nothing
          processed++;
          console.log(`  [${String(result.score).padStart(3)}] ${job.title} @ ${job.company}`);
        } catch (err) {
          console.warn(`  Failed: ${job.title} (${err.message})`);
        }
      }
    }
  } finally {
    await listPage.close().catch(() => {});
    await browser.close(); // disconnects from Chrome; it does not close your browser
  }
}

function list() {
  const min = Number(process.argv[3] ?? config.shortlistScore);
  const rows = Object.values(store.load())
    .filter((j) => j.score >= min)
    .sort((a, b) => b.score - a.score);
  if (rows.length === 0) return console.log("No jobs at or above that score yet. Run: npm run scan");
  for (const j of rows) {
    console.log(`\n[${j.score}] ${j.title} @ ${j.company}  (${j.location}, ${j.experience})`);
    console.log(`  ${j.reason}`);
    if (j.missing_skills?.length) console.log(`  Missing: ${j.missing_skills.join(", ")}`);
    console.log(`  Apply type: ${j.applyText || "unknown"}`);
    console.log(`  ${j.url}`);
  }
}

const cmd = process.argv[2];
if (cmd === "scan") await scan();
else if (cmd === "list") list();
else console.log("Usage:\n  npm run scan        scrape + score new jobs\n  npm run list [min]  show shortlisted jobs (default min score from config)");
