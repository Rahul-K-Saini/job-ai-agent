import "dotenv/config";
import fs from "node:fs";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { applyConfig } from "../src/apply-config.js";
import { connect, pause } from "../src/browser.js";
import { answerQuestion } from "../src/answers.js";
import { config } from "../src/config.js";
import * as store from "../src/store.js";

const DRY_RUN = process.argv.includes("--dry-run");
const rl = readline.createInterface({ input: stdin, output: stdout });
const ask = (question) => rl.question(question);

function applicationConfirmed(page) {
  return page
    .getByText(/application (has been )?(successfully )?(sent|submitted)|you applied/i)
    .count()
    .then((count) => count > 0)
    .catch(() => false);
}

async function handOver(page, reason) {
  console.log(`\n  ${reason}. Complete the application yourself in the browser if needed.`);
  await page.bringToFront().catch(() => {});
  const response = (await ask("  When done press Enter (or type 'f' if you gave up): ")).trim().toLowerCase();
  if (response === "f") return "failed";
  return (await applicationConfirmed(page)) ? "applied" : "unconfirmed";
}

function formRoot(page) {
  return page.locator('[role="dialog"], form').first();
}

async function visibleQuestions(page) {
  const root = formRoot(page);
  if (!(await root.count())) return [];
  return root.evaluate((form) => {
    const controls = [...form.querySelectorAll(
      'input[type="text"], input[type="email"], input[type="tel"], input[type="url"], input[type="number"], input:not([type]), textarea'
    )].filter((element) => {
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && !element.disabled;
    });
    return controls.map((element, index) => {
      const label = element.labels?.[0]?.innerText?.trim()
        || element.getAttribute("aria-label")
        || element.getAttribute("placeholder")
        || element.closest("[data-test-text-entity-list-form-component]")?.innerText?.trim()
        || element.parentElement?.innerText?.trim()
        || "";
      return {
        index,
        label: label.replace(/\s+/g, " ").trim(),
        type: element instanceof HTMLTextAreaElement ? "textarea" : element.type || "text",
        value: element.value,
        required: element.required || element.getAttribute("aria-required") === "true",
      };
    });
  });
}

async function fillQuestions(page, job, facts, answers) {
  const root = formRoot(page);
  if (!(await root.count())) return false;

  const unsupported = root.locator('select, input[type="checkbox"], input[type="radio"], input[type="file"]');
  for (let index = 0; index < await unsupported.count(); index++) {
    if (await unsupported.nth(index).isVisible().catch(() => false)) return false;
  }

  const questions = await visibleQuestions(page);
  const controls = root.locator(
    'input[type="text"], input[type="email"], input[type="tel"], input[type="url"], input[type="number"], input:not([type]), textarea'
  );

  for (const field of questions) {
    if (field.value) continue;
    if (!field.label) return false;
    const proposal = await answerQuestion({ question: field.label, options: [] }, facts, job);
    console.log(`\n  Field: ${field.label}`);
    console.log(proposal.needs_human || !proposal.answer
      ? `  No fact-based answer available: ${proposal.reason}`
      : `  Suggested: ${proposal.answer}`);
    const response = (await ask("  Enter = use suggestion | type a correction | m = finish manually: ")).trim();
    if (response.toLowerCase() === "m" || (response === "" && (proposal.needs_human || !proposal.answer))) {
      return false;
    }
    const value = response || proposal.answer;
    await controls.nth(field.index).fill(value);
    answers.push({ question: field.label, answer: value });
  }
  return true;
}

async function runEasyApply(page, job, facts, answers) {
  const root = formRoot(page);
  for (let step = 0; step < 8; step++) {
    if (await applicationConfirmed(page)) return "applied";
    if (!(await fillQuestions(page, job, facts, answers))) {
      return handOver(page, "This form contains a field I cannot safely fill from facts.json");
    }

    const submit = root.getByRole("button", { name: /^(submit application|submit)$/i }).last();
    if (await submit.count()) {
      const confirmation = (await ask("\n  Review the form in the browser. Submit this application now? [y/N]: ")).trim().toLowerCase();
      if (confirmation !== "y" && confirmation !== "yes") return "unconfirmed";
      await submit.click();
      await page.waitForTimeout(2500);
      return (await applicationConfirmed(page))
        ? "applied"
        : handOver(page, "The form was submitted, but LinkedIn did not show a confirmation message");
    }

    const next = root.getByRole("button", { name: /^(next|review|continue)$/i }).last();
    if (!(await next.count())) {
      return handOver(page, "The LinkedIn form has an unsupported step or no recognized next action");
    }
    await next.click();
    await page.waitForTimeout(1000);
  }
  return handOver(page, "The LinkedIn application has more steps than the assistant supports");
}

