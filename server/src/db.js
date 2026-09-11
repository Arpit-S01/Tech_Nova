const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'technova.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---------------------------------------------------------------------------
// EXISTING TABLES — unchanged. Everything below uses CREATE TABLE IF NOT EXISTS,
// so running this on an existing technova.sqlite adds the new tables and leaves
// every existing row untouched. Nothing is ever dropped.
// ---------------------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS attempts (
    id TEXT PRIMARY KEY,
    profile TEXT NOT NULL,
    level TEXT NOT NULL,
    questions TEXT NOT NULL,
    created_at TEXT NOT NULL,
    submitted_at TEXT
  );
  CREATE TABLE IF NOT EXISTS results (
    attempt_id TEXT PRIMARY KEY REFERENCES attempts(id),
    score INTEGER NOT NULL,
    total INTEGER NOT NULL,
    percent INTEGER NOT NULL,
    category_scores TEXT NOT NULL,
    gaps TEXT NOT NULL,
    competencies TEXT NOT NULL,
    readiness INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
`);

// ---------------------------------------------------------------------------
// NEW: real document-grounded assessment pipeline
// ---------------------------------------------------------------------------
db.exec(`
  -- One row per signed-in Firebase user. uid comes from a VERIFIED token.
  CREATE TABLE IF NOT EXISTS app_users (
    uid TEXT PRIMARY KEY,
    email TEXT,
    display_name TEXT,
    profile TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- An uploaded PDF/DOCX. Owned by exactly one uid.
  CREATE TABLE IF NOT EXISTS materials (
    id TEXT PRIMARY KEY,
    uid TEXT NOT NULL,
    filename TEXT NOT NULL,
    kind TEXT NOT NULL,                -- 'pdf' | 'docx'
    mime TEXT,
    size_bytes INTEGER NOT NULL,
    page_count INTEGER,                -- pages (pdf) or sections (docx)
    char_count INTEGER NOT NULL,
    chunk_count INTEGER NOT NULL,
    status TEXT NOT NULL,              -- 'extracted' | 'analyzed' | 'failed'
    error TEXT,
    analysis TEXT,                     -- JSON from Claude: competencies + concepts
    preview TEXT,                      -- first ~1200 chars of real extracted text
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_materials_uid ON materials(uid);

  -- Extracted text split into chunks, each carrying its real source reference.
  CREATE TABLE IF NOT EXISTS material_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    idx INTEGER NOT NULL,
    page INTEGER,                      -- PDF page number (NULL for DOCX)
    section TEXT,                      -- DOCX section/heading (NULL for PDF)
    label TEXT NOT NULL,               -- human reference, e.g. "Page 12"
    text TEXT NOT NULL,
    char_count INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_chunks_material ON material_chunks(material_id);

  -- A generated quiz. questions JSON includes the correct answers and stays
  -- server-side; the browser only ever receives an answer-stripped copy.
  CREATE TABLE IF NOT EXISTS ai_sessions (
    id TEXT PRIMARY KEY,
    uid TEXT NOT NULL,
    material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    config TEXT NOT NULL,              -- { count, difficulty, competencies[] }
    questions TEXT NOT NULL,
    model TEXT,
    status TEXT NOT NULL,              -- 'ready' | 'submitted'
    created_at TEXT NOT NULL,
    submitted_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_uid ON ai_sessions(uid);

  -- Exactly what the user selected, as submitted.
  CREATE TABLE IF NOT EXISTS ai_answers (
    session_id TEXT NOT NULL REFERENCES ai_sessions(id) ON DELETE CASCADE,
    question_id TEXT NOT NULL,
    selected INTEGER,                  -- NULL = unanswered
    correct INTEGER NOT NULL,          -- 0/1, decided by the server
    PRIMARY KEY (session_id, question_id)
  );

  -- Server-calculated result. The browser never submits a score.
  CREATE TABLE IF NOT EXISTS ai_results (
    session_id TEXT PRIMARY KEY REFERENCES ai_sessions(id) ON DELETE CASCADE,
    uid TEXT NOT NULL,
    material_id TEXT NOT NULL,
    total INTEGER NOT NULL,
    correct INTEGER NOT NULL,
    incorrect INTEGER NOT NULL,
    unanswered INTEGER NOT NULL,
    percent INTEGER NOT NULL,
    competency_scores TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  -- Immutable audit trail: every piece of evidence that moved a competency.
  CREATE TABLE IF NOT EXISTS competency_evidence (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL,
    competency TEXT NOT NULL,
    category TEXT,
    session_id TEXT,
    material_id TEXT,
    source TEXT NOT NULL,              -- e.g. 'ai-assessment'
    correct INTEGER NOT NULL,
    total INTEGER NOT NULL,
    pct INTEGER NOT NULL,
    weight REAL NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_evidence_uid ON competency_evidence(uid, competency);

  -- Current competency score per user, rebuilt deterministically from evidence.
  CREATE TABLE IF NOT EXISTS competency_state (
    uid TEXT NOT NULL,
    competency TEXT NOT NULL,
    category TEXT,
    score INTEGER NOT NULL,
    required INTEGER NOT NULL,
    weight REAL NOT NULL,              -- total evidence weight behind the score
    updated_at TEXT NOT NULL,
    PRIMARY KEY (uid, competency)
  );

  -- Before/after log so the UI can show "55 → 62" with the evidence behind it.
  CREATE TABLE IF NOT EXISTS competency_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL,
    competency TEXT NOT NULL,
    previous_score INTEGER,
    new_score INTEGER NOT NULL,
    previous_weight REAL NOT NULL,
    evidence_pct INTEGER NOT NULL,
    evidence_total INTEGER NOT NULL,
    evidence_weight REAL NOT NULL,
    explanation TEXT NOT NULL,
    session_id TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_history_uid ON competency_history(uid, created_at);

  -- Snapshot of required − current after each update.
  CREATE TABLE IF NOT EXISTS skill_gaps (
    uid TEXT NOT NULL,
    competency TEXT NOT NULL,
    category TEXT,
    current INTEGER NOT NULL,
    required INTEGER NOT NULL,
    gap INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (uid, competency)
  );
`);

module.exports = db;
