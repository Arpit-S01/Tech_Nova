require('dotenv').config({
  path: require('path').join(__dirname, '..', '.env')
});

const config = {
  port: Number(process.env.PORT || 4000),

  // Gemini
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',

  // Firebase Admin
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID || '',
  firebaseServiceAccountPath:
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '',
  firebaseServiceAccountJson:
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '',

  authDevBypass:
    String(process.env.AUTH_DEV_BYPASS || '').toLowerCase() === 'true',

  maxUploadBytes:
    Number(process.env.MAX_UPLOAD_BYTES || 15 * 1024 * 1024)
};

module.exports = config;