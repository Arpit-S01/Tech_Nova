// Gemini-powered AI service for TechNova.
// Server-side only — the API key never leaves this process.
//
// Three jobs:
// 1. analyseMaterial()
// 2. generateQuestions()
// 3. validateQuestions()

const { GoogleGenAI } = require('@google/genai');
const config = require('./env');

class AIError extends Error {
  constructor(message, code = 'AI_FAILED') {
    super(message);
    this.code = code;
  }
}

let client = null;

function getClient() {
  if (!config.geminiApiKey) {
    throw new AIError(
      'GEMINI_API_KEY is not set in server/.env, so no questions can be generated.',
      'NO_API_KEY'
    );
  }

  if (!client) {
    client = new GoogleGenAI({
      apiKey: config.geminiApiKey
    });
  }

  return client;
}

function extractJson(text) {
  const trimmed = String(text || '').trim();

  // Remove markdown code fences if Gemini adds them
  const cleaned = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  // Find the JSON object or array
  const objectStart = cleaned.indexOf('{');
  const arrayStart = cleaned.indexOf('[');

  let start;

  if (objectStart === -1 && arrayStart === -1) {
    throw new AIError(
      'Gemini did not return JSON.',
      'BAD_AI_RESPONSE'
    );
  }

  if (objectStart === -1) {
    start = arrayStart;
  } else if (arrayStart === -1) {
    start = objectStart;
  } else {
    start = Math.min(objectStart, arrayStart);
  }

  let candidate = cleaned.slice(start).trim();

  // Remove trailing commas before } or ]
  candidate = candidate.replace(/,\s*([}\]])/g, '$1');

  try {
    return JSON.parse(candidate);
  } catch (firstError) {
    // Try extracting the outermost JSON structure
    const firstObject = candidate.indexOf('{');
    const lastObject = candidate.lastIndexOf('}');
    const firstArray = candidate.indexOf('[');
    const lastArray = candidate.lastIndexOf(']');

    let extracted = candidate;

    if (
      firstArray !== -1 &&
      lastArray !== -1 &&
      (firstObject === -1 || firstArray < firstObject)
    ) {
      extracted = candidate.slice(firstArray, lastArray + 1);
    } else if (firstObject !== -1 && lastObject !== -1) {
      extracted = candidate.slice(firstObject, lastObject + 1);
    }

    extracted = extracted.replace(/,\s*([}\]])/g, '$1');

    try {
      return JSON.parse(extracted);
    } catch (secondError) {
      throw new AIError(
        `Could not parse Gemini JSON response: ${secondError.message}`,
        'BAD_AI_RESPONSE'
      );
    }
  }
}

async function ask({
  system,
  prompt,
  maxTokens = 4000,
  responseSchema = null
}) {
  try {
    const response = await getClient().models.generateContent({
      model: config.geminiModel,
      contents: `${system}\n\n${prompt}`,
      config: {
  temperature: 0,
  maxOutputTokens: maxTokens,
  responseMimeType: 'application/json',
  ...(responseSchema ? { responseSchema } : {})
}
    });

    const text = response.text || '';

    if (!text.trim()) {
      throw new AIError(
        'Gemini returned an empty response.',
        'BAD_AI_RESPONSE'
      );
    }

    return {
      text,
      model: config.geminiModel
    };
  } catch (err) {
    if (err instanceof AIError) {
      throw err;
    }

    throw new AIError(
      `Gemini request failed: ${err.message}`,
      'AI_REQUEST_FAILED'
    );
  }
}

const CATEGORIES = [
  'Statistical',
  'Technical',
  'Digital governance',
  'Behavioural & managerial'
];

// ------------------------------------------------------------
// 1. Competency / concept detection
// ------------------------------------------------------------

