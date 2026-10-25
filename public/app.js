const portalSelect = document.querySelector("#portal-select");
const jobsBody = document.querySelector("#jobs-body");
const taskLog = document.querySelector("#task-log");
const promptPanel = document.querySelector("#prompt-panel");
const promptInput = document.querySelector("#prompt-input");
const promptSubmit = document.querySelector("#prompt-submit");
const promptChoices = document.querySelector("#prompt-choices");
let selectedMode = "all";
let currentTaskId = null;
let currentPromptId = null;
let lastLogText = "";
let showingAll = false;
let polling = false;

function currentPortal() {
  return portalSelect.value;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function safeJobUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && ["www.naukri.com", "naukri.com", "www.linkedin.com", "linkedin.com"].includes(url.hostname)) {
      return url.href;
    }
  } catch {}
  return "#";
}

function renderJobs(jobs, stats) {
  const rows = showingAll ? jobs : jobs.slice(0, 6);
  document.querySelector("#stat-total").textContent = stats.total;
  document.querySelector("#stat-shortlisted").textContent = stats.shortlisted;
  document.querySelector("#stat-applied").textContent = stats.applied;
  document.querySelector("#stat-external").textContent = stats.external;
  document.querySelector("#jobs-count").textContent = `${jobs.length} job${jobs.length === 1 ? "" : "s"}`;
  document.querySelector("#show-all").classList.toggle("hidden", jobs.length <= 6);
  document.querySelector("#show-all").textContent = showingAll ? "Show fewer ↑" : "See all jobs →";

  if (!rows.length) {
    const text = selectedMode === "external"
      ? "No matching external jobs. These appear after a scan or when an external application is recorded."
      : "No jobs found at this score. Start a scan to build your shortlist.";
    jobsBody.innerHTML = `<tr><td colspan="5" class="empty-cell">${escapeHtml(text)}</td></tr>`;
    return;
  }

  jobsBody.innerHTML = rows.map((job) => {
    const status = job.status || "saved";
    const jobUrl = safeJobUrl(job.url);
    const applyType = /easy apply/i.test(job.applyText ?? "")
      ? "Easy Apply"
      : /apply|external/i.test(job.applyText ?? "")
        ? "External"
        : "Unknown";
    return `<tr>
      <td><div class="job-name">${escapeHtml(job.title)}</div><div class="job-company">${escapeHtml(job.company)} · ${escapeHtml(job.location)}</div></td>
      <td><span class="score-badge">${escapeHtml(job.score ?? "—")}</span></td>
      <td><span class="status-badge ${escapeHtml(status.toLowerCase())}">${escapeHtml(status.replaceAll("_", " "))}</span></td>
      <td>${escapeHtml(applyType)}</td>
      <td><a class="job-link" href="${escapeHtml(jobUrl)}" target="_blank" rel="noreferrer">Open ↗</a></td>
    </tr>`;
  }).join("");
}

async function loadJobs() {
  const minScore = selectedMode === "external" ? 71 : Number(document.querySelector("#score-filter").value || 0);
  const params = new URLSearchParams({ portal: currentPortal(), minScore: String(minScore), mode: selectedMode });
  const response = await fetch(`/api/jobs?${params}`);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Could not load jobs.");
  renderJobs(result.jobs, result.stats);
}

async function loadSettings() {
  const response = await fetch("/api/settings");
  if (response.status === 401) {
    window.location.assign("/");
    return;
  }
  const settings = await response.json();
  document.querySelector("#setup-status").textContent = settings.hasFacts
    ? `Application facts found · Chrome: ${settings.chromeUrl} · Apply threshold: ${settings.applyMinScore}+ · Maximum ${settings.maxAppliesPerRun} successful applications per run.`
    : `Add facts.json before applying · Chrome: ${settings.chromeUrl} · AI provider keys are read from .env.`;
}

function setView(view) {
  selectedMode = view === "shortlist" || view === "external" ? view : "all";
  showingAll = view === "all";
  const activeNavigation = ["all", "shortlist", "external"].includes(view) ? "jobs" : "dashboard";
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === activeNavigation);
  });
  document.querySelector("#breadcrumb").textContent = view === "all" ? "Overview" : view === "external" ? "External jobs" : "Job library";
  document.querySelector("#library-title").textContent = view === "external" ? "External applications" : view === "shortlist" ? "Shortlisted jobs" : "Recent jobs";
  document.querySelector("#library-eyebrow").textContent = view === "external" ? "COMPANY WEBSITE ROLES" : view === "shortlist" ? "READY TO REVIEW" : "YOUR PIPELINE";
  if (view === "shortlist") {
    document.querySelector("#score-filter").value = 70;
  }
  loadJobs().catch(showError);
  document.querySelector("#library-section").scrollIntoView({ behavior: "smooth", block: "start" });
}

function showError(error) {
  taskLog.textContent = `Error: ${error.message}`;
  document.querySelector("#task-state").textContent = "Something needs attention";
  document.querySelector("#task-dot").className = "failed";
}

