# TechNova backend

Express + SQLite API that replaces the frontend's old mock data. It generates
the 20-question assessment, grades it, detects skill gaps, and matches
recommended courses (with iGOT Karmayogi deep-links).

## Run it

```bash
cd server
npm install
npm start
```

Starts on `http://localhost:4000`. A `data/technova.sqlite` file is created
automatically on first run (already gitignored).

The frontend's `package.json` has `"proxy": "http://localhost:4000"`, so with
both `npm start` (frontend, port 3000) and this server running, the app's
fetch calls to `/api/...` are forwarded automatically — no extra config.

## Endpoints

- `GET  /api/health` — liveness check
- `POST /api/assessment/start` — body `{ profile, level }` → `{ attemptId, questions }` (no answers included)
- `POST /api/assessment/submit` — body `{ attemptId, answers: { questionId: selectedIndex } }` → `{ score, total, percent, categoryScores, gaps, competencies, readiness, recommendations }`
- `GET  /api/courses` — full course catalogue
- `GET  /api/admin/summary` — live aggregate stats across all recorded attempts

## Important: placeholder iGOT links

`src/courses.js` has real course *titles* mapped to real *skill categories*,
but the `igotUrl` on each course is a **placeholder** in the correct URL shape
(`https://portal.igotkarmayogi.gov.in/app/toc/do_<id>/overview`) — the actual
`do_...` IDs are made up, since this server has no live access to iGOT's
catalogue. Before a real demo, open each matching course on iGOT yourself and
swap in the real URL from the address bar. Nothing else needs to change —
matching, scoring and the rest of the pipeline works the same regardless of
which URLs are in that file.

## How recommendations work

1. `questionBank.js` generates the 20 questions server-side (ported from the
   old `src/assessment.js`) and stores the full set — including correct
   answers — keyed by a generated `attemptId`. Only the answer-stripped
   version is sent to the browser.
2. On submit, `scoring.js` grades against the stored answer key, computes a
   score per question **category** (e.g. "Python", "PLFS", "Data quality"),
   and flags any category scoring below 70% as a gap.
3. Categories roll up into 4 competency buckets (Statistical / Technical /
   Digital governance / Behavioural & managerial) for the dashboard's radar
   view.
4. Each gap is matched against `courses.js` by shared skill tag; the weakest
   skills get the highest match %. Results and gaps are persisted to SQLite
   so `/api/admin/summary` can report real, live aggregates instead of a
   hardcoded demo number.

---

## AI Assessment Studio

The Studio endpoints (`/api/materials`, `/api/studio`) require a verified
Firebase ID token and a working Anthropic API key. Full setup, environment
variables, database notes, the scoring formula and the known limitations are
documented in `../ASSESSMENT_STUDIO.md`.

Quick check after `npm start`:

```
GET /api/health -> { ok, firebaseAdmin, claudeConfigured, model, maxUploadMb }
```

Run `npm test` to exercise the whole upload -> extract -> generate -> grade ->
competency-update pipeline against real PDF/DOCX fixtures (Claude stubbed).

The iGOT Karmayogi course IDs in `src/courses.js` are placeholders. There is no
live iGOT API access.
