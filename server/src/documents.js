// Real text extraction from real uploaded files.
//
// PDF  -> pdf-parse, page by page, so every chunk keeps its true page number.
// DOCX -> mammoth -> HTML, so headings give us true section names (we never
//         invent page numbers for a DOCX; Word files have no fixed pages).
//
// If a PDF is a scan / image-only, there is no text layer to extract. We detect
// that and fail loudly instead of pretending extraction worked.

// pdf-parse's index.js runs a debug block that reads a demo file and crashes;
// requiring the library file directly is the standard, documented workaround.
const pdfParse = require('pdf-parse/lib/pdf-parse.js');
const mammoth = require('mammoth');

const TARGET_CHUNK_CHARS = 1100;   // ~250-300 words: big enough to ground an MCQ
const MIN_CHUNK_CHARS = 120;       // shorter fragments get merged into neighbours
const MIN_USABLE_CHARS = 400;      // below this the document has no usable text

class ExtractionError extends Error {
  constructor(message, code = 'EXTRACTION_FAILED') {
    super(message);
    this.code = code;
  }
}

function squash(text) {
  return String(text || '')
    .replace(/\r/g, '\n')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------
async function extractPdf(buffer, filename) {
  const pages = [];

  // pdf-parse calls this once per page, in order.
  const pagerender = (pageData) =>
    pageData.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false }).then((content) => {
      let lastY = null;
      let line = '';
      const lines = [];
      for (const item of content.items) {
        const y = item.transform ? item.transform[5] : null;
        if (lastY !== null && y !== null && Math.abs(lastY - y) > 1) {
          lines.push(line);
          line = '';
        }
        line += item.str;
        lastY = y;
      }
      lines.push(line);
      const pageText = squash(lines.join('\n'));
      pages.push(pageText);
      return pageText;
    });

  let parsed;
  try {
    parsed = await pdfParse(buffer, { pagerender });
  } catch (err) {
    throw new ExtractionError(`This PDF could not be read (${err.message}). It may be corrupted or password-protected.`, 'PDF_UNREADABLE');
  }

  const totalChars = pages.join('').replace(/\s/g, '').length;
  if (totalChars < MIN_USABLE_CHARS) {
    throw new ExtractionError(
      `No selectable text could be extracted from "${filename}". It has ${parsed.numpages} page(s) but appears to be a scanned or image-only PDF. ` +
      'TechNova reads the real text layer of a document — it does not run OCR, and it will not invent questions for a document it cannot read. ' +
      'Please upload a text-based PDF (exported from Word/LaTeX, or run OCR on the scan first) or a DOCX file.',
      'NO_TEXT_LAYER'
    );
  }

  const blocks = [];
  pages.forEach((text, i) => {
    if (!text) return;
    blocks.push({ page: i + 1, section: null, label: `Page ${i + 1}`, text });
  });

  return { kind: 'pdf', unitCount: parsed.numpages || pages.length, blocks };
}

// ---------------------------------------------------------------------------
// DOCX
// ---------------------------------------------------------------------------
function stripTags(html) {
  return squash(
    html
      .replace(/<\/(p|li|h[1-6]|tr)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
  );
}

async function extractDocx(buffer, filename) {
  let html;
  try {
    html = (await mammoth.convertToHtml({ buffer })).value;
  } catch (err) {
    throw new ExtractionError(`This DOCX could not be read (${err.message}). It may be corrupted, or saved in the older .doc format.`, 'DOCX_UNREADABLE');
  }

  const plain = stripTags(html);
  if (plain.replace(/\s/g, '').length < MIN_USABLE_CHARS) {
    throw new ExtractionError(
      `Almost no text could be extracted from "${filename}". If the content is made of images or embedded objects, TechNova cannot read it (no OCR).`,
      'NO_TEXT_LAYER'
    );
  }

  // Walk the HTML top-level elements, tracking the most recent heading so each
  // paragraph is attributed to a REAL section title from the document.
  const blocks = [];
  let currentSection = 'Introduction';
  let sectionNumber = 1;
  const seenSections = new Map();
  const elementRe = /<(h[1-6]|p|ul|ol|table)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = elementRe.exec(html)) !== null) {
    const tag = match[1].toLowerCase();
    const text = stripTags(match[2]);
    if (!text) continue;
    if (/^h[1-6]$/.test(tag)) {
      currentSection = text.slice(0, 120);
      if (!seenSections.has(currentSection)) seenSections.set(currentSection, ++sectionNumber);
      continue;
    }
    blocks.push({ page: null, section: currentSection, label: `Section “${currentSection}”`, text });
  }

  if (!blocks.length) {
    blocks.push({ page: null, section: 'Document body', label: 'Section “Document body”', text: plain });
  }

  // Merge consecutive paragraphs that share a section so chunking stays clean.
  const merged = [];
  for (const block of blocks) {
    const last = merged[merged.length - 1];
    if (last && last.section === block.section) last.text += `\n${block.text}`;
    else merged.push({ ...block });
  }

  return { kind: 'docx', unitCount: new Set(merged.map((b) => b.section)).size, blocks: merged };
}

// ---------------------------------------------------------------------------
// Chunking — never merges across a page/section boundary, so every chunk has
// exactly one true source reference.
// ---------------------------------------------------------------------------
function chunkBlocks(blocks) {
  const chunks = [];
  for (const block of blocks) {
    const paragraphs = block.text.split(/\n+/).map((p) => p.trim()).filter(Boolean);
    let buffer = '';
    const flush = () => {
      const text = buffer.trim();
      buffer = '';
      if (text.length < MIN_CHUNK_CHARS && chunks.length && chunks[chunks.length - 1].label === block.label) {
        chunks[chunks.length - 1].text += `\n${text}`;
        return;
      }
      if (!text) return;
      chunks.push({ page: block.page, section: block.section, label: block.label, text });
    };
    for (const paragraph of paragraphs) {
      if (buffer && (buffer.length + paragraph.length) > TARGET_CHUNK_CHARS) flush();
      buffer += (buffer ? '\n' : '') + paragraph;
      if (buffer.length >= TARGET_CHUNK_CHARS) flush();
    }
    flush();
  }
  return chunks.map((c, i) => ({ ...c, idx: i, char_count: c.text.length }));
}

async function extractDocument({ buffer, filename, mimetype }) {
  const lower = String(filename || '').toLowerCase();
  const isPdf = mimetype === 'application/pdf' || lower.endsWith('.pdf');
  const isDocx =
    mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || lower.endsWith('.docx');

  if (!isPdf && !isDocx) {
    throw new ExtractionError('Only PDF (.pdf) and Word (.docx) files are supported.', 'UNSUPPORTED_TYPE');
  }
  if (lower.endsWith('.doc') && !lower.endsWith('.docx')) {
    throw new ExtractionError('Legacy .doc files are not supported — re-save the file as .docx and upload again.', 'UNSUPPORTED_TYPE');
  }

  const extracted = isPdf ? await extractPdf(buffer, filename) : await extractDocx(buffer, filename);
  const chunks = chunkBlocks(extracted.blocks);
  const fullText = chunks.map((c) => c.text).join('\n\n');

  if (!chunks.length) {
    throw new ExtractionError(`No readable text blocks were found in "${filename}".`, 'NO_TEXT_LAYER');
  }

  return {
    kind: extracted.kind,
    unitCount: extracted.unitCount,
    chunks,
    charCount: fullText.length,
    preview: fullText.slice(0, 1200)
  };
}

module.exports = { extractDocument, ExtractionError };
