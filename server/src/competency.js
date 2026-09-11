// Deterministic, explainable competency maths. No randomness, no "+10".
//
// Model: every competency score is a WEIGHTED AVERAGE of the assessment evidence
// recorded for it. Weight = number of questions answered (that is the amount of
// evidence). Prior weight is capped so a new assessment always moves the score,
// but a single question can never swing it wildly.
//
//   new = round( (previous * priorWeight + assessmentPct * evidenceWeight)
//                / (priorWeight + evidenceWeight) )
//
// With no prior evidence, the first assessment simply IS the score.
// Every number below can be reproduced by hand from the stored evidence rows.

const db = require('./db');
const { courses } = require('./courses');
const { tokenize } = require('./retrieval');

const PRIOR_WEIGHT_CAP = 12;      // max questions of history that resist a new result
const DEFAULT_REQUIRED = 75;      // target proficiency for a competency
const REQUIRED_BY_LEVEL = { Beginner: 60, Intermediate: 75, Advanced: 85 };

function requiredFor(level) {
  return REQUIRED_BY_LEVEL[level] || DEFAULT_REQUIRED;
}

// ---------------------------------------------------------------------------
// Grading — runs on the server, against the stored answer key.
// ---------------------------------------------------------------------------
function gradeSession(questions, submittedAnswers) {
  const perQuestion = [];
  const byCompetency = new Map();

  for (const q of questions) {
    const raw = submittedAnswers ? submittedAnswers[q.id] : undefined;
    const selected = Number.isInteger(raw) && raw >= 0 && raw < q.options.length ? raw : null;
    const correct = selected !== null && selected === q.answer;

    perQuestion.push({ ...q, selected, isCorrect: correct, answered: selected !== null });

    const key = q.competency;
    if (!byCompetency.has(key)) byCompetency.set(key, { competency: key, category: q.category, correct: 0, total: 0, unanswered: 0 });
    const bucket = byCompetency.get(key);
    bucket.total += 1;
    if (correct) bucket.correct += 1;
    if (selected === null) bucket.unanswered += 1;
  }

  const total = questions.length;
  const correct = perQuestion.filter((q) => q.isCorrect).length;
  const unanswered = perQuestion.filter((q) => !q.answered).length;
  const incorrect = total - correct - unanswered;
  const percent = total ? Math.round((correct / total) * 100) : 0;

  const competencyScores = [...byCompetency.values()].map((b) => ({
    ...b,
    incorrect: b.total - b.correct - b.unanswered,
    pct: b.total ? Math.round((b.correct / b.total) * 100) : 0
  })).sort((a, b) => a.pct - b.pct);

  return { total, correct, incorrect, unanswered, percent, competencyScores, perQuestion };
}

