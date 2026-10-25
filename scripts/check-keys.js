// Checks every key in .env and lists the model IDs each one can use right now.
//   node scripts/check-keys.js          list keys + models, flag configured models that don't exist
//   node scripts/check-keys.js --ping   also send one tiny real request per provider (uses a little quota)
//   node scripts/check-keys.js --all    print every model ID instead of the first 40
import "dotenv/config";
import { providerConfig } from "../src/providers-config.js";
import { COMPAT, keysFrom, buildProviders } from "../src/gemini.js";

const PING = process.argv.includes("--ping");
const ALL = process.argv.includes("--all");
const mask = (k) => `${k.length} chars, ends ...${k.slice(-4)}`;

async function get(url, headers) {
  try {
    const res = await fetch(url, { headers });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch {}
    return { status: res.status, json, text, ctype: res.headers.get("content-type") };
  } catch (e) {
    return { status: 0, text: String(e.message ?? e) };
  }
}

function report(label, key, r, ids, configured) {
  if (r.status !== 200 || !ids) {
    const msg = r.json?.error?.message ?? r.json?.message ?? r.text.slice(0, 120).trim();
    console.log(`  X ${label} (${mask(key)}): HTTP ${r.status} ${msg}`);
    return;
  }
  console.log(`  OK ${label} (${mask(key)}): ${ids.length} models available`);
  const missing = configured.filter((m) => !ids.includes(m));
  if (missing.length) console.log(`     NOT AVAILABLE to this key (remove from providers-config.js): ${missing.join(", ")}`);
  const shown = ALL ? ids : ids.slice(0, 40);
  console.log(`     models: ${shown.join(", ")}${ids.length > shown.length ? `  ... +${ids.length - shown.length} more (use --all)` : ""}`);
}

console.log("Checking keys from .env (keys are never printed in full)\n");

const gemKeys = keysFrom(process.env, ["GEMINI_API_KEYS", "GEMINI_API_KEY"]);
console.log(`Gemini: ${gemKeys.length} key(s)`);
for (const [i, key] of gemKeys.entries()) {
  const r = await get("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", { "x-goog-api-key": key });
  const ids = r.json?.models
    ?.filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""));
  report(`gemini#${i + 1}`, key, r, ids, providerConfig.gemini?.models ?? []);
}

for (const c of COMPAT) {
  const keys = keysFrom(process.env, c.envs);
  if (!keys.length) continue;
  console.log(`\n${c.family}: ${keys.length} key(s)`);
  for (const [i, key] of keys.entries()) {
    const r = await get(c.modelsUrl, { Authorization: `Bearer ${key}` });
    let ids = r.json?.data?.map((m) => m.id);
    if (c.family === "openrouter" && ids && !ALL) ids = ids.filter((id) => id.endsWith(":free"));
    report(`${c.family}#${i + 1}`, key, r, ids, providerConfig[c.family]?.models ?? []);
  }
}

if (PING) {
  console.log("\nPing (one tiny request per key, first model only):");
  const schema = { type: "OBJECT", properties: { ok: { type: "BOOLEAN" } }, required: ["ok"] };
  const seen = new Set();
  for (const p of buildProviders()) {
    if (seen.has(p.group)) continue;
    seen.add(p.group);
    try {
      await p.call('Reply with JSON: {"ok": true}', schema);
      console.log(`  OK ${p.name}`);
    } catch (e) {
      console.log(`  X ${p.name}: ${String(e.message).slice(0, 200)}`);
    }
  }
}
console.log("\nDone.");
