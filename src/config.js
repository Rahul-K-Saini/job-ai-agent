// Everything you are likely to tweak lives here.
export const config = {
  model: "gemini-3.8-flash", // use the current Flash model name shown in Google AI Studio
  cdpUrl: "http://localhost:9222",

  // Each entry becomes a Naukri and LinkedIn search.
  searches: [
    { keywords: "backend spring boot", location:"delhi ncr", experience: 2},
    { keywords: "fullstack spring boot", location:"delhi ncr", experience: 2},
    { keywords: "java spring boot", location:"delhi ncr", experience: 2},
    { keywords: "software engineer", location:"delhi ncr", experience: 2},
    { keywords: "full stack developer react node java springboot", location:"delhi ncr", experience: 2}
  ],

  maxJobsPerSearch: 10, // cards read per search
  maxNewJobsPerRun: 25, // hard cap on detail pages opened + Gemini calls per run
  linkedinPagesPerSearch: 2, // LinkedIn result pages to inspect per search
  shortlistScore: 70,   // jobs scoring at or above this are shortlisted
  delayMs: [3000, 7000], // random pause between page loads (be gentle with the site)
  dataFile: "data/jobs.json",
  linkedinDataFile: "data/linkedin-jobs.json",
  profileFile: "profile.json",
};

// Naukri changes its markup often. When scraping returns nothing, fix selectors HERE only.
// Use `npx playwright codegen https://www.naukri.com` or Chrome DevTools to find current ones.
export const SEL = {
  card: ".srp-jobtuple-wrapper, .jobTuple",
  title: "a.title",
  company: "a.comp-name, .comp-name",
  experience: ".exp-wrap, .expwdth",
  location: ".loc-wrap, .locWdth",
  salary: ".sal-wrap",
  description: "[class*='dang-inner-html'], .job-desc",
  applyBtn: "button[id*='apply'], [class*='apply-button']",
};
