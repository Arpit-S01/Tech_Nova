// Loads server/.env (never committed) and exposes typed config.
// The Anthropic key lives ONLY here, on the server. It is never sent to React.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const config = {
  port: Number(process.env.PORT || 4000),

  // Claude
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5',

  // Firebase Admin (token verification)
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID || '',
  firebaseServiceAccountPath: process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '',
  firebaseServiceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '',

  // Explicit, opt-in local escape hatch. OFF by default. When ON the server
  // prints a loud warning on every request and accepts a plain "dev:<uid>"
  // token so you can test the pipeline before wiring firebase-admin.
  // Never enable this anywhere but your own machine.
  authDevBypass: String(process.env.AUTH_DEV_BYPASS || '').toLowerCase() === 'true',

  // Uploads
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES || 15 * 1024 * 1024) // 15 MB
};

module.exports = config;
