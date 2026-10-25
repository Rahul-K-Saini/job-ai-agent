// Offline test of the fallback chain (no keys, no network):  node scripts/test-fallback.js
import { providerConfig } from "../src/providers-config.js";
const { buildProviders, runChain, resetCooldowns } = await import("../src/gemini.js");

const schema = { type: "OBJECT", properties: { score: { type: "NUMBER" } }, required: ["score"] };
const ok = (cond, msg) => { if (!cond) throw new Error("FAILED: " + msg); };
const err = (status, message) => Object.assign(new Error(message), { status });

providerConfig.gemini.models = ["m1", "m2"];
providerConfig.groq.models = ["gq1", "gq2"];
providerConfig.mistral.models = ["mi1"];

let attempts = [], fetchLog = [];
const goodBody = { choices: [{ message: { content: '```json\n{"score": 5}\n```' } }] };
let fetchPlan = () => ({ status: 200, body: goodBody });
globalThis.fetch = async (url, init) => {
  const model = JSON.parse(init.body).model;
  fetchLog.push(`${url.includes("groq") ? "groq" : url.includes("mistral") ? "mistral" : "other"}/${model}`);
  const r = fetchPlan(url, model);
  return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
};
const mk = (env, behavior) =>
  buildProviders(env, { callGemini: async (key, model) => { attempts.push(`${key}/${model}`); return behavior(key, model); } });
const reset = () => { resetCooldowns(); attempts = []; fetchLog = []; fetchPlan = () => ({ status: 200, body: goodBody }); };
const quiet = console.warn; console.warn = () => {};

// 1) key1 exhausted, key2/m1 exhausted, key2/m2 answers
reset();
let p = mk({ GEMINI_API_KEYS: "k1,k2" }, (key, model) => {
  if (key === "k1") throw err(429, "Quota exceeded RequestsPerDay");
  if (model === "m1") throw err(429, "per day");
  return { score: 1 };
});
let out = await runChain(p, "x", schema);
ok(attempts.join() === "k1/m1,k1/m2,k2/m1,k2/m2" && out.score === 1, "order " + attempts.join());
console.log("1) key1 (m1,m2) -> key2 (m1, m2 answers):", attempts.join(" , "));

// 2) next call goes straight to the last working entry
attempts = []; await runChain(p, "again", schema);
ok(attempts.join() === "k2/m2", "got " + attempts.join());
console.log("2) next call skips exhausted ones:", attempts.join(" , "));

// 3) all gemini exhausted -> groq first model
reset();
p = mk({ GEMINI_API_KEYS: "k1,k2", GROQ_API_KEY: "g", MISTRAL_API_KEY: "m" }, () => { throw err(429, "per day"); });
out = await runChain(p, "x", schema);
ok(fetchLog.join() === "groq/gq1", "got " + fetchLog.join());
console.log("3) gemini exhausted -> groq/gq1 answers");

// 4) groq capped on every model -> mistral
reset();
fetchPlan = (url) => url.includes("groq") ? { status: 429, body: "requests per day (RPD)" } : { status: 200, body: goodBody };
out = await runChain(p, "x", schema);
ok(fetchLog.join() === "groq/gq1,groq/gq2,mistral/mi1", "got " + fetchLog.join());
console.log("4) groq capped -> mistral answers:", fetchLog.join(" , "));

// 5) Google-style invalid key: HTTP 400 "API key not valid" must skip ALL of that key's models
reset();
p = mk({ GEMINI_API_KEYS: "bad,good" }, (key) => {
  if (key === "bad") throw err(400, '{"error":{"code":400,"message":"API key not valid. Please pass a valid API key."}}');
  return { score: 2 };
});
out = await runChain(p, "x", schema);
ok(attempts.join() === "bad/m1,good/m1", "got " + attempts.join());
console.log("5) invalid key (HTTP 400) tried once, then next key:", attempts.join(" , "));

// 6) wrong model id (404) skips only that model
reset();
p = mk({ GEMINI_API_KEY: "k" }, (key, model) => { if (model === "m1") throw err(404, "model not found"); return { score: 3 }; });
out = await runChain(p, "x", schema);
ok(attempts.join() === "k/m1,k/m2", "got " + attempts.join());
console.log("6) bad model id skipped:", attempts.join(" , "));

// 7) retired service answering 200 "OK" (non-JSON) -> pause it, next provider answers, not retried 3x
reset();
fetchPlan = (url) => url.includes("groq") ? { status: 200, body: "OK\n" } : { status: 200, body: goodBody };
p = mk({ GROQ_API_KEY: "g", MISTRAL_API_KEY: "m" }, () => ({ score: 0 }));
out = await runChain(p, "x", schema);
ok(fetchLog.join() === "groq/gq1,groq/gq2,mistral/mi1", "got " + fetchLog.join());
fetchLog = []; await runChain(p, "x", schema);
ok(fetchLog.join() === "mistral/mi1", "groq should now be paused, got " + fetchLog.join());
console.log("7) non-JSON 'OK' response: provider paused, mistral answers; next call skips groq");

// 8) everything dead -> fast fatal error instead of per-job spam
reset();
p = mk({ GEMINI_API_KEY: "k" }, () => { throw err(401, "bad"); });
let fatal = false;
try { await runChain(p, "x", schema); } catch (e) { fatal = e.fatal === true; }
ok(fatal, "should throw a fatal error when all providers are dead");
console.log("8) all providers dead -> fatal error flagged");

console.warn = quiet;
console.log("\nAll fallback checks passed.");
