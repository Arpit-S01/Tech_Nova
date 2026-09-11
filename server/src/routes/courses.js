const express = require('express');
const { courses } = require('../courses');

const router = express.Router();

// GET /api/courses — full catalogue (used for browsing; recommendations come
// back inline with assessment results instead of requiring a second lookup).
router.get('/', (req, res) => {
  res.json({ courses });
});

module.exports = router;
