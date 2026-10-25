import { SEL } from "./config.js";

const slug = (s) => s.toLowerCase().trim().replace(/\s+/g, "-");

export function searchUrl({ keywords, location, experience }) {
  const base = `https://www.naukri.com/${slug(keywords)}-jobs-in-${slug(location)}`;
  const p = new URLSearchParams({ k: keywords, l: location });
  if (experience != null) p.set("experience", String(experience));
  return `${base}?${p}`;
}

// Read the job cards from a search results page.
export async function scrapeSearch(page, search, limit) {
  await page.goto(searchUrl(search), { waitUntil: "domcontentloaded" });
  await page.waitForSelector(SEL.card, { timeout: 15_000 }).catch(() => {});

  const jobs = await page.$$eval(
    SEL.card,
    (cards, sel) =>
      cards.map((c) => {
        const text = (s) => c.querySelector(s)?.textContent?.trim() ?? "";
        const a = c.querySelector(sel.title);
        return {
          title: a?.textContent?.trim() ?? "",
          url: a?.href ?? "",
          company: text(sel.company),
          experience: text(sel.experience),
          location: text(sel.location),
          salary: text(sel.salary),
        };
      }),
    SEL
  );

  return jobs
    .filter((j) => j.url && j.title)
    .map((j) => ({ ...j, id: j.url.split("?")[0] }))
    .slice(0, limit);
}

// Open one job in a new tab and read the full description + apply button text.
export async function scrapeDetails(context, job) {
  const page = await context.newPage();
  try {
    await page.goto(job.url, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(SEL.description, { timeout: 15_000 });
    const description = await page.$eval(SEL.description, (el) => el.innerText.trim());
    const applyText = await page
      .$$eval(SEL.applyBtn, (els) => els.map((e) => e.innerText.trim()).filter(Boolean).join(" | "))
      .catch(() => "");
    return { description, applyText };
  } finally {
    await page.close();
  }
}
