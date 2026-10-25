import "dotenv/config";
import fs from "node:fs";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { applyConfig, APPLY_SEL } from "./apply-config.js";
import { connect, pause } from "./browser.js";
import { answerQuestion } from "./answers.js";
import * as store from "./store.js";

const DRY_RUN = process.argv.includes("--dry-run");
const AUTO_ANSWERS = applyConfig.autoAcceptAnswers || process.argv.includes("--auto-answers");

const rl = readline.createInterface({ input: stdin, output: stdout });
const ask = (q) => rl.question(q);

// ---------- helpers ----------
async function looksApplied(page) {
  const success = await page.getByText(APPLY_SEL.successText).count().catch(() => 0);
  const appliedBtn = await page.getByRole("button", { name: /^applied$/i }).count().catch(() => 0);
  return success > 0 || appliedBtn > 0;
}

async function lastBotMessage(page) {
  const loc = page.locator(APPLY_SEL.botMessage);
  if (!(await loc.count())) return "";
  return (await loc.last().innerText().catch(() => "")).trim();
}

async function readOptions(page) {
  const texts = await page.locator(APPLY_SEL.chatOption).allInnerTexts().catch(() => []);
  return [...new Set(texts.map((t) => t.trim()).filter(Boolean))];
}

async function humanTakeover(page, why) {
  console.log(`\n  ${why}. Please finish this application yourself in the browser window.`);
  await page.bringToFront().catch(() => {});
  const r = (await ask("  When done press Enter (or type 'f' if you gave up / it failed): ")).trim().toLowerCase();
  if (r === "f") return "failed";
  return (await looksApplied(page)) ? "applied" : "unconfirmed";
}

async function confirmAnswer(question, options, p) {
  console.log(`\n  Q: ${question}`);
  if (options.length) console.log(`     Options: ${options.join(" | ")}`);
  const unsure = p.needs_human || !p.answer;
  console.log(unsure ? `     Gemini is not sure: ${p.reason}` : `     Proposed: ${p.answer}`);

  if (AUTO_ANSWERS && !unsure) return p.answer;

  const input = (await ask("     Enter = accept | type your own answer | m = finish manually: ")).trim();
  if (input.toLowerCase() === "m") return null;
  if (input === "") {
    if (unsure) {
      console.log("     No proposed answer. Type one, or 'm'.");
      return confirmAnswer(question, options, p);
    }
    return p.answer;
  }
  return input;
}

async function submitAnswer(page, answer, options) {
  const send = page.locator(APPLY_SEL.chatSend).first();
  const clickSend = async () => {
    if ((await send.count()) && (await send.isVisible().catch(() => false))) {
      await send.click().catch(() => {});
    }
  };

  if (options.length) {
    const a = answer.toLowerCase();
    const match = options.find((o) => o.toLowerCase() === a) ?? options.find((o) => o.toLowerCase().includes(a));
    if (match) {
      await page.locator(APPLY_SEL.chatOption).filter({ hasText: match }).first().click();
      await clickSend();
      return true;
    }
  }

  const input = page.locator(APPLY_SEL.chatInput).first();
  if (!(await input.count())) return false;
  await input.click();
  await input.fill(answer);
  if ((await send.count()) && (await send.isVisible().catch(() => false))) await send.click();
  else await page.keyboard.press("Enter");
  return true;
}

// ---------- questionnaire loop ----------
async function handleQuestions(page, job, facts, answers) {
  let lastQuestion = "";
  for (let round = 0; round < 15; round++) {
    await page.waitForTimeout(2500);

    if (await looksApplied(page)) return "applied";

    const drawerOpen = (await page.locator(APPLY_SEL.botMessage).count()) > 0;
    if (!drawerOpen) {
      // No questionnaire visible and no success message.
      return "unconfirmed";
    }

    const question = await lastBotMessage(page);
    if (!question || question === lastQuestion) {
      return humanTakeover(page, "Could not read a new question");
    }
    lastQuestion = question;

    const options = await readOptions(page);
    const proposal = await answerQuestion({ question, options }, facts, job);
    const final = await confirmAnswer(question, options, proposal);
    if (final === null) return humanTakeover(page, "You chose to finish manually");

    const ok = await submitAnswer(page, final, options).catch(() => false);
    if (!ok) return humanTakeover(page, "Could not enter the answer automatically");
    answers.push({ question, answer: final });
  }
  return humanTakeover(page, "Too many questions in a row");
}

