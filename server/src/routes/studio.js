// The real assessment loop: generate grounded MCQs -> serve them without answers
// -> grade server-side -> record evidence -> update competency -> recompute gaps
// -> re-rank recommendations.

const express = require('express');
const crypto = require('crypto');

const db = require('../db');
const { requireAuth } = require('../auth');
const { retrieve } = require('../retrieval');
const { generateQuestions, validateQuestions, AIError } = require('../claude');
const competency = require('../competency');

const router = express.Router();
router.use(requireAuth);

const DIFFICULTIES = ['Easy', 'Medium', 'Hard', 'Mixed'];
const COUNTS = [5, 10, 15];

function loadChunks(materialId) {
  return db
    .prepare('SELECT idx, page, section, label, text FROM material_chunks WHERE material_id = ? ORDER BY idx')
    .all(materialId);
}

// Answer-stripped view. The correct index and the source never leave the server
// until the session has been graded.
function publicQuestion(q, index) {
  return {
    id: q.id,
    number: index + 1,
    question: q.question,
    options: q.options,
    competency: q.competency,
    category: q.category,
    difficulty: q.difficulty
  };
}

// ---------------------------------------------------------------------------
// POST /api/studio/sessions   { materialId, count, difficulty, competencies[] }
// ---------------------------------------------------------------------------
router.post('/sessions', async (req, res, next) => {
  const { materialId, count = 5, difficulty = 'Mixed', competencies = [] } = req.body || {};
  const uid = req.user.uid;

  if (!materialId) return res.status(400).json({ error: 'materialId is required.' });
  if (!COUNTS.includes(Number(count))) return res.status(400).json({ error: `count must be one of ${COUNTS.join(', ')}.` });
  if (!DIFFICULTIES.includes(difficulty)) return res.status(400).json({ error: `difficulty must be one of ${DIFFICULTIES.join(', ')}.` });

  const material = db.prepare('SELECT * FROM materials WHERE id = ? AND uid = ?').get(materialId, uid);
  if (!material) return res.status(404).json({ error: 'Material not found.' });
  if (material.status !== 'analyzed' || !material.analysis) {
    return res.status(409).json({ error: 'This material has not been analysed successfully, so questions cannot be generated from it.' });
  }

  const analysis = JSON.parse(material.analysis);
  const selected = Array.isArray(competencies) && competencies.length
    ? analysis.competencies.filter((c) => competencies.includes(c.name))
    : analysis.competencies;

  if (!selected.length) return res.status(400).json({ error: 'Select at least one detected competency.' });

  const chunks = loadChunks(materialId);
  const chunksById = new Map(chunks.map((c) => [c.idx, c]));

  // Split the requested question count across the chosen competencies.
  const total = Number(count);
  const per = selected.map((_, i) => Math.floor(total / selected.length) + (i < total % selected.length ? 1 : 0));

  const generated = [];
  const generationNotes = [];
  let modelUsed = null;

  try {
    for (let i = 0; i < selected.length; i++) {
      const want = per[i];
      if (!want) continue;
      const comp = selected[i];
      const entries = retrieve(chunks, `${comp.name} ${(comp.keywords || []).join(' ')}`, Math.min(6, Math.max(3, want + 2)));
      if (!entries.length) {
        generationNotes.push(`No document text could be retrieved for "${comp.name}".`);
        continue;
      }
      if (entries.every((e) => e.fallback)) {
        generationNotes.push(`"${comp.name}" had no direct keyword match — a spread of sections across the document was used instead.`);
      }
      const out = await generateQuestions({
        filename: material.filename,
        competency: comp,
        entries,
        count: want,
        difficulty
      });
      modelUsed = out.model || modelUsed;
      generated.push(...out.questions);
    }
  } catch (err) {
    if (err instanceof AIError) return res.status(502).json({ error: err.message, code: err.code });
    return next(err);
  }

  if (!generated.length) {
    return res.status(502).json({
      error: 'Claude did not return any usable questions for this material. Nothing was generated — TechNova does not substitute pre-written questions.',
      code: 'NO_QUESTIONS',
      notes: generationNotes
    });
  }

  // Validation pass: drop anything the source does not support.
  let verdicts = [];
  try {
    ({ verdicts } = await validateQuestions({ questions: generated, chunksById }));
  } catch (err) {
    if (!(err instanceof AIError)) return next(err);
    generationNotes.push(`Grounding validation could not run (${err.message}). Questions are shown as generated.`);
  }

  const verdictByIndex = new Map(verdicts.map((v) => [Number(v.index), v]));
  const kept = [];
  const rejected = [];
  generated.forEach((q, i) => {
    const verdict = verdictByIndex.get(i);
    const supported = verdict ? verdict.supported !== false : true;
    if (supported) kept.push({ ...q, validation: verdict ? verdict.reason : 'Validation pass unavailable.' });
    else rejected.push({ question: q.question, reason: verdict.reason || 'Not supported by the source text.' });
  });

  if (!kept.length) {
    return res.status(502).json({
      error: 'Every generated question failed the grounding check against your document, so none were kept.',
      code: 'ALL_REJECTED',
      rejected
    });
  }

  const sessionId = crypto.randomUUID();
  const questions = kept.map((q, i) => ({ ...q, id: `${sessionId}-q${i + 1}` }));
  const now = new Date().toISOString();
  const config = { count: total, difficulty, competencies: selected.map((c) => c.name) };

  db.prepare(
    `INSERT INTO ai_sessions (id, uid, material_id, config, questions, model, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'ready', ?)`
  ).run(sessionId, uid, materialId, JSON.stringify(config), JSON.stringify(questions), modelUsed, now);

  res.json({
    sessionId,
    material: { id: material.id, filename: material.filename, kind: material.kind },
    config,
    model: modelUsed,
    requested: total,
    generated: generated.length,
    kept: questions.length,
    rejected,
    notes: generationNotes,
    questions: questions.map(publicQuestion)
  });
});

