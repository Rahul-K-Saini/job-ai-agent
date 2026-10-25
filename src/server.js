import "dotenv/config";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { applyConfig } from "./apply-config.js";
import { config } from "./config.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const HOST = "127.0.0.1";
// For future trusted private-network hosting only:
// const HOST = process.env.DASHBOARD_HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 4173);
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const sessions = new Map();
const loginFailures = new Map();
const JOB_FILES = { naukri: config.dataFile, linkedin: config.linkedinDataFile };
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

let activeTask = null;
let nextPromptId = 1;

function hash(value) {
  return createHash("sha256").update(value).digest();
}

function equalSecret(actual, expected) {
  return timingSafeEqual(hash(actual), hash(expected));
}

function sessionCookie(token, maxAge = SESSION_TTL_MS / 1000) {
  return `jobdesk_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

function cookieToken(request) {
  const cookies = request.headers.cookie ?? "";
  return cookies.match(/(?:^|;\s*)jobdesk_session=([a-f0-9]+)/)?.[1] ?? "";
}

function authenticated(request) {
  const token = cookieToken(request);
  const expires = sessions.get(token);
  if (!expires) return false;
  if (expires <= Date.now()) {
    sessions.delete(token);
    return false;
  }
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return true;
}

function sameOrigin(request) {
  const origin = request.headers.origin;
  return Boolean(origin && new URL(origin).host === request.headers.host);
}

function checkLoginLimit(request) {
  const ip = request.socket.remoteAddress ?? "unknown";
  const entry = loginFailures.get(ip);
  if (entry?.blockedUntil > Date.now()) return false;
  if (entry && entry.blockedUntil) loginFailures.delete(ip);
  return true;
}

function recordLoginFailure(request) {
  const ip = request.socket.remoteAddress ?? "unknown";
  const entry = loginFailures.get(ip) ?? { count: 0, blockedUntil: 0 };
  entry.count++;
  if (entry.count >= 5) {
    entry.blockedUntil = Date.now() + 15 * 60 * 1000;
    entry.count = 0;
  }
  loginFailures.set(ip, entry);
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

function portalFrom(value) {
  if (value !== "naukri" && value !== "linkedin") {
    throw new Error('Choose either "naukri" or "linkedin".');
  }
  return value;
}

function readJobs(portal) {
  const file = path.join(ROOT, JOB_FILES[portal]);
  try {
    const jobs = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!jobs || Array.isArray(jobs) || typeof jobs !== "object") {
      throw new Error(`${JOB_FILES[portal]} must contain a JSON object.`);
    }
    return Object.values(jobs);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function getJobs(url) {
  const portal = portalFrom(url.searchParams.get("portal") || "naukri");
  const minScore = Number(url.searchParams.get("minScore") ?? 0);
  const mode = url.searchParams.get("mode") ?? "all";
  if (!Number.isFinite(minScore)) throw new Error("Minimum score must be a number.");
  if (!["all", "shortlist", "external"].includes(mode)) throw new Error("Unknown job list filter.");

  const allJobs = readJobs(portal);
  const jobs = allJobs
    .filter((job) => Number(job.score) >= minScore)
    .filter((job) => mode !== "shortlist" || job.status === "shortlisted")
    .filter((job) => mode !== "external" || (
      job.status === "external" || /apply\s+on\s+company\s+site/i.test(job.applyText ?? "")
    ))
    .sort((a, b) => Number(b.score) - Number(a.score));
  return {
    portal,
    jobs,
    stats: {
      total: allJobs.length,
      shortlisted: allJobs.filter((job) => job.status === "shortlisted").length,
      applied: allJobs.filter((job) => job.status === "applied").length,
      external: allJobs.filter((job) =>
        job.status === "external" || /apply\s+on\s+company\s+site/i.test(job.applyText ?? "")
      ).length,
    },
  };
}

async function readBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 16_384) throw new Error("Request body is too large.");
  }
  return body ? JSON.parse(body) : {};
}

function findPrompt(buffer) {
  const prompts = [
    "Apply? [y]es / [n]o, skip for good / [s]kip for now / [q]uit:",
    "Enter = accept | type your own answer | m = finish manually:",
    "Enter = use suggestion | type a correction | m = finish manually:",
    "Review the form in the browser. Submit this application now? [y/N]:",
    "When done press Enter (or type 'f' if you gave up / it failed):",
    "When done press Enter (or type 'f' if you gave up):",
  ];
  const lower = buffer.toLowerCase();
  return prompts.find((prompt) => lower.includes(prompt.toLowerCase())) ?? null;
}

function startTask(command, portal) {
  if (activeTask && ["running", "stopping"].includes(activeTask.status)) {
    throw new Error("Another task is still running. Stop it or wait for it to finish.");
  }
  const script = path.join(ROOT, "scripts", "cli.js");
  const child = spawn(process.execPath, [script, command, "--portal", portal], {
    cwd: ROOT,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const task = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    command,
    portal,
    status: "running",
    logs: "",
    prompt: null,
    promptBuffer: "",
    child,
  };
  activeTask = task;

  const appendOutput = (chunk) => {
    const text = chunk.toString();
    task.logs = `${task.logs}${text}`.slice(-80_000);
    task.promptBuffer = `${task.promptBuffer}${text}`.slice(-2_000);
    if (!task.prompt) {
      const prompt = findPrompt(task.promptBuffer);
      if (prompt) {
        task.prompt = { id: nextPromptId++, text: prompt };
        task.promptBuffer = "";
      }
    }
  };

  child.stdout.on("data", appendOutput);
  child.stderr.on("data", appendOutput);
  child.on("error", (error) => {
    task.logs += `\nTask could not start: ${error.message}\n`;
    task.status = "failed";
  });
  child.on("close", (code, signal) => {
    if (task.status === "running" || task.status === "stopping") {
      task.status = signal ? "stopped" : code === 0 ? "completed" : "failed";
      if (signal) task.logs += `\nStopped (${signal}).\n`;
      else if (code !== 0) task.logs += `\nProcess exited with code ${code}.\n`;
    }
  });
  return task;
}

function taskSnapshot() {
  if (!activeTask) return null;
  const { child, promptBuffer, ...snapshot } = activeTask;
  return snapshot;
}

async function handleApi(request, response, url) {
  try {
    if (request.method === "POST" && !sameOrigin(request)) {
      sendJson(response, 403, { error: "Cross-origin requests are not allowed." });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/login") {
      if (!checkLoginLimit(request)) {
        sendJson(response, 429, { error: "Too many sign-in attempts. Try again in 15 minutes." });
        return;
      }
      const body = await readBody(request);
      const usernameMatches = equalSecret(String(body.username ?? ""), process.env.DASHBOARD_USERNAME);
      const passwordMatches = equalSecret(String(body.password ?? ""), process.env.DASHBOARD_PASSWORD);
      if (
        !usernameMatches ||
        !passwordMatches
      ) {
        recordLoginFailure(request);
        sendJson(response, 401, { error: "Incorrect username or password." });
        return;
      }
      loginFailures.delete(request.socket.remoteAddress ?? "unknown");
      const token = randomBytes(32).toString("hex");
      sessions.set(token, Date.now() + SESSION_TTL_MS);
      response.setHeader("Set-Cookie", sessionCookie(token));
      sendJson(response, 200, { authenticated: true });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/session") {
      sendJson(response, 200, { authenticated: authenticated(request) });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/logout") {
      sessions.delete(cookieToken(request));
      response.setHeader("Set-Cookie", sessionCookie("", 0));
      sendJson(response, 200, { authenticated: false });
      return;
    }
    if (!authenticated(request)) {
      sendJson(response, 401, { error: "Please sign in to use the dashboard." });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/jobs") {
      sendJson(response, 200, getJobs(url));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/task") {
      sendJson(response, 200, { task: taskSnapshot() });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/settings") {
      sendJson(response, 200, {
        hasFacts: fs.existsSync(path.join(ROOT, applyConfig.factsFile)),
        chromeUrl: config.cdpUrl,
        applyMinScore: applyConfig.minScore,
        maxAppliesPerRun: applyConfig.maxAppliesPerRun,
      });
      return;
    }
    if (request.method !== "POST") {
      sendJson(response, 404, { error: "Not found." });
      return;
    }
    if (!sameOrigin(request)) {
      sendJson(response, 403, { error: "Cross-origin requests are not allowed." });
      return;
    }
    if (url.pathname === "/api/run") {
      const body = await readBody(request);
      const portal = portalFrom(body.portal);
      if (body.command !== "scan" && body.command !== "apply") {
        sendJson(response, 400, { error: "Choose scan or apply." });
        return;
      }
      if (body.command === "apply" && !fs.existsSync(path.join(ROOT, applyConfig.factsFile))) {
        sendJson(response, 400, {
          error: `Missing ${applyConfig.factsFile}. Add candidate facts before starting applications.`,
        });
        return;
      }
      const task = startTask(body.command, portal);
      sendJson(response, 202, { task: taskSnapshot() });
      return;
    }
    if (url.pathname === "/api/respond") {
      const body = await readBody(request);
      if (!activeTask || activeTask.status !== "running" || !activeTask.prompt) {
        sendJson(response, 409, { error: "There is no prompt waiting for a response." });
        return;
      }
      if (body.promptId !== activeTask.prompt.id) {
        sendJson(response, 409, { error: "That prompt is no longer current." });
        return;
      }
      activeTask.prompt = null;
      activeTask.promptBuffer = "";
      activeTask.child.stdin.write(`${String(body.value ?? "")}\n`);
      sendJson(response, 200, { task: taskSnapshot() });
      return;
    }
    if (url.pathname === "/api/stop") {
      if (activeTask?.status === "running") {
        activeTask.status = "stopping";
        activeTask.child.kill();
      }
      sendJson(response, 200, { task: taskSnapshot() });
      return;
    }
    sendJson(response, 404, { error: "Not found." });
  } catch (error) {
    sendJson(response, 400, { error: error.message });
  }
}

if (!process.env.DASHBOARD_USERNAME || !process.env.DASHBOARD_PASSWORD) {
  throw new Error(
    "Set DASHBOARD_USERNAME and DASHBOARD_PASSWORD in .env before starting the dashboard. Use a unique password of at least 16 characters."
  );
}
if (process.env.DASHBOARD_PASSWORD.length < 16) {
  throw new Error("DASHBOARD_PASSWORD must be at least 16 characters.");
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${HOST}:${PORT}`);
  if (url.pathname.startsWith("/api/")) {
    await handleApi(request, response, url);
    return;
  }
  if (!authenticated(request)) {
    const publicAssets = new Set(["/login.html", "/login.js", "/styles.css"]);
    const loginAsset = publicAssets.has(url.pathname) ? url.pathname : "/login.html";
    const content = fs.readFileSync(path.join(PUBLIC_DIR, loginAsset));
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(loginAsset)] ?? "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:",
      "Cache-Control": "no-store",
    });
    response.end(content);
    return;
  }
  const requestPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const file = path.resolve(PUBLIC_DIR, `.${requestPath}`);
  if (!file.startsWith(`${PUBLIC_DIR}${path.sep}`) && file !== path.join(PUBLIC_DIR, "index.html")) {
    response.writeHead(403).end();
    return;
  }
  try {
    const content = fs.readFileSync(file);
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(file)] ?? "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data: https:",
      "Cache-Control": "no-store",
    });
    response.end(content);
  } catch {
    response.writeHead(404).end("Not found");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Job search dashboard running at http://${HOST}:${PORT}`);
  console.log("Local PC only. Keep this terminal open; press Ctrl+C to stop.");
});
