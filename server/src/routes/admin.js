const express = require('express');
const db = require('../db');

const router = express.Router();

// GET /api/admin/summary — replaces the dashboard's old hardcoded demo numbers
// (2,450 officials / 68% / etc.) with real aggregates over whatever attempts
// have actually been recorded in this SQLite database.
router.get('/summary', (req, res) => {
  const totalStarted = db.prepare('SELECT COUNT(*) AS n FROM attempts').get().n;
  const results = db.prepare('SELECT percent, gaps FROM results').all();

  const totalProfiled = results.length;
  const avgCompetency = totalProfiled
    ? Math.round(results.reduce((sum, r) => sum + r.percent, 0) / totalProfiled)
    : 0;

  const criticalGapSkills = new Set();
  for (const r of results) {
    const gaps = JSON.parse(r.gaps);
    for (const g of gaps) {
      if (g.current < 50) criticalGapSkills.add(g.skill);
    }
  }

  const completionRate = totalStarted ? Math.round((totalProfiled / totalStarted) * 100) : 0;

  res.json({
    officialsProfiled: totalProfiled,
    averageCompetency: avgCompetency,
    criticalGaps: criticalGapSkills.size,
    completionRate,
    sampleSize: totalProfiled,
    note: totalProfiled < 5 ? 'Small sample — figures will stabilise as more assessments are completed.' : null
  });
});

module.exports = router;
