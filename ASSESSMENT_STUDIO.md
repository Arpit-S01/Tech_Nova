# AI Assessment Studio — setup and handoff

This replaces the old static/demo Studio tab with a real pipeline:

```
real PDF/DOCX  ->  real text extraction (page / section refs kept)
               ->  Claude analyses the text and names the competencies
               ->  keyword retrieval pulls the relevant chunks
               ->  Claude writes MCQs ONLY from those chunks
               ->  Claude validates every answer against its chunk
               ->  you take the quiz (answer key stays on the server)
               ->  the server grades it
               ->  evidence is stored in SQLite
               ->  competency scores are recalculated deterministically
               ->  skill gaps = required - current
               ->  recommendations are driven by those gaps
```

There are no hardcoded questions anywhere in this flow. If the AI step fails,
the UI shows an error instead of falling back to fake questions.

---

## 1. Install

```bash
cd server
npm install
```

New packages: `@anthropic-ai/sdk`, `dotenv`, `firebase-admin`, `mammoth`,
`multer`, `pdf-parse`. The frontend needs no new packages.

## 2. Environment variables

Create `server/.env` (it is git-ignored — never commit it, never paste it to
anyone):

```
PORT=4000
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-5
FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_SERVICE_ACCOUNT_PATH=C:\Users\arpit\secrets\technova-admin.json
MAX_UPLOAD_BYTES=15728640
```

- `ANTHROPIC_API_KEY` is read only by the server. React never sees it.
- The Firebase **service account JSON** must live **outside** the repo folder.
  Download it from Firebase Console -> Project settings -> Service accounts ->
  Generate new private key.
- `AUTH_DEV_BYPASS=true` exists for local work without Firebase Admin. It makes
  the server accept `Authorization: Bearer dev:<some-uid>` and prints a loud
  warning on boot. Never set it on anything shared.

The React side keeps using the existing root `.env.local` with your
`REACT_APP_FIREBASE_*` values. Nothing changed there.

## 3. Run

```bash
cd server && npm start     # http://localhost:4000
cd ..     && npm start     # http://localhost:3000
```

CRA's `proxy` field already forwards `/api/*` to port 4000.

Check the server is configured correctly:

```
GET http://localhost:4000/api/health
-> { ok, firebaseAdmin, claudeConfigured, model, maxUploadMb }
```

Both `firebaseAdmin` and `claudeConfigured` must be `true` before the Studio
will work.

## 4. Automated test

```bash
cd server
npm test
```

This drives the whole pipeline against real PDF and DOCX fixtures with the
Claude calls stubbed, and asserts: extraction works, page labels come from the
PDF, the answer key never reaches the browser, the server ignores any score sent
by the browser, unanswered questions are counted, source references are present,
competency movement is deterministic, one user cannot read another user's
material, a scanned PDF is refused, and DOCX uses sections rather than invented
page numbers.

---

## Endpoints added

All of them require `Authorization: Bearer <firebase-id-token>`. The user id
always comes from the verified token, never from the request body.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/materials` | list your uploaded documents |
| GET | `/api/materials/:id` | one document + detected competencies |
| GET | `/api/materials/:id/chunks` | the real extracted text, chunk by chunk |
| POST | `/api/materials/upload` | multipart upload (field `file`), max 15 MB |
| POST | `/api/studio/sessions` | generate questions from a material |
| GET | `/api/studio/sessions/:id` | reload a session (no answers) |
| POST | `/api/studio/sessions/:id/submit` | grade, store evidence, update state |
| GET | `/api/studio/profile` | competencies, gaps, evidence, history |

## Database

`server/src/db.js` only ever runs `CREATE TABLE IF NOT EXISTS`. The existing
`attempts` and `results` tables are untouched and no existing row is deleted.

New tables: `app_users`, `materials`, `material_chunks`, `ai_sessions`,
`ai_answers`, `ai_results`, `competency_evidence`, `competency_state`,
`competency_history`, `skill_gaps`.

## How the numbers are calculated

- **Score** — `correct / total`, computed on the server against the stored
  answer key. The browser sends only the chosen option letters.
- **Competency update** —
  `new = round((previous x priorWeight + assessmentPct x evidenceWeight) / (priorWeight + evidenceWeight))`
  where `evidenceWeight` is the number of questions just answered for that
  competency and `priorWeight` is how much earlier evidence exists, capped at
  12 questions. First-time evidence simply becomes the score. Every change is
  written to `competency_history` with the previous score, the evidence and a
  plain-English explanation. There is no `old + 10`.
- **Skill gap** — `required - current`. Required comes from the role level
  (Beginner 60, Intermediate 75, Advanced 85).
- **Recommendations** — courses ranked by gap size and term overlap with the
  catalogue; each card states which gap and which terms produced it.

## Honest limitations

- **Scanned / image-only PDFs are refused**, not guessed at. There is no OCR.
- `.doc` (old Word format) is not supported — only `.docx`.
- Retrieval is TF-IDF keyword matching, not semantic/vector search. This was a
  deliberate choice: it is explainable and needs no vector database.
- The iGOT Karmayogi course IDs in `server/src/courses.js` are **placeholders**.
  The links are labelled as such in the UI. There is no live iGOT API access and
  no government authentication.
- Generating an assessment calls the Anthropic API and consumes API credits.
- The automated test stubs the Claude calls. The real end-to-end AI path needs
  a valid `ANTHROPIC_API_KEY` and has to be run by you locally.
