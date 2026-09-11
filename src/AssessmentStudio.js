// AI Assessment Studio — the real, document-grounded assessment loop.
//
// Upload a real PDF/DOCX -> the backend extracts its real text -> Claude detects
// the competencies actually covered -> questions are generated only from the
// retrieved chunks -> the backend grades, records evidence, updates competency
// scores, recomputes skill gaps and re-ranks learning recommendations.
//
// This component holds no question bank, no answer key and no scoring logic.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, ArrowRight, BookOpen, BrainCircuit, CheckCircle2, ChevronRight,
  FileText, Loader2, Quote, RefreshCw, Sparkles, Target, TrendingUp, Upload, XCircle
} from 'lucide-react';
import {
  createStudioSession, getCompetencyProfile, getMaterialChunks, listMaterials,
  submitStudioSession, uploadMaterial
} from './api';

const COUNTS = [5, 10, 15];
const DIFFICULTIES = ['Easy', 'Medium', 'Hard', 'Mixed'];
const MAX_MB = 15;

function Banner({ tone = 'error', title, children, onDismiss }) {
  const Icon = tone === 'error' ? AlertTriangle : Sparkles;
  return (
    <div className={`studio-banner ${tone}`}>
      <Icon size={19}/>
      <div>
        {title && <b>{title}</b>}
        <p>{children}</p>
      </div>
      {onDismiss && <button className="studio-dismiss" onClick={onDismiss} aria-label="Dismiss">×</button>}
    </div>
  );
}

function Steps({ current }) {
  const steps = ['Upload material', 'Extract & detect', 'Configure', 'Take assessment', 'Results & update'];
  return (
    <ol className="studio-steps">
      {steps.map((label, i) => (
        <li key={label} className={i < current ? 'done' : i === current ? 'active' : ''}>
          <span>{i < current ? <CheckCircle2 size={15}/> : i + 1}</span>{label}
        </li>
      ))}
    </ol>
  );
}

