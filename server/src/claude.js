// All Claude API usage. Server-side only — the API key never leaves this process.
//
// Three jobs:
//   1. analyseMaterial()   — what competencies/concepts does this document cover?
//   2. generateQuestions() — MCQs written ONLY from supplied document chunks.
//   3. validateQuestions() — second pass: is each answer actually supported by
//                            the quoted source chunk? Unsupported items are dropped.
//
// If any of this fails we throw. We never fall back to canned questions.

const Anthropic = require('@anthropic-ai/sdk');
const config = require('./env');

class AIError extends Error {
  constructor(message, code = 'AI_FAILED') {
    super(message);
    this.code = code;
  }
}

let client = null;
function getClient() {
  if (!config.anthropicApiKey) {
    throw new AIError(
      'ANTHROPIC_API_KEY is not set in server/.env, so no questions can be generated. ' +
      'TechNova will not substitute pre-written questions.',
      'NO_API_KEY'
    );
  }
  if (!client) client = new Anthropic({ apiKey: config.anthropicApiKey });
  return client;
}

function extractJson(text) {
  const trimmed = String(text || '').trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : trimmed;
  const start = candidate.search(/[[{]/);
  if (start === -1) throw new AIError('Claude did not return JSON.', 'BAD_AI_RESPONSE');
  const opening = candidate[start];
  const closing = opening === '[' ? ']' : '}';
  const end = candidate.lastIndexOf(closing);
  if (end === -1) throw new AIError('Claude returned truncated JSON.', 'BAD_AI_RESPONSE');
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch (err) {
    throw new AIError(`Could not parse Claude's JSON response: ${err.message}`, 'BAD_AI_RESPONSE');
  }
}

async function ask({ system, prompt, maxTokens = 4000 }) {
  let response;
  try {
    response = await getClient().messages.create({
      model: config.anthropicModel,
      max_tokens: maxTokens,
      temperature: 0,
      system,
      messages: [{ role: 'user', content: prompt }]
    });
  } catch (err) {
    if (err instanceof AIError) throw err;
    const status = err.status ? ` (HTTP ${err.status})` : '';
    throw new AIError(`Claude request failed${status}: ${err.message}`, 'AI_REQUEST_FAILED');
  }
  const text = (response.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  if (!text.trim()) throw new AIError('Claude returned an empty response.', 'BAD_AI_RESPONSE');
  return { text, usage: response.usage, model: response.model };
}

// ---------------------------------------------------------------------------
// 1. Competency / concept detection
// ---------------------------------------------------------------------------
const CATEGORIES = ['Statistical', 'Technical', 'Digital governance', 'Behavioural & managerial'];

async function analyseMaterial({ filename, sample }) {
  const system =
    'You analyse training material for India\'s Official Statistical System and identify the competencies it actually teaches. ' +
    'You only describe what is genuinely present in the supplied text. You never invent topics that are not in the text. ' +
    'You reply with strict JSON and nothing else.';

  const prompt = `Below is text extracted from an uploaded learning document called "${filename}". Each block is prefixed with its real source reference in square brackets.

<document>
${sample}
</document>

Identify the competencies this document can actually be used to assess.

Return strict JSON only, in this exact shape:
{
  "summary": "2-3 sentence factual summary of what this document covers",
  "competencies": [
    {
      "name": "short competency name (2-5 words)",
      "category": "one of: ${CATEGORIES.join(' | ')}",
      "keywords": ["5-10 distinctive terms that appear in the document for this competency"],
      "evidence": "one short quoted phrase copied verbatim from the document",
      "coverage": "high" | "medium" | "low"
    }
  ],
  "concepts": ["8-15 specific concepts/terms actually defined or discussed in the document"]
}

Rules:
- Between 3 and 8 competencies. If the document only supports fewer, return fewer.
- Every keyword and every concept must literally appear in the text above.
- "evidence" must be copied verbatim from the text above.
- No markdown, no commentary, JSON only.`;

  const { text, model } = await ask({ system, prompt, maxTokens: 2500 });
  const parsed = extractJson(text);
  const competencies = Array.isArray(parsed.competencies) ? parsed.competencies : [];
  if (!competencies.length) {
    throw new AIError('Claude could not identify any assessable competency in this document.', 'NO_COMPETENCIES');
  }
  return {
    summary: String(parsed.summary || '').trim(),
    concepts: (Array.isArray(parsed.concepts) ? parsed.concepts : []).map(String).slice(0, 20),
    competencies: competencies.slice(0, 8).map((c) => ({
      name: String(c.name || '').trim().slice(0, 80),
      category: CATEGORIES.includes(c.category) ? c.category : 'Statistical',
      keywords: (Array.isArray(c.keywords) ? c.keywords : []).map(String).slice(0, 12),
      evidence: String(c.evidence || '').trim().slice(0, 400),
      coverage: ['high', 'medium', 'low'].includes(c.coverage) ? c.coverage : 'medium'
    })).filter((c) => c.name),
    model
  };
}

// ---------------------------------------------------------------------------
// 2. Grounded MCQ generation
// ---------------------------------------------------------------------------
function renderChunks(entries) {
  return entries
    .map((e) => `<chunk id="${e.chunk.idx}" source="${e.chunk.label}">\n${e.chunk.text}\n</chunk>`)
    .join('\n\n');
}

async function generateQuestions({ filename, competency, entries, count, difficulty }) {
  const system =
    'You write multiple-choice assessment questions for government statistical officers. ' +
    'You write questions ONLY from the supplied document chunks. ' +
    'If a fact is not stated in a chunk, you must not ask about it. ' +
    'You reply with strict JSON and nothing else.';

  const difficultyNote = {
    Easy: 'Easy: recall of a definition or fact stated plainly in the chunk.',
    Medium: 'Medium: requires understanding or applying something explained in the chunk.',
    Hard: 'Hard: requires reasoning across details within the supplied chunks.',
    Mixed: 'Mixed: vary between easy, medium and hard across the set.'
  }[difficulty] || 'Mixed: vary difficulty across the set.';

  const prompt = `Document: "${filename}"
Competency being assessed: "${competency.name}" (${competency.category})

These are the ONLY source chunks you may use. Each has an id and its real source reference:

${renderChunks(entries)}

Write exactly ${count} multiple-choice question(s) assessing "${competency.name}", using only the chunks above.

Difficulty: ${difficultyNote}

Return strict JSON only:
{
  "questions": [
    {
      "question": "the question text",
      "options": ["option A", "option B", "option C", "option D"],
      "answer": 0,
      "explanation": "why the correct option is correct, referring to what the chunk says",
      "difficulty": "Easy" | "Medium" | "Hard",
      "sourceChunkId": <the id of the chunk this question comes from>,
      "sourceQuote": "a verbatim sentence from that chunk that proves the correct answer"
    }
  ]
}

Hard rules:
- Exactly 4 options per question. "answer" is the 0-based index of the correct one.
- The correct answer MUST be provable from "sourceQuote", and "sourceQuote" MUST be copied word-for-word from the chunk with id "sourceChunkId".
- Distractors must be plausible but clearly wrong according to the chunk.
- Never use outside knowledge. Never ask about anything absent from the chunks.
- Do not reference "the document", "the chunk" or "the passage" in the question text — write it as a standalone knowledge question.
- No markdown, JSON only.`;

  const { text, model } = await ask({ system, prompt, maxTokens: 1000 + count * 700 });
  const parsed = extractJson(text);
  const raw = Array.isArray(parsed.questions) ? parsed.questions : [];
  const allowed = new Map(entries.map((e) => [e.chunk.idx, e.chunk]));

  const questions = [];
  for (const q of raw) {
    const options = Array.isArray(q.options) ? q.options.map((o) => String(o).trim()).filter(Boolean) : [];
    const answer = Number(q.answer);
    const chunk = allowed.get(Number(q.sourceChunkId));
    if (!q.question || options.length !== 4) continue;
    if (!Number.isInteger(answer) || answer < 0 || answer > 3) continue;
    if (!chunk) continue;
    questions.push({
      question: String(q.question).trim(),
      options,
      answer,
      explanation: String(q.explanation || '').trim(),
      difficulty: ['Easy', 'Medium', 'Hard'].includes(q.difficulty) ? q.difficulty : (difficulty === 'Mixed' ? 'Medium' : difficulty),
      competency: competency.name,
      category: competency.category,
      sourceChunkId: chunk.idx,
      sourceLabel: chunk.label,
      sourcePage: chunk.page,
      sourceSection: chunk.section,
      sourceQuote: String(q.sourceQuote || '').trim(),
      sourceChunk: chunk.text
    });
  }
  return { questions, model };
}

// ---------------------------------------------------------------------------
// 3. Grounding validation — a separate pass, so a bad question gets dropped
//    rather than shown to the user.
// ---------------------------------------------------------------------------
async function validateQuestions({ questions, chunksById }) {
  if (!questions.length) return { verdicts: [], model: config.anthropicModel };

  const system =
    'You are a strict fact-checker. You verify that each multiple-choice question is answerable purely from its source text. ' +
    'You reply with strict JSON and nothing else.';

  const items = questions.map((q, i) => {
    const source = chunksById.get(q.sourceChunkId);
    return `<item index="${i}">
<source reference="${q.sourceLabel}">
${source ? source.text : ''}
</source>
<question>${q.question}</question>
<options>${q.options.map((o, n) => `${n}. ${o}`).join(' | ')}</options>
<claimed_answer>${q.answer}. ${q.options[q.answer]}</claimed_answer>
</item>`;
  }).join('\n\n');

  const prompt = `Check each item below. For each one decide:
- supported: true only if the claimed answer is clearly correct according to the source text alone, AND no other option is also correct.
- reason: one short sentence.

${items}

Return strict JSON only:
{ "verdicts": [ { "index": 0, "supported": true, "reason": "..." } ] }

Judge only against the supplied source text. Do not use outside knowledge. JSON only.`;

  const { text, model } = await ask({ system, prompt, maxTokens: 200 + questions.length * 160 });
  const parsed = extractJson(text);
  const verdicts = Array.isArray(parsed.verdicts) ? parsed.verdicts : [];
  return { verdicts, model };
}

module.exports = { analyseMaterial, generateQuestions, validateQuestions, AIError, CATEGORIES };
