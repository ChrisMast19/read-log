# The Read Log

A woodsmanship instrument for hunters. It grades two things — **The Read** (how
well you call a hunt before it happens) and **The Adjust** (how well you react
when the weather moves on you) — and never the yield. Sits and stalks, mixed in
a day. Voice or thumb. AI coaching where it earns its keep.

This package is a deployable Netlify site: a Vite + React front end plus two
serverless functions that keep your API key server-side.

---

## What's in here

    src/App.jsx              the whole app (UI + scoring engine)
    src/main.jsx             React entry point
    src/index.css            minimal reset
    index.html               Vite HTML shell
    netlify/functions/
      claude.js              proxies the Anthropic API (reads CLAUDE_API_KEY)
      weather.js             proxies Open-Meteo (geocode + historical hourly)
    netlify.toml             build + functions config
    .env.example             template for local dev

The math (Read, Adjust, drift detection, stalk leak map) runs in the browser and
is deterministic. The AI is used only for the coach's narration; the weather
proxy supplies the real conditions that gate The Adjust.

---

## Deploy (recommended: Git)

1. Push this folder to a new GitHub/GitLab repo.
2. In Netlify: **Add new site → Import an existing project**, pick the repo.
   Netlify auto-detects Vite (build `npm run build`, publish `dist`).
3. **Site settings → Environment variables**, add:
       CLAUDE_API_KEY = sk-ant-...        (your Anthropic key)
       CLAUDE_MODEL   = claude-sonnet-5   (optional; this is the default)
4. Deploy. The functions are served automatically at
   `/.netlify/functions/claude` and `/.netlify/functions/weather`.

## Deploy (alternative: CLI)

    npm install -g netlify-cli
    npm install
    netlify env:set CLAUDE_API_KEY "sk-ant-..."
    netlify deploy --build --prod

## Run locally

    npm install
    cp .env.example .env        # then paste your real key into .env
    netlify dev                 # runs Vite + the functions together

`netlify dev` is required (not plain `npm run dev`) so the `/.netlify/functions`
routes exist while developing.

---

## Notes

- **Your key is never shipped to the browser.** The client calls
  `/.netlify/functions/claude`; the function attaches the key and forwards to
  Anthropic. Same for weather.
- **Model:** defaults to `claude-sonnet-5`. Change it with the `CLAUDE_MODEL`
  env var if your account uses a different one.
- **The Adjust** is driven by the real weather over the sit's daylight window.
  Once you capture sit start/end times, narrow the window in `weather.js`
  (the `hr >= 5 && hr <= 19` filter) and the drift check gets sharper.
- **Stalks** are logged and coached (the cause-of-failure leak map) but not yet
  given a numeric score — by design, until there's enough volume to be honest.
- **Cost:** each "read my season" tap is one Claude call (~1k output tokens).
  Open-Meteo is free.
- **Data** persists in the browser via `localStorage` — per device, no account.
  Swap to a real datastore when you add multi-device sync.
