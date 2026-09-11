import { useEffect, useState } from 'react';
import { Award, BarChart3, BookOpen, BrainCircuit, CheckCircle2, ChevronRight, ClipboardCheck, GraduationCap, Info, LayoutDashboard, Lightbulb, LogOut, ShieldCheck, Sparkles, Target, TrendingUp, Users } from 'lucide-react';
import { getAdminSummary } from './api';
import AssessmentStudio from './AssessmentStudio';

const tabs = [
  ['overview', 'Overview', LayoutDashboard], ['gaps', 'Skill gaps', TrendingUp], ['learning', 'Learning', GraduationCap], ['studio', 'Assessment studio', BrainCircuit], ['admin', 'Admin insight', Users], ['about', 'About', Info]
];

function progress(value) { return `${Math.max(0, Math.min(100, value))}%`; }
function Stat({ icon: Icon, label, value, detail, tone = 'blue' }) { return <article className={`jury-stat ${tone}`}><span className="jury-stat-icon"><Icon size={21}/></span><p>{label}</p><strong>{value}</strong><small>{detail}</small></article>; }
function Bar({ label, value, note, tone = 'blue' }) { return <div className="jury-bar"><div><span>{label}</span><b>{value}%</b></div><i><em className={tone} style={{ width: progress(value) }}/></i>{note && <small>{note}</small>}</div>; }

