require('./env');
const express = require('express');
const cors = require('cors');

const assessmentRoutes = require('./routes/assessment');
const coursesRoutes = require('./routes/courses');
const adminRoutes = require('./routes/admin');
const materialsRoutes = require('./routes/materials');
const studioRoutes = require('./routes/studio');
const config = require('./env');
const { firebaseReady } = require('./auth');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (req, res) =>
  res.json({
    ok: true,
    firebaseAdmin: firebaseReady(),
    claudeConfigured: Boolean(config.anthropicApiKey),
    model: config.anthropicModel,
    maxUploadMb: Math.round(config.maxUploadBytes / 1024 / 1024)
  })
);

// Existing routes — unchanged
app.use('/api/assessment', assessmentRoutes);
app.use('/api/courses', coursesRoutes);
app.use('/api/admin', adminRoutes);

// New document-grounded assessment pipeline (Firebase token required)
app.use('/api/materials', materialsRoutes);
app.use('/api/studio', studioRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(config.port, () => console.log(`TechNova API listening on http://localhost:${config.port}`));
