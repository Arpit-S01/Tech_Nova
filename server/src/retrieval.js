// Simple, explainable keyword/section retrieval — deliberately NOT a vector DB.
//
// Every chunk we hand to Claude for question generation is chosen by a score you
// can read and explain to a judge: term overlap (TF) weighted by how rare the
// term is across the document (IDF), plus a small bonus for exact phrase hits.

const STOPWORDS = new Set(
  ('a about above after again against all am an and any are as at be because been before being below between both but by ' +
   'can did do does doing down during each few for from further had has have having he her here hers him his how i if in ' +
   'into is it its itself just me more most my no nor not of off on once only or other our out over own same she should so ' +
   'some such than that the their them then there these they this those through to too under until up very was we were what ' +
   'when where which while who whom why will with you your').split(' ')
);

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

function buildIndex(chunks) {
  const docFreq = new Map();
  const chunkTerms = chunks.map((chunk) => {
    const counts = new Map();
    for (const term of tokenize(chunk.text)) counts.set(term, (counts.get(term) || 0) + 1);
    for (const term of counts.keys()) docFreq.set(term, (docFreq.get(term) || 0) + 1);
    return counts;
  });
  return { docFreq, chunkTerms, total: chunks.length };
}

// query: free text (competency name + its keywords). Returns top-k chunks with
// the score and the matched terms, so the reason for retrieval is inspectable.
function retrieve(chunks, query, k = 6) {
  if (!chunks.length) return [];
  const { docFreq, chunkTerms, total } = buildIndex(chunks);
  const queryTerms = [...new Set(tokenize(query))];
  const phrase = String(query || '').toLowerCase().trim();

  const scored = chunks.map((chunk, i) => {
    const counts = chunkTerms[i];
    let score = 0;
    const matched = [];
    for (const term of queryTerms) {
      const tf = counts.get(term) || 0;
      if (!tf) continue;
      const idf = Math.log(1 + total / (1 + (docFreq.get(term) || 0)));
      score += (1 + Math.log(tf)) * idf;
      matched.push(term);
    }
    if (phrase.length > 6 && chunk.text.toLowerCase().includes(phrase)) score += 3;
    return { chunk, score, matched };
  });

  const hits = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, k);

  // If a competency's wording doesn't literally appear (common for abstract
  // competency names), fall back to an even spread across the document rather
  // than returning nothing — but say so, so the behaviour stays transparent.
  if (!hits.length) {
    const step = Math.max(1, Math.floor(chunks.length / k));
    return chunks
      .filter((_, i) => i % step === 0)
      .slice(0, k)
      .map((chunk) => ({ chunk, score: 0, matched: [], fallback: true }));
  }
  return hits;
}

// A compact, evenly-sampled view of the whole document, used for the initial
// "what competencies does this material cover?" analysis.
function sampleForAnalysis(chunks, maxChars = 24000) {
  if (!chunks.length) return '';
  const parts = [];
  let used = 0;
  const step = Math.max(1, Math.ceil((chunks.length * 1200) / maxChars));
  for (let i = 0; i < chunks.length; i += step) {
    const chunk = chunks[i];
    const piece = `[${chunk.label}]\n${chunk.text}`;
    if (used + piece.length > maxChars) break;
    parts.push(piece);
    used += piece.length;
  }
  return parts.join('\n\n---\n\n');
}

module.exports = { retrieve, sampleForAnalysis, tokenize };
