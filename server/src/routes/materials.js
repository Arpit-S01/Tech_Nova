// Upload + analyse real learning material. Every route requires a verified
// Firebase token, and every row is scoped to the verified uid.

const express = require('express');
const crypto = require('crypto');
const multer = require('multer');

const db = require('../db');
const config = require('../env');
const { requireAuth } = require('../auth');
const { extractDocument, ExtractionError } = require('../documents');
const { sampleForAnalysis } = require('../retrieval');
const { analyseMaterial, AIError } = require('../claude');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter: (req, file, cb) => {
    const name = (file.originalname || '').toLowerCase();
    const ok =
      file.mimetype === 'application/pdf' ||
      file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      name.endsWith('.pdf') ||
      name.endsWith('.docx');
    cb(ok ? null : new ExtractionError('Only PDF (.pdf) and Word (.docx) files are supported.', 'UNSUPPORTED_TYPE'), ok);
  }
});

router.use(requireAuth);

function materialRow(row) {
  return {
    id: row.id,
    filename: row.filename,
    kind: row.kind,
    sizeBytes: row.size_bytes,
    pageCount: row.page_count,
    charCount: row.char_count,
    chunkCount: row.chunk_count,
    status: row.status,
    error: row.error,
    preview: row.preview,
    analysis: row.analysis ? JSON.parse(row.analysis) : null,
    createdAt: row.created_at
  };
}

// GET /api/materials — this user's uploads only
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM materials WHERE uid = ? ORDER BY created_at DESC').all(req.user.uid);
  res.json({ materials: rows.map(materialRow) });
});

// GET /api/materials/:id
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM materials WHERE id = ? AND uid = ?').get(req.params.id, req.user.uid);
  if (!row) return res.status(404).json({ error: 'Material not found.' });
  res.json({ material: materialRow(row) });
});

// GET /api/materials/:id/chunks — the real extracted text, for transparency
router.get('/:id/chunks', (req, res) => {
  const row = db.prepare('SELECT id FROM materials WHERE id = ? AND uid = ?').get(req.params.id, req.user.uid);
  if (!row) return res.status(404).json({ error: 'Material not found.' });
  const chunks = db
    .prepare('SELECT idx, page, section, label, text, char_count FROM material_chunks WHERE material_id = ? ORDER BY idx')
    .all(req.params.id);
  res.json({ chunks });
});

// POST /api/materials/upload  (multipart/form-data, field name "file")
// Extract real text -> store chunks with real page/section refs -> ask Claude
// which competencies the document actually covers.
router.post('/upload', upload.single('file'), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'No file received. Attach a PDF or DOCX in the "file" field.' });

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  let extracted;

  try {
    extracted = await extractDocument({
      buffer: req.file.buffer,
      filename: req.file.originalname,
      mimetype: req.file.mimetype
    });
  } catch (err) {
    if (err instanceof ExtractionError) return res.status(422).json({ error: err.message, code: err.code });
    return next(err);
  }

  db.transaction(() => {
    db.prepare(
      `INSERT INTO materials (id, uid, filename, kind, mime, size_bytes, page_count, char_count, chunk_count, status, preview, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'extracted', ?, ?)`
    ).run(id, req.user.uid, req.file.originalname, extracted.kind, req.file.mimetype, req.file.size,
      extracted.unitCount, extracted.charCount, extracted.chunks.length, extracted.preview, now);

    const insert = db.prepare(
      'INSERT INTO material_chunks (material_id, idx, page, section, label, text, char_count) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    for (const c of extracted.chunks) insert.run(id, c.idx, c.page, c.section, c.label, c.text, c.char_count);
  })();

  // Claude reads a sampled view of the REAL extracted text.
  try {
    const analysis = await analyseMaterial({
      filename: req.file.originalname,
      sample: sampleForAnalysis(extracted.chunks)
    });
    db.prepare("UPDATE materials SET analysis = ?, status = 'analyzed' WHERE id = ?").run(JSON.stringify(analysis), id);
  } catch (err) {
    const message = err instanceof AIError ? err.message : `Competency analysis failed: ${err.message}`;
    db.prepare("UPDATE materials SET status = 'failed', error = ? WHERE id = ?").run(message, id);
    return res.status(502).json({
      error: message,
      code: err.code || 'AI_FAILED',
      material: materialRow(db.prepare('SELECT * FROM materials WHERE id = ?').get(id))
    });
  }

  res.json({ material: materialRow(db.prepare('SELECT * FROM materials WHERE id = ?').get(id)) });
});

// Multer's own errors (size limit, file filter) arrive here.
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `File is too large. Maximum upload size is ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB.`, code: 'TOO_LARGE' });
    }
    return res.status(400).json({ error: err.message, code: err.code });
  }
  if (err instanceof ExtractionError) return res.status(415).json({ error: err.message, code: err.code });
  return next(err);
});

module.exports = router;