async function analyseMaterial({ filename, sample }) {
  const system =
    "You analyse training material for India's Official Statistical System " +
    "and identify the competencies it actually teaches. " +
    "Only describe what is genuinely present in the supplied text. " +
    "Never invent topics that are not in the text. " +
    "Return strict JSON only.";

  const prompt = `Below is text extracted from an uploaded learning document called "${filename}".

<document>
${sample}
</document>

Identify the competencies this document can actually be used to assess.

Return this exact JSON structure:

{
  "summary": "2-3 sentence factual summary",
  "competencies": [
    {
      "name": "short competency name",
      "category": "one of: ${CATEGORIES.join(' | ')}",
      "keywords": ["terms appearing in the document"],
      "evidence": "short phrase copied from the document",
      "coverage": "high"
    }
  ],
  "concepts": ["specific concepts appearing in the document"]
}

Rules:
- Between 3 and 8 competencies when supported by the document.
- Every keyword and concept must appear in the supplied text.
- Evidence must be copied from the supplied text.
- Do not use outside knowledge.
- JSON only.`;
const responseSchema = {
  type: 'object',
  properties: {
    summary: {
      type: 'string'
    },
    competencies: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          category: { type: 'string' },
          keywords: {
            type: 'array',
            items: { type: 'string' }
          },
          evidence: { type: 'string' },
          coverage: { type: 'string' }
        },
        required: [
          'name',
          'category',
          'keywords',
          'evidence',
          'coverage'
        ]
      }
    },
    concepts: {
      type: 'array',
      items: { type: 'string' }
    }
  },
  required: [
    'summary',
    'competencies',
    'concepts'
  ]
};

  const { text, model } = await ask({
  system,
  prompt,
  maxTokens: 2500,
  responseSchema
});

  const parsed = extractJson(text);

  const competencies = Array.isArray(parsed.competencies)
    ? parsed.competencies
    : [];

  if (!competencies.length) {
    throw new AIError(
      'Gemini could not identify any assessable competency in this document.',
      'NO_COMPETENCIES'
    );
  }

  return {
    summary: String(parsed.summary || '').trim(),

    concepts: (
      Array.isArray(parsed.concepts)
        ? parsed.concepts
        : []
    ).map(String).slice(0, 20),

    competencies: competencies
      .slice(0, 8)
      .map((c) => ({
        name: String(c.name || '')
          .trim()
          .slice(0, 80),

        category: CATEGORIES.includes(c.category)
          ? c.category
          : 'Statistical',

        keywords: (
          Array.isArray(c.keywords)
            ? c.keywords
            : []
        ).map(String).slice(0, 12),

        evidence: String(c.evidence || '')
          .trim()
          .slice(0, 400),

        coverage: ['high', 'medium', 'low'].includes(c.coverage)
          ? c.coverage
          : 'medium'
      }))
      .filter((c) => c.name),

    model
  };
}

// ------------------------------------------------------------
// 2. Grounded MCQ generation
// ------------------------------------------------------------

function renderChunks(entries) {
  return entries
    .map(
      (e) =>
        `<chunk id="${e.chunk.idx}" source="${e.chunk.label}">
${e.chunk.text}
</chunk>`
    )
    .join('\n\n');
}

