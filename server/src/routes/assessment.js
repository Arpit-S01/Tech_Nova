const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { createAssessment, stripAnswers } = require('../questionBank');
const { gradeAttempt } = require('../scoring');

const router = express.Router();

// POST /api/assessment/start  { profile, level }
// Generates a 20-question set server-side and stores the full (answer-bearing)
// version keyed by attemptId. Only the answer-stripped version goes to the client.
router.post('/start', (req, res) => {
  const { profile, level } = req.body || {};
  if (!profile || typeof profile !== 'object') {
    return res.status(400).json({ error: 'profile is required' });
  }
  const questions = createAssessment(profile, level);
  const attemptId = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    'INSERT INTO attempts (id, profile, level, questions, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(attemptId, JSON.stringify(profile), level || 'Intermediate', JSON.stringify(questions), now);

  res.json({ attemptId, questions: stripAnswers(questions) });
});

// POST /api/assessment/submit  { attemptId, answers: { [questionId]: selectedIndex } }
// Grades against the server-stored answer key, computes gaps/competencies/
// recommendations, and persists the result.
router.post('/submit', (req, res) => {
  const { attemptId, answers } = req.body || {};
  if (!attemptId || typeof answers !== 'object') {
    return res.status(400).json({ error: 'attemptId and answers are required' });
  }
  const attempt = db.prepare('SELECT * FROM attempts WHERE id = ?').get(attemptId);
  if (!attempt) {
    return res.status(404).json({ error: 'Unknown attemptId — start a new assessment.' });
  }

  const questions = JSON.parse(attempt.questions);
  const result = gradeAttempt(questions, answers);
  const now = new Date().toISOString();

  db.prepare('UPDATE attempts SET submitted_at = ? WHERE id = ?').run(now, attemptId);
  db.prepare(
    `INSERT INTO results (attempt_id, score, total, percent, category_scores, gaps, competencies, readiness, created_at)
     VALUES (@attemptId, @score, @total, @percent, @categoryScores, @gaps, @competencies, @readiness, @createdAt)
     ON CONFLICT(attempt_id) DO UPDATE SET
       score=excluded.score, total=excluded.total, percent=excluded.percent,
       category_scores=excluded.category_scores, gaps=excluded.gaps,
       competencies=excluded.competencies, readiness=excluded.readiness, created_at=excluded.created_at`
  ).run({
    attemptId,
    score: result.score,
    total: result.total,
    percent: result.percent,
    categoryScores: JSON.stringify(result.categoryScores),
    gaps: JSON.stringify(result.gaps),
    competencies: JSON.stringify(result.competencies),
    readiness: result.readiness,
    createdAt: now
  });

  res.json(result);
});

module.exports = router;