// ---------------------------------------------------------------------------
// Evidence-based competency update
// ---------------------------------------------------------------------------
function applyEvidence({ uid, sessionId, materialId, competencyScores, level }) {
  const now = new Date().toISOString();
  const required = requiredFor(level);
  const updates = [];

  const readState = db.prepare('SELECT * FROM competency_state WHERE uid = ? AND competency = ?');
  const insertEvidence = db.prepare(
    `INSERT INTO competency_evidence (uid, competency, category, session_id, material_id, source, correct, total, pct, weight, created_at)
     VALUES (?, ?, ?, ?, ?, 'ai-assessment', ?, ?, ?, ?, ?)`
  );
  const upsertState = db.prepare(
    `INSERT INTO competency_state (uid, competency, category, score, required, weight, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(uid, competency) DO UPDATE SET
       category = excluded.category, score = excluded.score,
       required = excluded.required, weight = excluded.weight, updated_at = excluded.updated_at`
  );
  const insertHistory = db.prepare(
    `INSERT INTO competency_history (uid, competency, previous_score, new_score, previous_weight, evidence_pct, evidence_total, evidence_weight, explanation, session_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const upsertGap = db.prepare(
    `INSERT INTO skill_gaps (uid, competency, category, current, required, gap, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(uid, competency) DO UPDATE SET
       category = excluded.category, current = excluded.current,
       required = excluded.required, gap = excluded.gap, updated_at = excluded.updated_at`
  );

  const run = db.transaction(() => {
    for (const cs of competencyScores) {
      const prior = readState.get(uid, cs.competency);
      const previousScore = prior ? prior.score : null;
      const priorWeight = prior ? Math.min(prior.weight, PRIOR_WEIGHT_CAP) : 0;
      const evidenceWeight = cs.total; // one question answered = one unit of evidence

      const newScore = priorWeight
        ? Math.round((previousScore * priorWeight + cs.pct * evidenceWeight) / (priorWeight + evidenceWeight))
        : cs.pct;

      const explanation = priorWeight
        ? `(${previousScore} × ${priorWeight} prior evidence + ${cs.pct} × ${evidenceWeight} new question${evidenceWeight === 1 ? '' : 's'}) ÷ ${priorWeight + evidenceWeight} = ${newScore}`
        : `First recorded evidence for this competency: ${cs.correct}/${cs.total} correct = ${cs.pct}%`;

      const totalWeight = (prior ? prior.weight : 0) + evidenceWeight;

      insertEvidence.run(uid, cs.competency, cs.category, sessionId, materialId, cs.correct, cs.total, cs.pct, evidenceWeight, now);
      upsertState.run(uid, cs.competency, cs.category, newScore, required, totalWeight, now);
      insertHistory.run(uid, cs.competency, previousScore, newScore, priorWeight, cs.pct, cs.total, evidenceWeight, explanation, sessionId, now);
      upsertGap.run(uid, cs.competency, cs.category, newScore, required, Math.max(0, required - newScore), now);

      updates.push({
        competency: cs.competency,
        category: cs.category,
        previousScore,
        newScore,
        delta: previousScore === null ? null : newScore - previousScore,
        evidencePct: cs.pct,
        evidenceCorrect: cs.correct,
        evidenceTotal: cs.total,
        priorWeight,
        explanation,
        isFirstEvidence: previousScore === null
      });
    }
  });
  run();

  return updates;
}

function getCompetencyState(uid) {
  return db.prepare('SELECT competency, category, score, required, weight, updated_at FROM competency_state WHERE uid = ? ORDER BY score ASC').all(uid);
}

function getSkillGaps(uid) {
  return db
    .prepare('SELECT competency, category, current, required, gap, updated_at FROM skill_gaps WHERE uid = ? ORDER BY gap DESC, current ASC')
    .all(uid)
    .map((g) => ({ ...g, formula: `${g.required} required − ${g.current} current = ${g.gap} point gap` }));
}

function getEvidence(uid, limit = 50) {
  return db
    .prepare('SELECT competency, category, correct, total, pct, weight, created_at, session_id FROM competency_evidence WHERE uid = ? ORDER BY id DESC LIMIT ?')
    .all(uid, limit);
}

function getHistory(uid, limit = 50) {
  return db
    .prepare('SELECT competency, previous_score, new_score, evidence_pct, evidence_total, explanation, created_at FROM competency_history WHERE uid = ? ORDER BY id DESC LIMIT ?')
    .all(uid, limit);
}

// ---------------------------------------------------------------------------
// Recommendations driven by the ACTUAL gaps above.
// Match = token overlap between the competency and each course's skill tags,
// title and description. Ranked by gap size first — biggest gap, highest priority.
// ---------------------------------------------------------------------------
// Words so common across this catalogue that matching on them alone means
// nothing. An overlap must include at least one distinctive term.
const GENERIC_TOKENS = new Set(['data', 'analysis', 'analytics', 'statistics', 'statistical', 'government', 'official', 'official-statistics', 'practice', 'essentials', 'foundations', 'basics']);

function courseTokens(course) {
  return new Set(tokenize(`${course.title} ${course.skillTags.join(' ')} ${course.description}`));
}

function recommendForGaps(gaps, limit = 6) {
  const catalogue = courses.map((c) => ({ course: c, tokens: courseTokens(c) }));
  const chosen = new Map();

  for (const gap of gaps) {
    if (gap.gap <= 0) continue;
    const gapTokens = tokenize(`${gap.competency} ${gap.category}`);
    if (!gapTokens.length) continue;

    for (const { course, tokens } of catalogue) {
      const overlap = gapTokens.filter((t) => tokens.has(t));
      const distinctive = overlap.filter((t) => !GENERIC_TOKENS.has(t));
      if (!distinctive.length) continue; // generic-word-only match is not a match
      const coverage = overlap.length / gapTokens.length;           // 0..1
      const match = Math.round(Math.min(97, 55 + coverage * 25 + gap.gap * 0.45));
      const existing = chosen.get(course.id);
      if (existing && existing.match >= match) continue;
      chosen.set(course.id, {
        id: course.id,
        title: course.title,
        provider: course.provider,
        duration: course.duration,
        skills: course.skillTags.join(', '),
        igotUrl: course.igotUrl,
        match,
        forCompetency: gap.competency,
        reason: `Recommended because your "${gap.competency}" score is ${gap.current}% against a required ${gap.required}% — a ${gap.gap} point gap. Matched on: ${distinctive.join(', ')}.`
      });
    }
  }

  return [...chosen.values()].sort((a, b) => b.match - a.match).slice(0, limit);
}

module.exports = {
  gradeSession,
  applyEvidence,
  getCompetencyState,
  getSkillGaps,
  getEvidence,
  getHistory,
  recommendForGaps,
  requiredFor,
  PRIOR_WEIGHT_CAP
};
