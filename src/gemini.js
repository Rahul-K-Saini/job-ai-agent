// Drop-in replacement for src/gemini.js. Same export: generateJson(prompt, schema).
//
// Chain: gemini key #1 (each model) -> gemini key #2 (each model) -> groq -> cerebras -> mistral -> openrouter.
// Keys come from .env, comma-separated lists allowed:
//   GEMINI_API_KEYS=k1,k2   GROQ_API_KEYS=g1   CEREBRAS_API_KEYS=c1   MISTRAL_API_KEYS=m1   OPENROUTER_API_KEYS=o1
// (single-key names like GEMINI_API_KEY / GROQ_API_KEY also work)
import { GoogleGenAI } from "@google/genai";
import { providerConfig } from "./providers-config.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_WAIT_MS = 90_000;
const DAILY_COOLDOWN_MS = 6 * 3600_000;
const cooldownUntil = new Map(); // provider name OR group -> epoch ms
const coolEnd = (p) => Math.max(cooldownUntil.get(p.name) ?? 0, cooldownUntil.get(p.group) ?? 0);
export const resetCooldowns = () => cooldownUntil.clear(); // for tests

// OpenAI-style providers: just a URL + env var names. Add more here if you like.
export const COMPAT = [
  { family: "groq", envs: ["GROQ_API_KEYS", "GROQ_API_KEY"], url: "https://api.groq.com/openai/v1/chat/completions", modelsUrl: "https://api.groq.com/openai/v1/models" },
  { family: "cerebras", envs: ["CEREBRAS_API_KEYS", "CEREBRAS_API_KEY"], url: "https://api.cerebras.ai/v1/chat/completions", modelsUrl: "https://api.cerebras.ai/v1/models" },
  { family: "mistral", envs: ["MISTRAL_API_KEYS", "MISTRAL_API_KEY"], url: "https://api.mistral.ai/v1/chat/completions", modelsUrl: "https://api.mistral.ai/v1/models" },
  { family: "openrouter", envs: ["OPENROUTER_API_KEYS", "OPENROUTER_API_KEY"], url: "https://openrouter.ai/api/v1/chat/completions", modelsUrl: "https://openrouter.ai/api/v1/models" },
];

// ---------- helpers ----------
export const keysFrom = (env, names) => [
  ...new Set(names.flatMap((n) => String(env[n] ?? "").split(",")).map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean)),
];

function toPlainSchema(s) {
  if (Array.isArray(s)) return s.map(toPlainSchema);
  if (s && typeof s === "object") {
    return Object.fromEntries(
      Object.entries(s).map(([k, v]) => [k, k === "type" && typeof v === "string" ? v.toLowerCase() : toPlainSchema(v)])
    );
  }
  return s;
}

const parseJson = (text) =>
  JSON.parse(String(text).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));

function checkRequired(obj, schema) {
  const missing = (schema.required ?? []).filter((k) => !(k in obj));
  if (missing.length) throw new Error(`Response missing keys: ${missing.join(", ")}`);
}

const BAD_KEY_RE = /API key not valid|API_KEY_INVALID|invalid[_ ]api[_ ]key|incorrect api key|unauthorized|expected OAuth2/i;

function classify(err) {
  const s = err?.status;
  const msg = String(err?.message ?? "");
  if (s === 429) return { kind: "quota", daily: /per.?day|daily|\bRPD\b|limit:\s*0\b/i.test(msg) };
  if ([500, 502, 503, 504].includes(s) || /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND/i.test(msg)) return { kind: "transient" };
  // Google answers an invalid key with HTTP 400 ("API key not valid"), so check the message too.
  if ([401, 403].includes(s) || BAD_KEY_RE.test(msg)) return { kind: "badkey" };
  if ([400, 404].includes(s)) return { kind: "badmodel" };
  return { kind: "bad_output" };
}

// ---------- provider calls ----------
const geminiClients = new Map();
export async function callGemini(key, model, prompt, schema) {
  if (!geminiClients.has(key)) geminiClients.set(key, new GoogleGenAI({ apiKey: key }));
  const res = await geminiClients.get(key).models.generateContent({
    model,
    contents: prompt,
    config: { responseMimeType: "application/json", responseSchema: schema, temperature: 0.2 },
  });
  return parseJson(res.text);
}

export async function callOpenAICompat({ name, url, key, model }, prompt, schema) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Reply with ONLY a valid JSON object that matches this JSON schema. No prose, no markdown fences.\n" +
            JSON.stringify(toPlainSchema(schema)),
        },
        { role: "user", content: prompt },
      ],
    }),
  });
  const raw = await res.text().catch(() => "");
  if (!res.ok) {
    const err = new Error(`${name} HTTP ${res.status}: ${raw.slice(0, 300)}`);
    err.status = res.status;
    const ra = Number(res.headers.get("retry-after"));
    if (ra > 0) err.retryAfterMs = ra * 1000;
    throw err;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    // e.g. a retired service answering "OK" with HTTP 200
    throw new Error(`${name} returned non-JSON (HTTP ${res.status}, ${res.headers.get("content-type")}): ${raw.slice(0, 80).trim()}`);
  }
  return parseJson(data.choices?.[0]?.message?.content ?? "");
}

