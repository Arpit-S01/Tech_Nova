// Thin wrapper around the TechNova backend. In development, CRA's "proxy" field
// in package.json forwards /api/* to the server (see server/README.md), so these
// calls can just use relative paths.

import { auth } from './firebase';

async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error || ''; } catch { /* ignore */ }
    throw new Error(detail || `Request to ${path} failed (${res.status})`);
  }
  return res.json();
}

export const startAssessment = (profile, level) =>
  request('/assessment/start', { method: 'POST', body: JSON.stringify({ profile, level }) });

export const submitAssessment = (attemptId, answers) =>
  request('/assessment/submit', { method: 'POST', body: JSON.stringify({ attemptId, answers }) });

export const getCourses = () => request('/courses');

export const getAdminSummary = () => request('/admin/summary');

// ---------------------------------------------------------------------------
// Authenticated calls (AI Assessment Studio)
//
// The backend identifies the user from a VERIFIED Firebase ID token, never from
// anything we put in the request body. So every call below attaches the current
// user's token in the Authorization header.
// ---------------------------------------------------------------------------
async function idToken() {
  const user = auth.currentUser;
  if (!user) throw new Error('You need to be signed in to use the Assessment Studio.');
  return user.getIdToken();
}

async function authedRequest(path, { method = 'GET', body, formData } = {}) {
  const token = await idToken();
  const headers = { Authorization: `Bearer ${token}` };
  if (body) headers['Content-Type'] = 'application/json';

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: formData || (body ? JSON.stringify(body) : undefined)
  });

  let payload = null;
  try { payload = await res.json(); } catch { /* non-JSON response */ }

  if (!res.ok) {
    const error = new Error((payload && payload.error) || `Request to ${path} failed (${res.status})`);
    error.code = payload && payload.code;
    error.status = res.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export const getHealth = () => request('/health');

export const listMaterials = () => authedRequest('/materials');

export const uploadMaterial = (file) => {
  const formData = new FormData();
  formData.append('file', file);
  return authedRequest('/materials/upload', { method: 'POST', formData });
};

export const getMaterialChunks = (materialId) => authedRequest(`/materials/${materialId}/chunks`);

export const createStudioSession = (payload) =>
  authedRequest('/studio/sessions', { method: 'POST', body: payload });

export const submitStudioSession = (sessionId, answers) =>
  authedRequest(`/studio/sessions/${sessionId}/submit`, { method: 'POST', body: { answers } });

export const getCompetencyProfile = () => authedRequest('/studio/profile');