// ---------- one job ----------
async function applyToJob(context, job, facts) {
  const page = await context.newPage();
  const answers = [];
  try {
    await page.goto(job.url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);

    if (await looksApplied(page)) return { status: "already_applied", answers };

    let applyBtn = page.getByRole("button", { name: /^apply$/i }).first();
    if (!(await applyBtn.count())) applyBtn = page.locator(APPLY_SEL.applyFallback).first();

    if (!(await applyBtn.count())) {
      if (await page.getByText(/apply on company site/i).count()) return { status: "external", answers };
      return { status: "failed", answers, note: "No Apply button found" };
    }

    if (DRY_RUN) {
      console.log("  [dry run] Apply button found; not clicking.");
      return { status: "dry_run", answers };
    }

    await applyBtn.click();
    const status = await handleQuestions(page, job, facts, answers);
    return { status, answers };
  } catch (err) {
    return { status: "failed", answers, note: err.message };
  } finally {
    await page.close().catch(() => {});
  }
}

// ---------- main ----------
async function main() {
  if (!process.env.GEMINI_API_KEYS) throw new Error("Set GEMINI_API_KEY in .env");
  if (!fs.existsSync(applyConfig.factsFile)) {
    throw new Error(`Missing ${applyConfig.factsFile}. Copy facts.example.json to facts.json and fill it in.`);
  }
  const facts = JSON.parse(fs.readFileSync(applyConfig.factsFile, "utf8"));
  const db = store.load();

  const queue = Object.values(db)
    .filter((j) => j.status === "shortlisted" && j.score >= applyConfig.minScore)
    .sort((a, b) => b.score - a.score);

  if (queue.length === 0) {
    console.log("No shortlisted jobs. Run: npm run scan");
    rl.close();
    return;
  }
  console.log(`${queue.length} shortlisted job(s).${DRY_RUN ? " DRY RUN: nothing will be clicked." : ""}\n`);

  const { browser, context } = await connect();
  let applied = 0;
  const tally = {};

  try {
    for (const job of queue) {
      if (applied >= applyConfig.maxAppliesPerRun) {
        console.log("\nReached maxAppliesPerRun; stopping.");
        break;
      }
      console.log(`\n[${job.score}] ${job.title} @ ${job.company} (${job.location}, ${job.experience})`);
      console.log(`  ${job.reason}`);
      if (job.missing_skills?.length) console.log(`  Missing: ${job.missing_skills.join(", ")}`);
      console.log(`  ${job.url}`);

      const choice = DRY_RUN
        ? "y"
        : (await ask("  Apply? [y]es / [n]o, skip for good / [s]kip for now / [q]uit: ")).trim().toLowerCase();
      if (choice === "q") break;
      if (choice === "n") {
        db[job.id].status = "skipped";
        store.save(db);
        continue;
      }
      if (choice !== "y") continue;

      await pause();
      const outcome = await applyToJob(context, job, facts);
      tally[outcome.status] = (tally[outcome.status] ?? 0) + 1;
      console.log(`  -> ${outcome.status}${outcome.note ? ` (${outcome.note})` : ""}`);
      if (outcome.status === "unconfirmed") {
        console.log("     Could not confirm success. Check Naukri > Applied jobs to be sure.");
      }
      if (outcome.status === "external") console.log("     Applies on the company site; open the link yourself.");

      if (outcome.status !== "dry_run") {
        db[job.id].status = outcome.status;
        db[job.id].answers = outcome.answers;
        db[job.id].appliedAt = new Date().toISOString();
        store.save(db);
      }
      if (outcome.status === "applied") applied++;
    }
  } finally {
    await browser.close(); // disconnects only; your browser stays open
    rl.close();
  }
  console.log("\nSummary:", tally);
}

await main();
