import fs from "node:fs";
import { config } from "../src/config.js";

const args = process.argv.slice(2);
const portalIndex = args.indexOf("--portal");
const portal = portalIndex === -1 ? "naukri" : args[portalIndex + 1];
if (!["naukri", "linkedin"].includes(portal)) {
  throw new Error(`Unknown portal "${portal}". Choose "naukri" or "linkedin".`);
}

const dataFile = portal === "linkedin" ? config.linkedinDataFile : config.dataFile;
let db;
try {
  db = JSON.parse(fs.readFileSync(dataFile, "utf8"));
} catch (error) {
  if (error.code === "ENOENT") {
    console.log(`No ${portal} job data found yet. Run: npm run scan -- --portal ${portal}`);
    process.exit(0);
  }
  throw error;
}
const jobs = Object.values(db)
  .filter((job) =>
    Number(job.score) > 70 &&
    (job.status === "external" || /apply\s+on\s+company\s+site/i.test(job.applyText ?? ""))
  )
  .sort((a, b) => Number(b.score) - Number(a.score));

if (jobs.length === 0) {
  console.log(`No ${portal} external jobs with a score greater than 70.`);
} else {
  console.log(`${jobs.length} ${portal} external job(s) with a score greater than 70:\n`);
  for (const job of jobs) {
    console.log(`[${job.score}] ${job.title} @ ${job.company} (${job.location || "location unknown"})`);
    if (job.status) console.log(`  Status: ${job.status}`);
    console.log(`  ${job.url}\n`);
  }
}