// GET /api/studio/sessions/:id — resume an unsubmitted quiz (no answers included)
router.get('/sessions/:id', (req, res) => {
  const session = db.prepare('SELECT * FROM ai_sessions WHERE id = ? AND uid = ?').get(req.params.id, req.user.uid);
  if (!session) return res.status(404).json({ error: 'Assessment session not found.' });
  const questions = JSON.parse(session.questions);
  res.json({
    sessionId: session.id,
    status: session.status,
    config: JSON.parse(session.config),
    questions: questions.map(publicQuestion)
  });
});

// ---------------------------------------------------------------------------
// POST /api/studio/sessions/:id/submit   { answers: { questionId: index } }
// The browser sends only the selections. The score is calculated here.
// ---------------------------------------------------------------------------
router.post('/sessions/:id/submit', (req, res) => {
  const uid = req.user.uid;
  const session = db.prepare('SELECT * FROM ai_sessions WHERE id = ? AND uid = ?').get(req.params.id, req.user.uid);
  if (!session) return res.status(404).json({ error: 'Assessment session not found.' });
  if (session.status === 'submitted') return res.status(409).json({ error: 'This assessment has already been submitted.' });

  const answers = (req.body && req.body.answers) || {};
  const questions = JSON.parse(session.questions);
  const material = db.prepare('SELECT * FROM materials WHERE id = ?').get(session.material_id);

  // 1. Grade — server-side, against the stored answer key.
  const graded = competency.gradeSession(questions, answers);
  const now = new Date().toISOString();

  // 2. Persist the submission and the result.
  db.transaction(() => {
    db.prepare("UPDATE ai_sessions SET status = 'submitted', submitted_at = ? WHERE id = ?").run(now, session.id);
    const insertAnswer = db.prepare(
      'INSERT OR REPLACE INTO ai_answers (session_id, question_id, selected, correct) VALUES (?, ?, ?, ?)'
    );
    for (const q of graded.perQuestion) insertAnswer.run(session.id, q.id, q.selected, q.isCorrect ? 1 : 0);

    db.prepare(
      `INSERT OR REPLACE INTO ai_results (session_id, uid, material_id, total, correct, incorrect, unanswered, percent, competency_scores, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(session.id, uid, session.material_id, graded.total, graded.correct, graded.incorrect,
      graded.unanswered, graded.percent, JSON.stringify(graded.competencyScores), now);
  })();

  // 3. Evidence -> competency update -> gaps -> recommendations.
  const profileRow = db.prepare('SELECT profile FROM app_users WHERE uid = ?').get(uid);
  const level = (() => {
    try { return JSON.parse(profileRow?.profile || '{}').level; } catch { return undefined; }
  })();

  const competencyUpdates = competency.applyEvidence({
    uid,
    sessionId: session.id,
    materialId: session.material_id,
    competencyScores: graded.competencyScores,
    level
  });

  const gaps = competency.getSkillGaps(uid);
  const recommendations = competency.recommendForGaps(gaps);

  // 4. Only now do correct answers, explanations and source references go out.
  const review = graded.perQuestion.map((q, i) => ({
    id: q.id,
    number: i + 1,
    question: q.question,
    options: q.options,
    selected: q.selected,
    answer: q.answer,
    isCorrect: q.isCorrect,
    answered: q.answered,
    explanation: q.explanation,
    competency: q.competency,
    category: q.category,
    difficulty: q.difficulty,
    source: {
      document: material ? material.filename : 'Uploaded material',
      label: q.sourceLabel,
      page: q.sourcePage,
      section: q.sourceSection,
      quote: q.sourceQuote,
      reference: material ? `${material.filename} — ${q.sourceLabel}` : q.sourceLabel
    }
  }));

  res.json({
    sessionId: session.id,
    material: material ? { id: material.id, filename: material.filename, kind: material.kind } : null,
    score: {
      total: graded.total,
      correct: graded.correct,
      incorrect: graded.incorrect,
      unanswered: graded.unanswered,
      percent: graded.percent,
      formula: `${graded.correct} correct ÷ ${graded.total} questions = ${graded.percent}%`
    },
    competencyScores: graded.competencyScores,
    competencyUpdates,
    competencies: competency.getCompetencyState(uid),
    gaps,
    recommendations,
    review,
    gradedBy: 'server'
  });
});

// GET /api/studio/profile — current competency state, gaps, evidence, history
router.get('/profile', (req, res) => {
  const uid = req.user.uid;
  const gaps = competency.getSkillGaps(uid);
  res.json({
    competencies: competency.getCompetencyState(uid),
    gaps,
    evidence: competency.getEvidence(uid),
    history: competency.getHistory(uid),
    recommendations: competency.recommendForGaps(gaps),
    method: {
      gap: 'gap = required competency − current competency',
      update: 'new score = (previous × prior evidence weight + assessment % × new evidence weight) ÷ total weight',
      priorWeightCap: competency.PRIOR_WEIGHT_CAP
    }
  });
});

module.exports = router;
