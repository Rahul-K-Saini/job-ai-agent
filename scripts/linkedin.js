import "dotenv/config";
import fs from "node:fs";
import { config } from "../src/config.js";
import { connect, pause } from "../src/browser.js";
import { scrapeDetails, scrapeSearch } from "../src/linkedin.js";
import { scoreJob } from "../src/scorer.js";
import * as store from "../src/store.js";

function loadProfile() {
  const file = fs.existsSync(config.profileFile) ? config.profileFile : "profile.example.json";
  if (file !== config.profileFile) {
    console.warn(`No ${config.profileFile} found; using profile.example.json. Copy and edit it first.\n`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

async function scan() {
  if (!process.env.GEMINI_API_KEYS && !process.env.GEMINI_API_KEY) {
    throw new Error("Set GEMINI_API_KEY or GEMINI_API_KEYS in .env");
  }
  const profile = loadProfile();
  const db = store.load(config.linkedinDataFile);
  const { browser, context } = await connect();
  const listPage = await context.newPage();
  let processed = 0;

  try {
    for (const search of config.searches) {
      console.log(`\nSearching LinkedIn: ${search.keywords} in ${search.location}`);
      for (let pageIndex = 0; pageIndex < config.linkedinPagesPerSearch; pageIndex++) {
        const cards = await scrapeSearch(listPage, search, config.maxJobsPerSearch, pageIndex);
        console.log(`  Page ${pageIndex + 1}: ${cards.length} cards found`);
        if (cards.length === 0) {
          if (pageIndex === 0) {
            console.log("  No jobs found. Check the LinkedIn login session or selectors in src/linkedin.js.");
          }
          break;
        }

        for (const job of cards) {
          if (db[job.id]) continue;
          if (processed >= config.maxNewJobsPerRun) {
            console.log("\nReached maxNewJobsPerRun; stopping.");
            return;
          }

          await pause();
          try {
            const details = await scrapeDetails(context, job);
            const full = {
              ...job,
              ...details,
              applyText: job.applyText || details.applyText,
              source: "linkedin",
            };
            const result = await scoreJob(full, profile);
            db[job.id] = {
              ...full,
              ...result,
              status: result.score >= config.shortlistScore ? "shortlisted" : "rejected",
              seenAt: new Date().toISOString(),
            };
            store.save(db, config.linkedinDataFile);
            processed++;
            console.log(`  [${String(result.score).padStart(3)}] ${full.title} @ ${full.company}`);
          } catch (err) {
            console.warn(`  Failed: ${job.title} (${err.message})`);
          }
        }
        if (pageIndex + 1 < config.linkedinPagesPerSearch) await pause();
      }
    }
  } finally {
    await listPage.close().catch(() => {});
    await browser.close();
  }
}

function list() {
  const min = Number(process.argv[3] ?? config.shortlistScore);
  const db = store.load(config.linkedinDataFile);
  const rows = Object.values(db)
    .filter((job) => Number(job.score) >= min)
    .sort((a, b) => Number(b.score) - Number(a.score));

  if (rows.length === 0) {
    console.log(`No LinkedIn jobs at or above ${min}. Run: npm run linkedin -- scan`);
    return;
  }
  for (const job of rows) {
    console.log(`\n[${job.score}] ${job.title} @ ${job.company} (${job.location || "location unknown"})`);
    console.log(`  ${job.reason}`);
    if (job.missing_skills?.length) console.log(`  Missing: ${job.missing_skills.join(", ")}`);
    if (job.applyText) console.log(`  Apply type: ${job.applyText}`);
    console.log(`  ${job.url}`);
  }
}

const command = process.argv[2];
if (command === "scan") await scan();
else if (command === "list") list();
else console.log("Usage:\n  npm run linkedin -- scan\n  npm run linkedin -- list [min-score]");
