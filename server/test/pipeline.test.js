// End-to-end test of the real pipeline with Claude STUBBED OUT.
//
// Why stub Claude? So this test can run without spending API credits and
// without a network connection. Everything else is real: real PDF/DOCX files,
// real pdf-parse/mammoth extraction, real chunking, real retrieval, the real
// SQLite database, real server-side grading and the real competency maths.
//
// Run with:  npm test        (from the server/ folder)

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');

process.env.AUTH_DEV_BYPASS = 'true';
process.env.ANTHROPIC_API_KEY = 'stub-key-not-used';
process.env.PORT = '4123';

// Use a throwaway database so the test never touches your real data.
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const testDbPath = path.join(dataDir, 'technova.sqlite');

// --- Stub the Claude module before anything requires it ---------------------
const claudePath = require.resolve('../src/claude');
const realClaude = require(claudePath);
const stub = {
  ...realClaude,
  async analyseMaterial({ filename, sample }) {
    assert.ok(sample.length > 500, 'Claude must receive the real extracted text');
    assert.ok(/\[(Page \d+|Section )/.test(sample), 'sample must carry real source labels');
    return {
      summary: `Stub analysis of ${filename}.`,
      concepts: ['sampling frame', 'non-response bias', 'design effect'],
      competencies: [
        { name: 'Survey Sampling', category: 'Statistical', keywords: ['sampling', 'stratified', 'systematic', 'frame'], evidence: 'Sampling is the process of selecting a subset of units', coverage: 'high' },
        { name: 'Data Quality', category: 'Statistical', keywords: ['completeness', 'uniqueness', 'plausibility', 'metadata'], evidence: 'A completeness check verifies', coverage: 'medium' }
      ],
      model: 'stub-model'
    };
  },
  async generateQuestions({ competency, entries, count }) {
    // Mimic Claude: build questions from the chunks it was actually handed.
    const questions = entries.slice(0, count).map((e, i) => ({
      question: `[${competency.name}] Stub question ${i + 1}?`,
      options: ['Correct option', 'Wrong A', 'Wrong B', 'Wrong C'],
      answer: 0,
      explanation: 'Because the source says so.',
      difficulty: 'Medium',
      competency: competency.name,
      category: competency.category,
      sourceChunkId: e.chunk.idx,
      sourceLabel: e.chunk.label,
      sourcePage: e.chunk.page,
      sourceSection: e.chunk.section,
      sourceQuote: e.chunk.text.slice(0, 80),
      sourceChunk: e.chunk.text
    }));
    return { questions, model: 'stub-model' };
  },
  async validateQuestions({ questions }) {
    // Reject one question to prove rejected items are dropped, not shown.
    return {
      verdicts: questions.map((q, i) => ({ index: i, supported: i !== 1, reason: i === 1 ? 'Stub rejection.' : 'Supported by source.' })),
      model: 'stub-model'
    };
  }
};
require.cache[claudePath] = { id: claudePath, filename: claudePath, loaded: true, exports: stub };

// --- Boot the real app ------------------------------------------------------
const config = require('../src/env');
const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json());
app.use('/api/materials', require('../src/routes/materials'));
app.use('/api/studio', require('../src/routes/studio'));
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

const TOKEN = 'Bearer dev:test-user';
const BASE = `http://localhost:${config.port}`;