async function applyToJob(context, job, facts) {
  const page = await context.newPage();
  const answers = [];
  try {
    await page.goto(job.url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    if (await applicationConfirmed(page)) return { status: "already_applied", answers };

    const easyApply = page.getByRole("button", { name: /easy apply/i }).first();
    if (!(await easyApply.count())) {
      const apply = page.getByRole("button", { name: /\bapply\b/i }).first();
      if (await apply.count()) return { status: "external", answers, note: "This job uses an external application flow" };
      return {
        status: "failed",
        answers,
        note: `No apply button found on the loaded page (${page.url()}). Check that LinkedIn is signed in and the job is still available.`,
      };
    }

    if (DRY_RUN) return { status: "dry_run", answers };

    await easyApply.click();
    await page.waitForTimeout(1500);
    const status = await runEasyApply(page, job, facts, answers);
    return { status, answers };
  } catch (error) {
    return { status: "failed", answers, note: error.message };
  } finally {
    await page.close().catch(() => {});
  }
}

async function main() {
  if (!process.env.GEMINI_API_KEYS && !process.env.GEMINI_API_KEY) {
    throw new Error("Set GEMINI_API_KEY or GEMINI_API_KEYS in .env");
  }
  if (!fs.existsSync(applyConfig.factsFile)) {
    throw new Error(`Missing ${applyConfig.factsFile}. Copy facts.example.json to facts.json and fill it in.`);
  }
  const facts = JSON.parse(fs.readFileSync(applyConfig.factsFile, "utf8"));
  const db = store.load(config.linkedinDataFile);
  const queue = Object.values(db)
    .filter(
      (job) =>
        ["shortlisted", "failed"].includes(job.status) &&
        Number(job.score) >= applyConfig.minScore
    )
    .sort((a, b) => Number(b.score) - Number(a.score));

  if (queue.length === 0) {
    console.log("No shortlisted LinkedIn jobs. Run: npm run linkedin -- scan");
    return;
  }
  console.log(
    `${queue.length} LinkedIn job(s) in the application queue.${DRY_RUN ? " DRY RUN: no apply actions will be taken." : ""}\n`
  );
  if (DRY_RUN) {
    for (const job of queue) {
      console.log(`[${job.score}] ${job.title} @ ${job.company} — ${job.url}`);
    }
    return;
  }

  const { browser, context } = await connect();
  let applied = 0;
  const tally = {};
  try {
    for (const job of queue) {
      if (applied >= applyConfig.maxAppliesPerRun) {
        console.log("\nReached maxAppliesPerRun; stopping.");
        break;
      }
      console.log(`\n[${job.score}] ${job.title} @ ${job.company} (${job.location || "location unknown"})`);
      console.log(`  ${job.reason}`);
      console.log(`  ${job.url}`);

      if (/^(apply|apply on company site)$/i.test(job.applyText?.trim() ?? "")) {
        db[job.id].status = "external";
        db[job.id].appliedAt = new Date().toISOString();
        store.save(db, config.linkedinDataFile);
        tally.external = (tally.external ?? 0) + 1;
        console.log("  -> external (complete the application on the employer's website)");
        continue;
      }

      const choice = (await ask("  Apply? [y]es / [n]o, skip for good / [s]kip for now / [q]uit: ")).trim().toLowerCase();
      if (choice === "q") break;
      if (choice === "n") {
        db[job.id].status = "skipped";
        store.save(db, config.linkedinDataFile);
        continue;
      }
      if (choice !== "y") continue;

      await pause();
      const outcome = await applyToJob(context, job, facts);
      tally[outcome.status] = (tally[outcome.status] ?? 0) + 1;
      console.log(`  -> ${outcome.status}${outcome.note ? ` (${outcome.note})` : ""}`);
      if (outcome.status !== "dry_run") {
        db[job.id].status = outcome.status;
        db[job.id].answers = outcome.answers;
        db[job.id].appliedAt = new Date().toISOString();
        store.save(db, config.linkedinDataFile);
      }
      if (outcome.status === "applied") applied++;
    }
  } finally {
    await browser.close();
    rl.close();
  }
  console.log("\nSummary:", tally);
}

try {
  await main();
} finally {
  rl.close();
}
