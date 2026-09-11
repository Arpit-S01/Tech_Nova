import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

// These values come from YOUR Firebase project (console.firebase.google.com):
// Project settings → General → Your apps → SDK setup and configuration.
// They are safe to ship in client-side code (Firebase's web config is not a
// secret — access is controlled by Firebase Auth + your security rules, not
// by hiding these values). Put the real values in a `.env.local` file at the
// project root (see `.env.example`); Create React App loads any REACT_APP_*
// variable from there automatically and it's gitignored by default.
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