function request(method, url, { body, raw, contentType } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${BASE}${url}`, {
      method,
      headers: {
        Authorization: TOKEN,
        ...(contentType ? { 'Content-Type': contentType } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {})
      }
    }, (res) => {
      let data = '';
      res.on('data', (d) => (data += d));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (raw) req.write(raw);
    else if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function multipart(filePath) {
  const boundary = '----technovatest' + Date.now();
  const name = path.basename(filePath);
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\n` +
    `Content-Type: ${name.endsWith('.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { body: Buffer.concat([head, fs.readFileSync(filePath), tail]), contentType: `multipart/form-data; boundary=${boundary}` };
}

const DOCS = path.join(__dirname, 'fixtures');

(async () => {
  const server = app.listen(config.port);
  let failures = 0;
  const check = (label, fn) => {
    try { fn(); console.log(`  PASS  ${label}`); }
    catch (err) { failures++; console.error(`  FAIL  ${label}\n        ${err.message}`); }
  };

  try {
    console.log('\n1. Upload a real PDF');
    const pdf = multipart(path.join(DOCS, 'Sampling_Methodology.pdf'));
    const up = await request('POST', '/api/materials/upload', { raw: pdf.body, contentType: pdf.contentType });
    check('upload succeeds', () => assert.strictEqual(up.status, 200));
    check('real text extracted', () => assert.ok(up.body.material.charCount > 2000));
    check('real page count', () => assert.strictEqual(up.body.material.pageCount, 4));
    check('competencies detected', () => assert.strictEqual(up.body.material.analysis.competencies.length, 2));
    const materialId = up.body.material.id;

    console.log('\n2. Chunks carry real source references');
    const chunks = await request('GET', `/api/materials/${materialId}/chunks`);
    check('chunk labels are real pages', () => assert.deepStrictEqual(chunks.body.chunks.map((c) => c.label), ['Page 1', 'Page 2', 'Page 3', 'Page 4']));
    check('chunk text is real document text', () => assert.ok(chunks.body.chunks[0].text.includes('Sampling is the process')));

    console.log('\n3. Generate a quiz');
    const gen = await request('POST', '/api/studio/sessions', { body: { materialId, count: 5, difficulty: 'Medium' } });
    check('generation succeeds', () => assert.strictEqual(gen.status, 200));
    check('invalid question was dropped', () => assert.ok(gen.body.rejected.length >= 1));
    check('kept = generated − rejected', () => assert.strictEqual(gen.body.kept, gen.body.generated - gen.body.rejected.length));
    check('NO correct answers leak to the browser', () => {
      for (const q of gen.body.questions) {
        assert.strictEqual(q.answer, undefined, 'question exposed "answer"');
        assert.strictEqual(q.sourceQuote, undefined, 'question exposed the source quote before submission');
      }
    });
    const sessionId = gen.body.sessionId;
    const questions = gen.body.questions;

    console.log('\n4. Submit — server grades, browser sends no score');
    const answers = {};
    questions.forEach((q, i) => { if (i < questions.length - 1) answers[q.id] = i === 0 ? 0 : 1; }); // 1 right, rest wrong, last unanswered
    const sub = await request('POST', `/api/studio/sessions/${sessionId}/submit`, { body: { answers, percent: 100, score: 999 } });
    check('submit succeeds', () => assert.strictEqual(sub.status, 200));
    check('server ignored the fake score in the body', () => assert.notStrictEqual(sub.body.score.percent, 100));
    check('counts add up', () => assert.strictEqual(sub.body.score.correct + sub.body.score.incorrect + sub.body.score.unanswered, sub.body.score.total));
    check('unanswered counted', () => assert.strictEqual(sub.body.score.unanswered, 1));
    check('percent = correct/total', () => assert.strictEqual(sub.body.score.percent, Math.round((sub.body.score.correct / sub.body.score.total) * 100)));
    check('review now includes source references', () => {
      assert.ok(sub.body.review.every((r) => r.source.reference.includes('Sampling_Methodology.pdf')));
      assert.ok(sub.body.review.every((r) => /Page \d+/.test(r.source.label)));
    });
    check('competency evidence recorded', () => assert.ok(sub.body.competencyUpdates.length > 0));
    check('gaps use required − current', () => sub.body.gaps.forEach((g) => assert.strictEqual(g.gap, Math.max(0, g.required - g.current))));

    console.log('\n5. Second assessment moves the score deterministically');
    const gen2 = await request('POST', '/api/studio/sessions', { body: { materialId, count: 5, difficulty: 'Easy' } });
    const allCorrect = {};
    gen2.body.questions.forEach((q) => { allCorrect[q.id] = 0; }); // stub always puts the answer at index 0
    const sub2 = await request('POST', `/api/studio/sessions/${gen2.body.sessionId}/submit`, { body: { answers: allCorrect } });
    check('perfect score on round 2', () => assert.strictEqual(sub2.body.score.percent, 100));
    check('scores moved up, not by a random amount', () => {
      const update = sub2.body.competencyUpdates[0];
      const expected = Math.round((update.previousScore * update.priorWeight + update.evidencePct * update.evidenceTotal) / (update.priorWeight + update.evidenceTotal));
      assert.strictEqual(update.newScore, expected, `expected ${expected}, got ${update.newScore}`);
      assert.ok(update.newScore > update.previousScore);
    });
    check('history explains the change', () => assert.ok(sub2.body.competencyUpdates[0].explanation.includes('÷')));

    console.log('\n6. Profile reflects real stored state');
    const profile = await request('GET', '/api/studio/profile');
    check('competency state persisted', () => assert.ok(profile.body.competencies.length >= 1));
    check('evidence trail persisted', () => assert.ok(profile.body.evidence.length >= 2));

    console.log('\n7. Ownership is enforced from the verified token');
    const otherUser = await new Promise((resolve) => {
      const req = http.request(`${BASE}/api/materials/${materialId}`, { method: 'GET', headers: { Authorization: 'Bearer dev:someone-else' } }, (res) => {
        let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve({ status: res.statusCode }));
      });
      req.end();
    });
    check("another user cannot read this user's material", () => assert.strictEqual(otherUser.status, 404));

    console.log('\n8. A scanned PDF is refused, not faked');
    const scan = multipart(path.join(DOCS, 'Scanned_Only.pdf'));
    const scanRes = await request('POST', '/api/materials/upload', { raw: scan.body, contentType: scan.contentType });
    check('scanned PDF rejected with a clear message', () => {
      assert.strictEqual(scanRes.status, 422);
      assert.strictEqual(scanRes.body.code, 'NO_TEXT_LAYER');
    });

    console.log('\n9. DOCX uses sections, never invented page numbers');
    const docx = multipart(path.join(DOCS, 'Data_Quality_Guide.docx'));
    const docxRes = await request('POST', '/api/materials/upload', { raw: docx.body, contentType: docx.contentType });
    check('docx upload succeeds', () => assert.strictEqual(docxRes.status, 200));
    const docxChunks = await request('GET', `/api/materials/${docxRes.body.material.id}/chunks`);
    check('docx chunks have sections and no page numbers', () => {
      assert.ok(docxChunks.body.chunks.length > 0, 'no chunks returned');
      assert.ok(docxChunks.body.chunks.every((c) => c.page === null));
      assert.ok(docxChunks.body.chunks.every((c) => c.label.startsWith('Section')));
    });

    console.log(failures ? `\n${failures} check(s) FAILED\n` : '\nAll checks passed.\n');
  } finally {
    server.close();
  }
  process.exit(failures ? 1 : 0);
})();
