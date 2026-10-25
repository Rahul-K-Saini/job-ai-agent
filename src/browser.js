import { chromium } from "playwright-core";
import { config } from "./config.js";

// Attach to YOUR running Chrome (started with --remote-debugging-port=9222),
// so Naukri sees your normal logged-in session instead of a fresh automated browser.
export async function connect() {
  try {
    const browser = await chromium.connectOverCDP(config.cdpUrl);
    const context = browser.contexts()[0];
    return { browser, context };
  } catch (err) {
    console.error(
      `\nCould not connect to Chrome at ${config.cdpUrl}.\n` +
        `Start Chrome first (see README), then run again.\n`
    );
    throw err;
  }
}

const rand = (min, max) => min + Math.random() * (max - min);
export const pause = () =>
  new Promise((r) => setTimeout(r, rand(...config.delayMs)));
