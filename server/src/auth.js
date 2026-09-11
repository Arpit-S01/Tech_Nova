// Firebase ID-token verification for the backend.
//
// The browser sends:   Authorization: Bearer <firebase id token>
// We verify it with firebase-admin and take the user's identity from the
// VERIFIED token only. A user_id sent in a request body is never trusted.

const fs = require('fs');
const admin = require('firebase-admin');
const config = require('./env');
const db = require('./db');

let initialised = false;
let initError = null;

function initFirebase() {
  if (initialised || initError) return;
  try {
    let credential = null;

    if (config.firebaseServiceAccountJson) {
      credential = admin.credential.cert(JSON.parse(config.firebaseServiceAccountJson));
    } else if (config.firebaseServiceAccountPath) {
      if (!fs.existsSync(config.firebaseServiceAccountPath)) {
        throw new Error(`FIREBASE_SERVICE_ACCOUNT_PATH points at a file that does not exist: ${config.firebaseServiceAccountPath}`);
      }
      credential = admin.credential.cert(JSON.parse(fs.readFileSync(config.firebaseServiceAccountPath, 'utf8')));
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      credential = admin.credential.applicationDefault();
    } else {
      throw new Error('No Firebase Admin credentials configured. Set FIREBASE_SERVICE_ACCOUNT_PATH in server/.env.');
    }

    admin.initializeApp({ credential, projectId: config.firebaseProjectId || undefined });
    initialised = true;
    console.log('[auth] Firebase Admin initialised — ID tokens will be verified.');
  } catch (err) {
    initError = err;
    console.warn(`[auth] Firebase Admin NOT initialised: ${err.message}`);
  }
}

initFirebase();

if (config.authDevBypass) {
  console.warn('****************************************************************');
  console.warn('[auth] AUTH_DEV_BYPASS=true — tokens are NOT verified.');
  console.warn('[auth] This is a LOCAL DEVELOPMENT ONLY setting. Never deploy it.');
  console.warn('****************************************************************');
}

function upsertUser(user) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO app_users (uid, email, display_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(uid) DO UPDATE SET
       email = COALESCE(excluded.email, app_users.email),
       display_name = COALESCE(excluded.display_name, app_users.display_name),
       updated_at = excluded.updated_at`
  ).run(user.uid, user.email || null, user.name || null, now, now);
}

// Express middleware. On success sets req.user = { uid, email, name }.
async function requireAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

  if (!token) {
    return res.status(401).json({ error: 'Missing Authorization: Bearer <firebase id token> header.' });
  }

  // Local-only escape hatch, explicitly opted into via AUTH_DEV_BYPASS.
  if (config.authDevBypass && token.startsWith('dev:')) {
    const uid = token.slice(4) || 'dev-user';
    req.user = { uid, email: `${uid}@local.dev`, name: 'Local dev user' };
    upsertUser(req.user);
    return next();
  }

  if (!initialised) {
    return res.status(503).json({
      error: `Backend cannot verify Firebase tokens: ${initError ? initError.message : 'firebase-admin not initialised'}. See server/README.md.`
    });
  }

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = { uid: decoded.uid, email: decoded.email || null, name: decoded.name || null };
    upsertUser(req.user);
    return next();
  } catch (err) {
    return res.status(401).json({ error: `Invalid or expired sign-in token (${err.code || err.message}). Please sign in again.` });
  }
}

module.exports = { requireAuth, firebaseReady: () => initialised };