// `deps.callGemini` lets tests inject a fake. Keys are never printed; labels are gemini#1, groq#1 ...
export function buildProviders(env = process.env, deps = {}) {
  const gem = deps.callGemini ?? callGemini;
  const out = [];
  const add = (family, keys, models, makeCall) => {
    keys.forEach((key, i) => {
      const group = `${family}#${i + 1}`;
      for (const model of models) out.push({ name: `${group}/${model}`, group, family, call: (p, s) => makeCall(key, model, p, s) });
    });
  };

  add("gemini", keysFrom(env, ["GEMINI_API_KEYS", "GEMINI_API_KEY"]), providerConfig.gemini?.models ?? [], gem);
  for (const c of COMPAT) {
    add(c.family, keysFrom(env, c.envs), providerConfig[c.family]?.models ?? [], (key, model, p, s) =>
      callOpenAICompat({ name: c.family, url: c.url, key, model }, p, s)
    );
  }
  return out;
}

// ---------- the chain ----------
export async function runChain(providers, prompt, schema) {
  if (providers.length === 0) {
    throw Object.assign(
      new Error("No usable providers. Set GEMINI_API_KEYS (and optionally GROQ_API_KEYS ...) in .env and list models in providers-config.js"),
      { fatal: true }
    );
  }

  for (let pass = 0; pass < 3; ) {
    const now = Date.now();
    const ready = providers.filter((p) => coolEnd(p) <= now);

    if (ready.length === 0) {
      const wait = Math.min(...providers.map(coolEnd)) - now;
      if (wait > MAX_WAIT_MS) {
        throw Object.assign(
          new Error("Every provider is rate-limited, rejected, or out of quota. Run: node scripts/check-keys.js"),
          { fatal: true }
        );
      }
      console.warn(`  All providers cooling down; waiting ${Math.ceil(wait / 1000)}s...`);
      await sleep(wait + 250);
      continue;
    }

    pass++;
    for (const p of ready) {
      if (coolEnd(p) > Date.now()) continue;

      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const out = await p.call(prompt, schema);
          checkRequired(out, schema);
          if (p.name !== providers[0].name) console.log(`  (answered by ${p.name})`);
          return out;
        } catch (err) {
          const c = classify(err);
          const short = String(err?.message ?? err).slice(0, 160);

          if (c.kind === "transient" && attempt < 2) {
            const wait = 1500 * 2 ** attempt + Math.random() * 500;
            console.warn(`  ${p.name}: temporary error, retrying in ${Math.round(wait / 1000)}s (${short})`);
            await sleep(wait);
            continue;
          }
          if (c.kind === "quota") {
            cooldownUntil.set(p.name, Date.now() + (c.daily ? DAILY_COOLDOWN_MS : err.retryAfterMs ?? 60_000));
            console.warn(`  ${p.name}: ${c.daily ? "daily quota" : "rate limit"} hit, moving on`);
          } else if (c.kind === "badkey") {
            cooldownUntil.set(p.group, Date.now() + 3600_000);
            console.warn(`  ${p.group}: key rejected, skipping all its models this run (${short})`);
          } else if (c.kind === "badmodel") {
            cooldownUntil.set(p.name, Date.now() + 3600_000);
            console.warn(`  ${p.name}: model/request rejected, skipping it this run (${short})`);
          } else {
            cooldownUntil.set(p.name, Date.now() + 10 * 60_000); // don't hammer a provider that returns junk
            console.warn(`  ${p.name}: bad response (${short}); pausing it 10 min`);
          }
          break;
        }
      }
    }
  }
  throw new Error("All providers failed for this request.");
}

// ---------- public API ----------
let chain;
export function generateJson(prompt, schema) {
  if (!chain) {
    chain = buildProviders();
    const groups = new Map();
    for (const p of chain) groups.set(p.group, (groups.get(p.group) ?? 0) + 1);
    console.log("Provider chain: " + ([...groups].map(([g, n]) => `${g} (${n} model${n > 1 ? "s" : ""})`).join(" -> ") || "none"));
    for (const c of COMPAT) {
      if (keysFrom(process.env, c.envs).length && !(providerConfig[c.family]?.models ?? []).length) {
        console.warn(`Note: ${c.family} key found but no models listed for it in src/providers-config.js, so it is not used.`);
      }
    }
    if (groups.has("gemini#2")) {
      console.warn("Note: Gemini quota is per Google Cloud project; extra keys only help if they are in separate projects (Google may restrict projects used to get around quotas).");
    }
  }
  return runChain(chain, prompt, schema);
}