async function generateQuestions({
  filename,
  competency,
  entries,
  count,
  difficulty
}) {
  const system =
    'You write multiple-choice assessment questions for government ' +
    'statistical officers. You write questions ONLY from the supplied ' +
    'document chunks. If a fact is not stated in a chunk, you must not ' +
    'ask about it. Return strict JSON only.';

  const difficultyNote = {
    Easy: 'Recall a definition or fact stated plainly in the source.',
    Medium: 'Test understanding or application of something explained in the source.',
    Hard: 'Require reasoning using details within the supplied source.',
    Mixed: 'Mix easy, medium and hard questions.'
  }[difficulty] || 'Mix easy, medium and hard questions.';

  const prompt = `Document: "${filename}"

Competency:
"${competency.name}" (${competency.category})

ONLY use the following source chunks:

${renderChunks(entries)}

Generate exactly ${count} multiple-choice question(s).

Difficulty:
${difficultyNote}

Return:

{
  "questions": [
    {
      "question": "question text",
      "options": [
        "option A",
        "option B",
        "option C",
        "option D"
      ],
      "answer": 0,
      "explanation": "why the answer is correct",
      "difficulty": "Easy",
      "sourceChunkId": 1,
      "sourceQuote": "verbatim supporting sentence"
    }
  ]
}

Rules:
- Exactly four options.
- answer is a 0-based index.
- Exactly one option must be correct.
- The correct answer must be supported by sourceQuote.
- sourceQuote must be copied word-for-word from the source chunk.
- Distractors must be plausible but incorrect according to the source.
- Never use outside knowledge.
- Do not invent facts.
- No "all of the above".
- No "none of the above".
- JSON only.`;

  const responseSchema = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: {
            type: 'string'
          },
          options: {
            type: 'array',
            items: {
              type: 'string'
            }
          },
          answer: {
            type: 'integer'
          },
          explanation: {
            type: 'string'
          },
          difficulty: {
            type: 'string'
          },
          sourceChunkId: {
            type: 'integer'
          },
          sourceQuote: {
            type: 'string'
          }
        },
        required: [
          'question',
          'options',
          'answer',
          'explanation',
          'difficulty',
          'sourceChunkId',
          'sourceQuote'
        ]
      }
    }
  },
  required: ['questions']
};

const { text, model } = await ask({
  system,
  prompt,
  maxTokens: 1000 + count * 700,
  responseSchema
});

  const parsed = extractJson(text);

  const raw = Array.isArray(parsed.questions)
    ? parsed.questions
    : [];

  const allowed = new Map(
    entries.map((e) => [e.chunk.idx, e.chunk])
  );

  const questions = [];

  for (const q of raw) {
    const options = Array.isArray(q.options)
      ? q.options.map((o) => String(o).trim()).filter(Boolean)
      : [];

    const answer = Number(q.answer);

    const chunk = allowed.get(Number(q.sourceChunkId));

    if (!q.question || options.length !== 4) continue;

    if (
      !Number.isInteger(answer) ||
      answer < 0 ||
      answer > 3
    ) {
      continue;
    }

    if (!chunk) continue;

    questions.push({
      question: String(q.question).trim(),
      options,
      answer,

      explanation: String(q.explanation || '').trim(),

      difficulty:
        ['Easy', 'Medium', 'Hard'].includes(q.difficulty)
          ? q.difficulty
          : difficulty === 'Mixed'
            ? 'Medium'
            : difficulty,

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

  return {
    questions,
    model
  };
}

// ------------------------------------------------------------
// 3. Grounding validation
// ------------------------------------------------------------

async function validateQuestions({
  questions,
  chunksById
}) {
  if (!questions.length) {
    return {
      verdicts: [],
      model: config.geminiModel
    };
  }

  const system =
    'You are a strict fact-checker. Verify that each multiple-choice ' +
    'question is answerable purely from its supplied source text. ' +
    'Return strict JSON only.';

  const items = questions
    .map((q, i) => {
      const source = chunksById.get(q.sourceChunkId);

      return `<item index="${i}">
<source reference="${q.sourceLabel}">
${source ? source.text : ''}
</source>

<question>
${q.question}
</question>

<options>
${q.options.map((o, n) => `${n}. ${o}`).join(' | ')}
</options>

<claimed_answer>
${q.answer}. ${q.options[q.answer]}
</claimed_answer>
</item>`;
    })
    .join('\n\n');

  const prompt = `Check each question.

For each item:
- supported = true only if the claimed answer is clearly correct according to the source text alone.
- No other option may also be correct.
- reason = one short sentence.

${items}

Return:

{
  "verdicts": [
    {
      "index": 0,
      "supported": true,
      "reason": "short explanation"
    }
  ]
}

Do not use outside knowledge.
JSON only.`;

  const { text, model } = await ask({
    system,
    prompt,
    maxTokens: 200 + questions.length * 160
  });

  const parsed = extractJson(text);

  return {
    verdicts: Array.isArray(parsed.verdicts)
      ? parsed.verdicts
      : [],
    model
  };
}

module.exports = {
  analyseMaterial,
  generateQuestions,
  validateQuestions,
  AIError,
  CATEGORIES
};