export default function AssessmentStudio() {
  const [stage, setStage] = useState('upload');          // upload | configure | quiz | results
  const [materials, setMaterials] = useState([]);
  const [material, setMaterial] = useState(null);
  const [chunks, setChunks] = useState([]);
  const [showText, setShowText] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [uploadStep, setUploadStep] = useState('');
  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const [count, setCount] = useState(5);
  const [difficulty, setDifficulty] = useState('Mixed');
  const [selectedCompetencies, setSelectedCompetencies] = useState([]);

  const [session, setSession] = useState(null);
  const [answers, setAnswers] = useState({});
  const [questionIndex, setQuestionIndex] = useState(0);
  const [result, setResult] = useState(null);
  const [profile, setProfile] = useState(null);

  const fileInput = useRef(null);

  const refreshMaterials = useCallback(async () => {
    try { setMaterials((await listMaterials()).materials); } catch { /* not signed in yet */ }
  }, []);

  useEffect(() => { refreshMaterials(); }, [refreshMaterials]);
  useEffect(() => {
    getCompetencyProfile().then(setProfile).catch(() => setProfile(null));
  }, [result]);

  // -------------------------------------------------------------------------
  async function openMaterial(row) {
    setError(null);
    setMaterial(row);
    setSelectedCompetencies((row.analysis?.competencies || []).map((c) => c.name));
    setStage('configure');
    setShowText(false);
    try { setChunks((await getMaterialChunks(row.id)).chunks); } catch { setChunks([]); }
    window.scrollTo(0, 0);
  }

  async function handleFile(file) {
    if (!file) return;
    setError(null);
    if (file.size > MAX_MB * 1024 * 1024) {
      setError({ title: 'File too large', message: `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB. The maximum upload size is ${MAX_MB} MB.` });
      return;
    }
    setUploading(true);
    setUploadStep(`Reading "${file.name}"…`);
    try {
      setUploadStep('Extracting text and keeping page / section references…');
      const { material: uploaded } = await uploadMaterial(file);
      setUploadStep('Identifying the competencies this document actually covers…');
      await refreshMaterials();
      await openMaterial(uploaded);
    } catch (err) {
      setError({
        title: err.code === 'NO_TEXT_LAYER' ? 'No readable text in this file'
          : err.code === 'NO_API_KEY' ? 'Claude is not configured on the server'
          : 'Upload failed',
        message: err.message
      });
      await refreshMaterials();
    } finally {
      setUploading(false);
      setUploadStep('');
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function generate() {
    setError(null);
    setGenerating(true);
    try {
      const created = await createStudioSession({
        materialId: material.id,
        count,
        difficulty,
        competencies: selectedCompetencies
      });
      setSession(created);
      setAnswers({});
      setQuestionIndex(0);
      setResult(null);
      setStage('quiz');
      window.scrollTo(0, 0);
    } catch (err) {
      setError({ title: 'Question generation failed', message: err.message });
    } finally {
      setGenerating(false);
    }
  }

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      // Only the selections go to the server. No score is calculated here.
      const graded = await submitStudioSession(session.sessionId, answers);
      setResult(graded);
      setStage('results');
      window.scrollTo(0, 0);
    } catch (err) {
      setError({ title: 'Could not submit', message: err.message });
    } finally {
      setSubmitting(false);
    }
  }

  function restart() {
    setStage('upload'); setSession(null); setResult(null); setAnswers({});
    setMaterial(null); setChunks([]); setError(null); window.scrollTo(0, 0);
  }

  const stageIndex = { upload: 0, configure: 2, quiz: 3, results: 4 }[stage];

  return (
    <>
      <div className="jury-heading">
        <div>
          <span className="jury-kicker">AI ASSESSMENT STUDIO</span>
          <h1>Assess yourself on your own learning material</h1>
          <p>Upload a real PDF or Word document. TechNova reads its actual text, detects the competencies it covers, and generates questions only from what the document says.</p>
        </div>
        {stage !== 'upload' && <button className="jury-secondary" onClick={restart}><RefreshCw size={15}/> Start over</button>}
      </div>

      <Steps current={stageIndex}/>

      {error && <Banner title={error.title} onDismiss={() => setError(null)}>{error.message}</Banner>}

      {stage === 'upload' && (
        <UploadStage
          fileInput={fileInput} uploading={uploading} uploadStep={uploadStep}
          onFile={handleFile} materials={materials} onOpen={openMaterial}
        />
      )}

      {stage === 'configure' && material && (
        <ConfigureStage
          material={material} chunks={chunks} showText={showText} setShowText={setShowText}
          count={count} setCount={setCount} difficulty={difficulty} setDifficulty={setDifficulty}
          selected={selectedCompetencies} setSelected={setSelectedCompetencies}
          generating={generating} onGenerate={generate} onBack={() => setStage('upload')}
        />
      )}

      {stage === 'quiz' && session && (
        <QuizStage
          session={session} answers={answers} setAnswers={setAnswers}
          index={questionIndex} setIndex={setQuestionIndex}
          submitting={submitting} onSubmit={submit}
        />
      )}

      {stage === 'results' && result && (
        <ResultsStage result={result} profile={profile} onAgain={() => setStage('configure')} onRestart={restart}/>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// 1. Upload
// ---------------------------------------------------------------------------
function UploadStage({ fileInput, uploading, uploadStep, onFile, materials, onOpen }) {
  const [dragging, setDragging] = useState(false);
  return (
    <>
      <section
        className={`studio-drop${dragging ? ' dragging' : ''}${uploading ? ' busy' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); onFile(e.dataTransfer.files?.[0]); }}
      >
        {uploading ? (
          <>
            <Loader2 className="studio-spin" size={34}/>
            <h2>Processing your document</h2>
            <p>{uploadStep}</p>
            <ul className="studio-progress-list">
              <li>Reading the file</li>
              <li>Extracting the real text layer</li>
              <li>Keeping every page / section reference</li>
              <li>Detecting covered competencies</li>
            </ul>
          </>
        ) : (
          <>
            <span className="studio-drop-icon"><Upload size={26}/></span>
            <h2>Upload a learning document</h2>
            <p>Drag a file here, or choose one from your computer.</p>
            <button className="jury-primary" onClick={() => fileInput.current?.click()}>
              <FileText size={16}/> Choose PDF or DOCX
            </button>
            <input
              ref={fileInput} type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              style={{ display: 'none' }} onChange={(e) => onFile(e.target.files?.[0])}
            />
            <small>PDF or DOCX · up to {MAX_MB} MB · the text layer is read on the server. Scanned/image-only PDFs cannot be read (no OCR) and will be refused rather than guessed at.</small>
          </>
        )}
      </section>

      {materials.length > 0 && (
        <section className="jury-card studio-library">
          <div className="jury-card-title">
            <div>
              <h2>Your uploaded materials</h2>
              <p>Documents you have uploaded to your account. Only you can see these.</p>
            </div>
          </div>
          <div className="studio-material-list">
            {materials.map((m) => (
              <button key={m.id} className="studio-material" onClick={() => m.status === 'analyzed' && onOpen(m)} disabled={m.status !== 'analyzed'}>
                <FileText size={20}/>
                <div>
                  <b>{m.filename}</b>
                  <small>
                    {m.kind === 'pdf' ? `${m.pageCount} page${m.pageCount === 1 ? '' : 's'}` : `${m.pageCount} section${m.pageCount === 1 ? '' : 's'}`}
                    {' · '}{m.charCount.toLocaleString()} characters extracted
                    {' · '}{m.chunkCount} chunks
                    {m.status !== 'analyzed' && ' · analysis failed'}
                  </small>
                </div>
                {m.status === 'analyzed' ? <ChevronRight size={17}/> : <XCircle size={17}/>}
              </button>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// 2. Detected competencies + configuration
// ---------------------------------------------------------------------------
function ConfigureStage({ material, chunks, showText, setShowText, count, setCount, difficulty, setDifficulty, selected, setSelected, generating, onGenerate, onBack }) {
  const analysis = material.analysis || { competencies: [], concepts: [] };
  const toggle = (name) => setSelected(selected.includes(name) ? selected.filter((x) => x !== name) : [...selected, name]);

  return (
    <>
      <section className="jury-card">
        <div className="jury-card-title">
          <div>
            <h2><FileText size={17}/> {material.filename}</h2>
            <p>
              {material.kind === 'pdf'
                ? `${material.pageCount} page${material.pageCount === 1 ? '' : 's'} · page numbers are taken from the PDF itself`
                : `${material.pageCount} section${material.pageCount === 1 ? '' : 's'} · Word files have no fixed pages, so questions reference sections`}
              {' · '}{material.charCount.toLocaleString()} characters of real text · {material.chunkCount} retrievable chunks
            </p>
          </div>
          <button className="jury-text-button" onClick={() => setShowText(!showText)}>
            {showText ? 'Hide extracted text' : 'View extracted text'} <ChevronRight size={14}/>
          </button>
        </div>

        {analysis.summary && <p className="studio-summary">{analysis.summary}</p>}

        {showText && (
          <div className="studio-extract">
            {chunks.map((c) => (
              <article key={c.idx}>
                <b>{c.label}</b>
                <p>{c.text}</p>
              </article>
            ))}
            {!chunks.length && <p>Could not load the extracted text.</p>}
          </div>
        )}
      </section>

      <section className="jury-card">
        <div className="jury-card-title">
          <div>
            <h2>Detected competencies</h2>
            <p>Identified from the text of this document. Select the ones you want to be assessed on.</p>
          </div>
        </div>
        <div className="studio-competency-grid">
          {analysis.competencies.map((c) => (
            <button key={c.name} className={`studio-competency${selected.includes(c.name) ? ' selected' : ''}`} onClick={() => toggle(c.name)}>
              <div className="studio-competency-head">
                <b>{c.name}</b>
                <span className={`studio-coverage ${c.coverage}`}>{c.coverage} coverage</span>
              </div>
              <small>{c.category}</small>
              {c.evidence && <p className="studio-evidence"><Quote size={12}/> “{c.evidence}”</p>}
              <p className="studio-keywords">{(c.keywords || []).slice(0, 6).join(' · ')}</p>
            </button>
          ))}
        </div>
        {!!analysis.concepts?.length && (
          <p className="studio-concepts"><b>Concepts found in this document:</b> {analysis.concepts.join(' · ')}</p>
        )}
      </section>

      <section className="jury-card">
        <div className="jury-card-title">
          <div>
            <h2>Assessment configuration</h2>
            <p>Questions are generated live from this document each time — nothing is pre-written.</p>
          </div>
        </div>
        <div className="studio-config">
          <div>
            <span>Number of questions</span>
            <div className="studio-chips">
              {COUNTS.map((n) => <button key={n} className={count === n ? 'selected' : ''} onClick={() => setCount(n)}>{n}</button>)}
            </div>
          </div>
          <div>
            <span>Difficulty</span>
            <div className="studio-chips">
              {DIFFICULTIES.map((d) => <button key={d} className={difficulty === d ? 'selected' : ''} onClick={() => setDifficulty(d)}>{d}</button>)}
            </div>
          </div>
        </div>
        <div className="jury-actions-row">
          <button className="jury-secondary" onClick={onBack} disabled={generating}><ArrowLeft size={15}/> Back</button>
          <button className="jury-primary" onClick={onGenerate} disabled={generating || !selected.length}>
            {generating
              ? <><Loader2 className="studio-spin" size={16}/> Generating from your document…</>
              : <><BrainCircuit size={16}/> Generate {count} question{count === 1 ? '' : 's'}</>}
          </button>
        </div>
        {!selected.length && <p className="studio-hint">Select at least one competency to generate questions.</p>}
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// 3. Quiz — one question at a time. No answers are present in this data.
// ---------------------------------------------------------------------------
function QuizStage({ session, answers, setAnswers, index, setIndex, submitting, onSubmit }) {
  const questions = session.questions;
  const q = questions[index];
  const answered = Object.keys(answers).length;
  const isLast = index === questions.length - 1;

  return (
    <>
      {(session.rejected?.length > 0 || session.notes?.length > 0) && (
        <Banner tone="info" title="Grounding check">
          {session.generated} question{session.generated === 1 ? ' was' : 's were'} generated and {session.kept} passed the check that the answer is supported by your document.
          {session.rejected?.length > 0 && ` ${session.rejected.length} were discarded rather than shown to you.`}
          {session.notes?.length > 0 && ` ${session.notes.join(' ')}`}
        </Banner>
      )}

      <section className="jury-card studio-quiz">
        <div className="studio-quiz-head">
          <div>
            <span className="studio-pill">{q.competency}</span>
            <span className="studio-pill muted">{q.difficulty}</span>
          </div>
          <div className="jury-counter">Question {index + 1} of {questions.length}<small>{answered} answered</small></div>
        </div>

        <div className="studio-progress"><i style={{ width: `${((index + 1) / questions.length) * 100}%` }}/></div>

        <h2 className="studio-question">{q.question}</h2>

        <div className="studio-options">
          {q.options.map((option, n) => (
            <label key={option + n} className={answers[q.id] === n ? 'selected' : ''}>
              <input type="radio" name={q.id} checked={answers[q.id] === n} onChange={() => setAnswers({ ...answers, [q.id]: n })}/>
              <span className="studio-letter">{String.fromCharCode(65 + n)}</span>
              <span>{option}</span>
            </label>
          ))}
        </div>

        <p className="studio-hint">The correct answer, the explanation and the exact source reference are kept on the server until you submit.</p>

        <div className="jury-actions-row">
          <button className="jury-secondary" onClick={() => setIndex(index - 1)} disabled={index === 0 || submitting}>
            <ArrowLeft size={15}/> Previous
          </button>
          {isLast
            ? <button className="jury-primary" onClick={onSubmit} disabled={submitting}>
                {submitting ? <><Loader2 className="studio-spin" size={16}/> Grading on the server…</> : <>Submit assessment <CheckCircle2 size={16}/></>}
              </button>
            : <button className="jury-primary" onClick={() => setIndex(index + 1)}>Next <ArrowRight size={16}/></button>}
        </div>

        <div className="studio-dots">
          {questions.map((item, i) => (
            <button key={item.id} className={`${i === index ? 'current' : ''}${answers[item.id] !== undefined ? ' done' : ''}`} onClick={() => setIndex(i)}>{i + 1}</button>
          ))}
        </div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// 4. Results — everything below comes from the server's calculation.
// ---------------------------------------------------------------------------
function ResultsStage({ result, profile, onAgain, onRestart }) {
  const { score, competencyScores, competencyUpdates, gaps, recommendations, review, material } = result;

  return (
    <>
      <section className="jury-card studio-score">
        <div className="studio-score-value">
          <strong>{score.percent}%</strong>
          <span>{score.correct} of {score.total} correct</span>
          <small>{score.formula} · calculated on the server</small>
        </div>
        <div className="studio-score-breakdown">
          <div><b>{score.correct}</b><span>Correct</span></div>
          <div><b>{score.incorrect}</b><span>Incorrect</span></div>
          <div><b>{score.unanswered}</b><span>Unanswered</span></div>
        </div>
      </section>

      <section className="jury-card studio-perf">
        <div className="jury-card-title">
          <div><h2>Competency-wise performance</h2><p>How you did on each competency assessed from {material?.filename}.</p></div>
        </div>
        <div className="jury-competencies">
          {competencyScores.map((c) => (
            <div className="jury-bar" key={c.competency}>
              <div><span>{c.competency}</span><b>{c.pct}%</b></div>
              <i><em className={c.pct >= 75 ? 'green' : c.pct >= 50 ? 'orange' : 'red'} style={{ width: `${c.pct}%` }}/></i>
              <small>{c.correct}/{c.total} correct{c.unanswered ? ` · ${c.unanswered} unanswered` : ''}</small>
            </div>
          ))}
        </div>
      </section>

      <section className="jury-card">
        <div className="jury-card-title">
          <div>
            <h2><TrendingUp size={17}/> Competency update</h2>
            <p>Each score is a weighted average of the evidence recorded for it — not a fixed increment.</p>
          </div>
        </div>
        <div className="studio-updates">
          {competencyUpdates.map((u) => (
            <article key={u.competency}>
              <div className="studio-update-head">
                <b>{u.competency}</b>
                <span>
                  {u.isFirstEvidence
                    ? <><em>new</em> → {u.newScore}</>
                    : <>{u.previousScore} → <strong>{u.newScore}</strong> <em className={u.delta >= 0 ? 'up' : 'down'}>{u.delta >= 0 ? '+' : ''}{u.delta}</em></>}
                </span>
              </div>
              <p className="studio-formula">{u.explanation}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="jury-card">
        <div className="jury-card-title">
          <div><h2><Target size={17}/> Updated skill gaps</h2><p>gap = required competency − current competency</p></div>
        </div>
        <div className="studio-gap-list">
          {gaps.map((g) => (
            <div key={g.competency} className={`studio-gap${g.gap === 0 ? ' met' : ''}`}>
              <div><b>{g.competency}</b><small>{g.category}</small></div>
              <div className="studio-gap-nums">
                <span>{g.current}<small>current</small></span>
                <span>{g.required}<small>required</small></span>
                <strong className={g.gap === 0 ? 'met' : ''}>{g.gap === 0 ? 'Met' : `−${g.gap}`}<small>gap</small></strong>
              </div>
              <p className="studio-formula">{g.formula}</p>
            </div>
          ))}
          {!gaps.length && <p>No competency evidence recorded yet.</p>}
        </div>
      </section>

      {recommendations.length > 0 && (
        <section className="jury-card">
          <div className="jury-card-title">
            <div><h2><BookOpen size={17}/> Updated learning recommendations</h2><p>Driven by the gaps above. Course links open iGOT Karmayogi.</p></div>
          </div>
          <div className="studio-rec-list">
            {recommendations.map((r) => (
              <article key={r.id}>
                <div className="studio-rec-head"><b>{r.title}</b><span>{r.match}% match</span></div>
                <small>{r.provider} · {r.duration} · {r.skills}</small>
                <p>{r.reason}</p>
                <button className="jury-text-button" onClick={() => window.open(r.igotUrl, '_blank', 'noopener,noreferrer')}>
                  Open on iGOT Karmayogi <ChevronRight size={14}/>
                </button>
              </article>
            ))}
          </div>
          <p className="studio-hint">Course links point at the iGOT Karmayogi portal. The catalogue entries in <code>server/src/courses.js</code> use placeholder course IDs until real iGOT course URLs are added — see <code>server/README.md</code>.</p>
        </section>
      )}

      <section className="jury-card">
        <div className="jury-card-title">
          <div><h2>Answer review with source references</h2><p>Every question is traced back to the exact place in your document that supports the answer.</p></div>
        </div>
        <div className="studio-review">
          {review.map((r) => (
            <article key={r.id} className={r.isCorrect ? 'correct' : r.answered ? 'wrong' : 'skipped'}>
              <div className="studio-review-head">
                <span>{r.isCorrect ? <CheckCircle2 size={17}/> : <XCircle size={17}/>} Question {r.number}</span>
                <small>{r.competency} · {r.difficulty}</small>
              </div>
              <h3>{r.question}</h3>
              <ul className="studio-review-options">
                {r.options.map((option, n) => (
                  <li key={option + n} className={`${n === r.answer ? 'is-answer' : ''}${n === r.selected && n !== r.answer ? ' is-selected-wrong' : ''}`}>
                    <b>{String.fromCharCode(65 + n)}</b> {option}
                    {n === r.answer && <em>correct answer</em>}
                    {n === r.selected && n !== r.answer && <em>your answer</em>}
                  </li>
                ))}
              </ul>
              {!r.answered && <p className="studio-skipped-note">You did not answer this question.</p>}
              {r.explanation && <p className="studio-explanation">{r.explanation}</p>}
              <div className="studio-source">
                <b>Source: {r.source.reference}</b>
                {r.source.quote && <p><Quote size={12}/> “{r.source.quote}”</p>}
              </div>
            </article>
          ))}
        </div>
      </section>

      {profile?.method && (
        <section className="jury-card studio-method">
          <h2>How these numbers were calculated</h2>
          <ul>
            <li><b>Score:</b> {score.formula}. Calculated on the server against the stored answer key — the browser never sends a score.</li>
            <li><b>Competency update:</b> {profile.method.update}. Prior evidence weight is capped at {profile.method.priorWeightCap} questions.</li>
            <li><b>Skill gap:</b> {profile.method.gap}</li>
            <li><b>Recommendations:</b> ranked by gap size and term overlap with the course catalogue; every reason lists the terms that matched.</li>
          </ul>
        </section>
      )}

      <div className="jury-actions-row">
        <button className="jury-secondary" onClick={onRestart}><Upload size={15}/> Upload another document</button>
        <button className="jury-primary" onClick={onAgain}><RefreshCw size={16}/> Generate a new assessment from this document</button>
      </div>
    </>
  );
}
