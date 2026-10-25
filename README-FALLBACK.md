# Fallback chain v3

Replace `src/gemini.js` and `src/providers-config.js`; add `scripts/check-keys.js` (and optionally `scripts/test-fallback.js`).

## What changed
- GitHub Models removed: it was fully retired on 30 Jul 2026 (the "OK" non-JSON reply you saw came from the dead endpoint).
- Groq models updated: llama-3.3-70b-versatile and llama-3.1-8b-instant were retired on free tier on 16 Aug 2026.
- Google reports an invalid key as HTTP 400 "API key not valid"; this is now recognised, so one bad key costs one call instead of one per model.
- Providers that return junk are paused for 10 minutes instead of being retried every pass.
- Optional extra providers (OpenAI-style): cerebras, mistral, openrouter. Used only if their key is in .env and models are listed.
- When every provider is dead the error is flagged `fatal`.

## .env
    GEMINI_API_KEYS=key1,key2        # no quotes, no spaces needed
    GROQ_API_KEYS=...
    CEREBRAS_API_KEYS=...            # optional
    MISTRAL_API_KEYS=...             # optional
    OPENROUTER_API_KEYS=...          # optional

## Use
    node scripts/check-keys.js           # which keys work, which model IDs exist for them
    node scripts/check-keys.js --ping    # plus one tiny real request per key
    node scripts/test-fallback.js        # offline logic test

Then trim the model arrays in providers-config.js to IDs that check-keys.js shows as available.

## Stop a scan early when everything is dead (optional, in src/index.js)
In the inner `catch (err)` of scan(), add as the first line:
    if (err.fatal) { console.error("\n" + err.message); return; }
