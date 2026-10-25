const JOB_CARD = '[data-testid="lazy-column"] [role="button"][componentkey^="job-card-component-ref-"]';

export function searchUrl({ keywords, location }) {
  const params = new URLSearchParams({ keywords, location });
  return `https://www.linkedin.com/jobs/search/?${params}`;
}

function jobFromCard(card) {
  const lines = card.innerText.split(/\n/).map((line) => line.trim()).filter(Boolean);
  const componentKey = card.getAttribute("componentkey") ?? "";
  const id = componentKey.match(/^job-card-component-ref-(\d+)$/)?.[1];
  if (!id || lines.length < 3) return null;

  let titleIndex = 0;
  if (/^selected,/i.test(lines[0])) titleIndex = 1;
  const title = lines[titleIndex]?.replace(/\s*\(Verified job\)\s*$/i, "").trim();
  if (!title) return null;

  let companyIndex = titleIndex + 1;
  while (companyIndex < lines.length && lines[companyIndex].replace(/\s*\(Verified job\)\s*$/i, "").trim() === title) {
    companyIndex++;
  }
  const company = lines[companyIndex] ?? "";
  const location = lines[companyIndex + 1] ?? "";
  const applyText = lines.find((line) => /easy apply|apply/i.test(line)) ?? "";

  return {
    id,
    title,
    company,
    location,
    experience: "",
    applyText,
    url: `https://www.linkedin.com/jobs/view/${id}/`,
  };
}

export async function scrapeSearch(page, search, limit, pageIndex = 0) {
  await page.goto(searchUrl(search), { waitUntil: "domcontentloaded" });
  if (pageIndex > 0) {
    const pageButton = page.locator(`[data-testid="pagination-indicator-${pageIndex}"]`);
    if (await pageButton.count()) {
      await pageButton.click();
      await page.waitForTimeout(1500);
    } else {
      throw new Error(`LinkedIn search page ${pageIndex + 1} is not available`);
    }
  }
  await page.waitForSelector(JOB_CARD, { timeout: 20_000 }).catch(() => {});

  const jobs = await page.$$eval(JOB_CARD, (cards) =>
    cards.map((card) => {
      const componentKey = card.getAttribute("componentkey") ?? "";
      const lines = card.innerText.split(/\n/).map((line) => line.trim()).filter(Boolean);
      const id = componentKey.match(/^job-card-component-ref-(\d+)$/)?.[1];
      if (!id || lines.length < 3) return null;

      const titleIndex = /^selected,/i.test(lines[0]) ? 1 : 0;
      const title = lines[titleIndex]?.replace(/\s*\(Verified job\)\s*$/i, "").trim();
      if (!title) return null;

      let companyIndex = titleIndex + 1;
      while (
        companyIndex < lines.length &&
        lines[companyIndex].replace(/\s*\(Verified job\)\s*$/i, "").trim() === title
      ) {
        companyIndex++;
      }

      return {
        id,
        title,
        company: lines[companyIndex] ?? "",
        location: lines[companyIndex + 1] ?? "",
        experience: "",
        applyText: lines.find((line) => /easy apply|apply/i.test(line)) ?? "",
        url: `https://www.linkedin.com/jobs/view/${id}/`,
      };
    })
  );

  return jobs
    .filter((job) => job?.url && job.title)
    .slice(0, limit);
}

export async function scrapeDetails(context, job) {
  const page = await context.newPage();
  try {
    await page.goto(job.url, { waitUntil: "domcontentloaded" });
    await page
      .locator("main h2")
      .filter({ hasText: "About the job" })
      .first()
      .waitFor({ state: "attached", timeout: 15_000 });
    const details = await page.evaluate(() => {
      let description = document.querySelector(
        ".jobs-description__content, .jobs-description-content__text, .show-more-less-html__markup"
      );
      if (!description) {
        const heading = [...document.querySelectorAll("main h2")].find(
          (element) => element.textContent?.trim().toLowerCase() === "about the job"
        );
        description = heading?.parentElement?.parentElement ?? null;
      }
      const applyText = [...document.querySelectorAll("button, a")]
        .map((element) => element.textContent?.trim() ?? "")
        .filter((value) => /easy apply|apply/i.test(value))
        .join(" | ");

      return {
        description: description?.innerText?.trim() ?? "",
        experience: [...document.querySelectorAll(".job-details-jobs-unified-top-card__job-insight")]
          .map((element) => element.textContent?.trim() ?? "")
          .filter(Boolean)
          .join(" | "),
        applyText,
      };
    });
    if (!details.description) {
      throw new Error("Could not read the LinkedIn job description; LinkedIn may have changed its page markup.");
    }
    return details;
  } finally {
    await page.close();
  }
}