export default function JuryDashboard({ account, profile, result, onRetake, onReset }) {
  const [tab, setTab] = useState('overview');
  const [selectedGap, setSelectedGap] = useState(null);
  const [showNav, setShowNav] = useState(false);
  // All of this used to be computed client-side from a formula. It now comes
  // straight from the backend's grading of the actual submitted answers.
  const assessment = result.percent;
  const data = { competencies: result.competencies, gaps: result.gaps, readiness: result.readiness };
  const courses = result.recommendations;
  const changeTab = (next) => { setTab(next); setShowNav(false); setSelectedGap(null); window.scrollTo(0, 0); };

  return <div className="jury-app">
    <aside className={showNav ? 'jury-sidebar open' : 'jury-sidebar'}><div className="jury-logo"><span>TN</span><div><b>Tech Nova</b><small>AI Learning Platform</small></div></div><nav>{tabs.map(([id, label, Icon]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => changeTab(id)}><Icon size={19}/>{label}</button>)}</nav><div className="jury-side-bottom"><p><b>Prototype demo</b><br/>Local profile data only</p><button onClick={onReset}><LogOut size={17}/> New profile</button></div></aside>
    <main className="jury-main"><header className="jury-top"><button className="jury-menu" onClick={() => setShowNav(!showNav)}>☰</button><div><p>Welcome back, {account.name.split(' ')[0] || 'there'} 👋</p><small>{profile.designation} · {profile.organization}</small></div><span className="jury-prototype"><ShieldCheck size={15}/> Jury demo · local data</span></header>
      <section className="jury-content">
        {tab === 'overview' && <Overview data={data} profile={profile} assessment={assessment} onTab={changeTab}/>} 
        {tab === 'gaps' && <Gaps gaps={data.gaps} selected={selectedGap} setSelected={setSelectedGap} onLearning={() => changeTab('learning')}/>} 
        {tab === 'learning' && <Learning courses={courses} profile={profile}/>} 
        {tab === 'studio' && <Studio onRetake={onRetake}/>} 
        {tab === 'admin' && <Admin data={data}/>} 
        {tab === 'about' && <About/>}
      </section>
    </main>
  </div>;
}
function Overview({ data, profile, assessment, onTab }) { return <><div className="jury-heading"><div><span className="jury-kicker">PERSONALISED LEARNING DASHBOARD</span><h1>Your competency overview</h1><p>Built from your {profile.domain} profile and competency assessment.</p></div><button className="jury-primary" onClick={() => onTab('learning')}><BookOpen size={17}/> View learning path</button></div><div className="jury-stat-grid"><Stat icon={Target} label="Role readiness" value={`${data.readiness}%`} detail="Personalised estimate"/><Stat icon={Award} label="Assessment score" value={`${assessment}%`} detail="Initial competency check" tone="green"/><Stat icon={TrendingUp} label="Priority gaps" value={data.gaps.length} detail="Areas to strengthen" tone="orange"/><Stat icon={BookOpen} label="Learning plan" value="4" detail="Recommended modules" tone="purple"/></div><div className="jury-two-col"><section className="jury-card jury-readiness"><div><h2>Role readiness</h2><p>Readiness for a data-driven role in {profile.domain}.</p><button className="jury-secondary" onClick={() => onTab('gaps')}>Explore skill gaps <ChevronRight size={16}/></button></div><div className="jury-ring" style={{ '--ring': `${data.readiness * 3.6}deg` }}><strong>{data.readiness}%</strong><span>ready</span></div></section><section className="jury-insight"><span><Sparkles size={21}/></span><div><h2>Tech Nova insight</h2><p>{profile.techSkills.length ? `Your selected strengths in ${profile.techSkills.slice(0, 2).join(' and ')} can accelerate your learning path.` : 'Your profile will shape each learning recommendation.'}</p><p>Focus on {data.gaps.slice(0, 2).map(x => x.skill).join(' and ')} to make the biggest progress.</p></div></section></div><section className="jury-card"><div className="jury-card-title"><div><h2>Competency profile</h2><p>Initial indicative scores across four learning domains.</p></div><button className="jury-text-button" onClick={() => onTab('gaps')}>Detailed analysis <ChevronRight size={15}/></button></div><div className="jury-competencies">{data.competencies.map(([name, value, tone]) => <Bar label={name} value={value} tone={tone} key={name} note={name === 'Technical' ? 'Priority improvement area' : 'Current profile estimate'}/>)}</div></section></> }
function Gaps({ gaps, selected, setSelected, onLearning }) { return <><div className="jury-heading"><div><span className="jury-kicker">EXPLAINABLE SKILL-GAP ANALYSIS</span><h1>What to improve next</h1><p>Gap = required competency − current competency. These demo estimates are personalised from your assessment.</p></div></div><div className="jury-formula"><Target size={21}/><div><b>Transparent recommendation logic</b><p>Skills are ranked by the size of the gap, relevance to your role, and your selected technology background.</p></div></div><div className="jury-gap-grid">{gaps.map(gap => { const difference = Math.max(0, gap.required - gap.current); return <button className={selected?.skill === gap.skill ? 'jury-gap selected' : 'jury-gap'} key={gap.skill} onClick={() => setSelected(selected?.skill === gap.skill ? null : gap)}><div><span>{gap.category}</span><b>{gap.skill}</b></div><strong>−{difference}<small>point gap</small></strong><Bar label="Current level" value={gap.current} tone={difference > 25 ? 'red' : 'orange'}/></button>; })}</div>{selected && <section className="jury-selected"><Lightbulb size={25}/><div><h2>{selected.skill}: recommended action</h2><p>Build this competency through a targeted module, then take a short follow-up check to measure improvement.</p></div><button className="jury-primary" onClick={onLearning}>See matching learning <ChevronRight size={16}/></button></section>}</> }
function Learning({ courses, profile }) { return <><div className="jury-heading"><div><span className="jury-kicker">PERSONALISED LEARNING</span><h1>Your recommended learning path</h1><p>Curated for a {profile.designation} working in {profile.domain}.</p></div></div><div className="jury-info"><GraduationCap size={22}/><div><b>Automated recommendation engine</b><p>Each module below was matched from the skill gaps in your assessment. "Continue on iGOT" opens the course on the iGOT Karmayogi platform — sign in there with your official credentials to access it; this app never proxies or stores that content itself.</p></div></div>{courses.length===0 && <p className="jury-tags">No gaps above the threshold — nice work. Browse the full catalogue any time to keep building skills.</p>}<div className="jury-course-grid">{courses.map((course, index) => <article className="jury-course" key={course.title}><div className="jury-course-head"><span>Module {index + 1}</span><b>{course.match}%<small>match</small></b></div><h2>{course.title}</h2><p className="jury-tags">{course.skills}</p><p>{course.reason}</p><div><span>{course.duration}</span><button onClick={() => window.open(course.igotUrl, '_blank', 'noopener,noreferrer')}>Continue on iGOT <ChevronRight size={15}/></button></div></article>)}</div></> }
// The old static "assessment library" (three hardcoded topics behind an alert)
// has been replaced by the real document-grounded pipeline in AssessmentStudio.js:
// real upload -> real extraction -> Claude-detected competencies -> questions
// generated only from the uploaded text -> server-side grading -> competency
// evidence -> recalculated gaps -> updated recommendations.
function Studio({ onRetake }) {
  return <>
    <AssessmentStudio/>
    <section className="jury-card studio-retake">
      <div className="jury-card-title"><div><h2>Prefer the profile-based check?</h2><p>The original 20-question competency check built from your professional profile is still available.</p></div>
      <button className="jury-secondary" onClick={onRetake}><ClipboardCheck size={16}/> Retake competency check</button></div>
    </section>
  </>;
}
function Admin({ data }) {
  const areas = [['Technical readiness', Math.max(38, data.competencies[1][1] - 4)], ['Statistical readiness', data.competencies[0][1]], ['Data governance', data.competencies[2][1]], ['Managerial readiness', data.competencies[3][1]]];
  const [summary, setSummary] = useState(null);
  const [summaryError, setSummaryError] = useState(null);
  useEffect(() => {
    let cancelled = false;
    getAdminSummary().then(s => { if (!cancelled) setSummary(s); }).catch(err => { if (!cancelled) setSummaryError(err.message); });
    return () => { cancelled = true; };
  }, []);
  return <><div className="jury-heading"><div><span className="jury-kicker">WORKFORCE VIEW · LIVE DATABASE</span><h1>Admin insight dashboard</h1><p>Aggregated from every assessment actually recorded by the backend so far.</p></div></div>
    {summaryError && <p className="jury-tags">Could not load live stats ({summaryError}). Is the backend running?</p>}
    <div className="jury-stat-grid"><Stat icon={Users} label="Officials profiled" value={summary ? summary.officialsProfiled : '—'} detail={summary?.note || 'Completed assessments on record'}/><Stat icon={Award} label="Average competency" value={summary ? `${summary.averageCompetency}%` : '—'} detail="Across recorded assessments" tone="green"/><Stat icon={TrendingUp} label="Critical gaps" value={summary ? summary.criticalGaps : '—'} detail="Skills scoring below 50% somewhere" tone="orange"/><Stat icon={BookOpen} label="Completion rate" value={summary ? `${summary.completionRate}%` : '—'} detail="Started vs. submitted" tone="purple"/></div>
    <section className="jury-card"><h2>Department readiness</h2><p>Based on this session's competency profile.</p><div className="jury-competencies">{areas.map(([name, value], index) => <Bar key={name} label={name} value={value} tone={index === 0 ? 'orange' : 'blue'} note={value < 70 ? 'Prioritise targeted intervention' : 'On track'}/>)}</div></section>
    <section className="jury-insight"><span><Sparkles size={21}/></span><div><h2>Actionable insight</h2><p>Technical skills such as Python, AI/ML, and SQL tend to show the highest training need. Leaders can use this view to target programmes and track outcomes as more assessments are completed.</p></div></section></> }
function About() { return <><div className="jury-heading"><div><span className="jury-kicker">ABOUT TECH NOVA</span><h1>One continuous learning loop</h1><p>Smart learning. Smarter skills. Future-ready statistical workforce.</p></div></div><div className="jury-about-grid">{[[Target,'Competency assessment','Uses work profile and selected skills to create a relevant starting assessment.'],[TrendingUp,'Skill-gap analysis','Makes development priorities visible through clear, explainable comparisons.'],[GraduationCap,'Personalised learning','Matches improvement areas to relevant learning modules and training pathways.'],[BrainCircuit,'Measure progress','Follow-up checks can update the competency profile over time.']].map(([Icon, title, body], i) => <article key={title}><span><Icon size={22}/></span><small>Step {i + 1}</small><h2>{title}</h2><p>{body}</p></article>)}</div><section className="jury-disclaimer"><b>Prototype transparency</b><p>This jury demonstration uses local profile data and simulated recommendations. It makes no claim of live government-system integration; production deployment requires authorized APIs, approved datasets, security controls, and validated competency frameworks.</p></section></> }