async function startTask(command) {
  const response = await fetch("/api/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ portal: currentPortal(), command }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Could not start task.");
  currentTaskId = result.task.id;
  promptPanel.classList.add("hidden");
  document.querySelector("#task-state").textContent = command === "scan" ? "Scanning jobs…" : "Starting apply queue…";
  document.querySelector("#task-dot").className = "running";
  document.querySelector("#stop-task").classList.remove("hidden");
  taskLog.textContent = "";
  lastLogText = "";
  await pollTask();
  document.querySelector(".activity-section").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function buildChoices(prompt) {
  promptChoices.replaceChildren();
  const text = prompt.toLowerCase();
  let choices = [];
  if (text.includes("[y]es") && text.includes("[n]o")) {
    choices = [["Yes", "y"], ["Skip permanently", "n"], ["Skip for now", "s"], ["Quit", "q"]];
  } else if (text.includes("submit this application")) {
    choices = [["Confirm submit", "y"], ["Do not submit", "n"]];
  } else if (text.includes("enter = accept") || text.includes("enter = use suggestion")) {
    choices = [["Accept suggestion", ""], ["Finish manually", "m"]];
  } else if (text.includes("gave up")) {
    choices = [["I’m done", ""], ["Mark failed", "f"]];
  }
  for (const [label, value] of choices) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "choice-button";
    button.textContent = label;
    button.addEventListener("click", () => respondToPrompt(value));
    promptChoices.append(button);
  }
}

async function respondToPrompt(value = promptInput.value) {
  if (currentPromptId === null) return;
  promptSubmit.disabled = true;
  for (const button of promptChoices.querySelectorAll("button")) button.disabled = true;
  try {
    const response = await fetch("/api/respond", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ promptId: currentPromptId, value }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not send response.");
    promptPanel.classList.add("hidden");
    currentPromptId = null;
    promptInput.value = "";
    await pollTask();
  } catch (error) {
    showError(error);
  } finally {
    promptSubmit.disabled = false;
  }
}

function renderTask(task) {
  if (!task) return;
  if (task.id !== currentTaskId) currentTaskId = task.id;
  if (task.logs !== lastLogText) {
    taskLog.textContent = task.logs || "Task started.";
    taskLog.scrollTop = taskLog.scrollHeight;
    lastLogText = task.logs;
  }
  const running = task.status === "running" || task.status === "stopping";
  document.querySelector("#task-state").textContent = running
    ? task.prompt ? "Waiting for your response" : task.command === "scan" ? "Scanning jobs…" : "Working through applications…"
    : task.status === "completed" ? "Task completed" : task.status === "stopped" ? "Task stopped" : "Task ended";
  document.querySelector("#task-dot").className = running ? "running" : task.status === "failed" ? "failed" : "";
  document.querySelector("#stop-task").classList.toggle("hidden", !running);
  if (task.prompt) {
    currentPromptId = task.prompt.id;
    document.querySelector("#prompt-text").textContent = task.prompt.text;
    buildChoices(task.prompt.text);
    promptPanel.classList.remove("hidden");
    promptInput.focus();
  } else {
    promptPanel.classList.add("hidden");
    currentPromptId = null;
  }
}

async function pollTask() {
  if (polling) return;
  polling = true;
  try {
    const response = await fetch("/api/task");
    const result = await response.json();
    renderTask(result.task);
    if (result.task && ["completed", "failed", "stopped"].includes(result.task.status)) {
      await loadJobs();
    }
  } catch (error) {
    showError(error);
  } finally {
    polling = false;
  }
}

document.querySelectorAll("[data-action]").forEach((button) => {
  button.addEventListener("click", async () => {
    try {
      if (button.dataset.action === "scan" || button.dataset.action === "apply") {
        await startTask(button.dataset.action);
      } else {
        setView(button.dataset.action === "external" ? "external" : "shortlist");
      }
    } catch (error) {
      showError(error);
    }
  });
});

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => setView("all"));
});
portalSelect.addEventListener("change", () => {
  document.querySelector("#portal-context").textContent = `${portalSelect.value === "naukri" ? "Naukri" : "LinkedIn"} workspace`;
  loadJobs().catch(showError);
});
document.querySelector("#refresh-jobs").addEventListener("click", () => loadJobs().catch(showError));
document.querySelector("#score-filter").addEventListener("change", () => loadJobs().catch(showError));
document.querySelector("#show-all").addEventListener("click", () => {
  showingAll = !showingAll;
  loadJobs().catch(showError);
});
document.querySelector("#clear-log").addEventListener("click", () => {
  taskLog.textContent = "Activity log cleared.";
  lastLogText = taskLog.textContent;
});
promptSubmit.addEventListener("click", () => respondToPrompt());
promptInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") respondToPrompt();
});
document.querySelector("#stop-task").addEventListener("click", async () => {
  await fetch("/api/stop", { method: "POST" });
  await pollTask();
});
document.querySelector("#logout").addEventListener("click", async () => {
  await fetch("/api/logout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  window.location.assign("/");
});

loadJobs().catch(showError);
loadSettings().catch(showError);
pollTask();
setInterval(pollTask, 900);
