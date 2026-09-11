const { courses } = require('./courses');

// Every question category (as produced by questionBank.js) rolls up into one of
// these four buckets, matching the four competency areas the dashboard displays.
const BUCKET_MAP = {
  'Statistical foundations': 'Statistical',
  'Applied statistics': 'Statistical',
  'Data practice': 'Statistical',
  'Data quality': 'Statistical',
  'Labour statistics': 'Statistical',
  Demography: 'Statistical',
  'Economic statistics': 'Statistical',
  'Health statistics': 'Statistical',
  Agriculture: 'Statistical',
  PLFS: 'Statistical',
  CPI: 'Statistical',
  ASI: 'Statistical',
  HCES: 'Statistical',
  'National Accounts': 'Statistical',
  'Demographic statistics': 'Statistical',
  Python: 'Technical',
  SQL: 'Technical',
  R: 'Technical',
  Excel: 'Technical',
  'Data visualization': 'Technical',
  'Machine learning': 'Technical',
  'Digital systems': 'Technical',
  'Dashboard / MIS': 'Technical',
  'Data governance': 'Digital governance',
  'Digital governance': 'Digital governance',
  'Data dissemination': 'Digital governance',
  'Data validation': 'Digital governance',
  'Data communication': 'Behavioural & managerial'
};
const BUCKET_TONE = { Statistical: 'blue', Technical: 'orange', 'Digital governance': 'purple', 'Behavioural & managerial': 'green' };
const BUCKET_ORDER = ['Statistical', 'Technical', 'Digital governance', 'Behavioural & managerial'];
const GAP_THRESHOLD = 70; // a category scoring below this is flagged as a skill gap
const REQUIRED_LEVEL = 75; // target level shown alongside each gap

function bucketFor(category) {
  return BUCKET_MAP[category] || 'Statistical';
}

// questions: full question objects (with `answer`) as generated for this attempt.
// answers: { [questionId]: selectedOptionIndex }
function gradeAttempt(questions, answers) {
  let score = 0;
  const byCategory = {};
  for (const q of questions) {
    const selected = answers ? answers[q.id] : undefined;
    const correct = selected === q.answer;
    if (correct) score++;
    if (!byCategory[q.category]) byCategory[q.category] = { correct: 0, total: 0 };
    byCategory[q.category].total++;
    if (correct) byCategory[q.category].correct++;
  }
  const total = questions.length;
  const percent = total ? Math.round((score / total) * 100) : 0;

  const categoryScores = Object.entries(byCategory).map(([category, { correct, total: catTotal }]) => ({
    category,
    bucket: bucketFor(category),
    correct,
    total: catTotal,
    pct: catTotal ? Math.round((correct / catTotal) * 100) : 0
  }));

  const gaps = categoryScores
    .filter(c => c.pct < GAP_THRESHOLD)
    .sort((a, b) => a.pct - b.pct)
    .map(c => ({ skill: c.category, category: c.bucket, current: c.pct, required: REQUIRED_LEVEL }));

  const competencies = BUCKET_ORDER.map(bucket => {
    const inBucket = categoryScores.filter(c => c.bucket === bucket);
    const value = inBucket.length
      ? Math.round(inBucket.reduce((sum, c) => sum + c.pct, 0) / inBucket.length)
      : Math.max(40, percent); // fallback if no question from this bucket was asked
    return [bucket, value, BUCKET_TONE[bucket]];
  });

  const readiness = Math.round(competencies.reduce((sum, [, value]) => sum + value, 0) / competencies.length);

  const recommendations = matchCourses(gaps);

  return { score, total, percent, categoryScores, gaps, competencies, readiness, recommendations };
}

// Matches courses to the weakest skills first. A course can satisfy more than one
// gap; each is only recommended once, at its best (highest) match score.
function matchCourses(gaps, limit = 6) {
  const byId = new Map();
  for (const gap of gaps) {
    const matches = courses.filter(c =>
      c.skillTags.some(tag => tag.toLowerCase() === gap.skill.toLowerCase())
    );
    for (const course of matches) {
      const match = Math.max(70, Math.min(97, 100 - gap.current + 20));
      const reason = `Recommended because your ${gap.skill} score was ${gap.current}% (target ${gap.required}%).`;
      const existing = byId.get(course.id);
      if (!existing || match > existing.match) {
        byId.set(course.id, {
          title: course.title,
          duration: course.duration,
          skills: course.skillTags.join(', '),
          reason,
          match,
          igotUrl: course.igotUrl,
          provider: course.provider
        });
      }
    }
  }
  return [...byId.values()].sort((a, b) => b.match - a.match).slice(0, limit);
}

module.exports = { gradeAttempt, bucketFor, GAP_THRESHOLD, REQUIRED_LEVEL };
