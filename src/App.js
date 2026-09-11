import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Award, BookOpen, Check, ChevronRight, CircleHelp, LockKeyhole, ShieldCheck, Sparkles, UserRound } from 'lucide-react';
import { onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithPopup, signOut, updateProfile } from 'firebase/auth';
import { auth, googleProvider } from './firebase';
import { startAssessment, submitAssessment } from './api';
import JuryDashboard from './JuryDashboard';

const initialAccount = { name:'', email:'', phone:'', password:'', terms:false };
const initialProfile = { organization:'', designation:'', role:'', assignment:'', experience:'', education:'', domain:'', training:'', techSkills:[], goal:'' };
const skills = ['Python','SQL','R','Excel','Data Visualization','Machine Learning'];
const levels = [['Beginner','Core concepts and everyday data work'],['Intermediate','Applied analysis and informed decisions'],['Advanced','Complex analysis, governance and AI']];
// Restricted to real designations/roles that exist in India's Official Statistical
// System (verified against the ISS cadre structure and NSSO/MoSPI organisation —
// see server/README.md for sources). These are locked <select> lists, not free text,
// so a profile can't claim a role that doesn't exist in the statistical system.
const profileOptions = {
  organization: ['Ministry of Statistics and Programme Implementation (MoSPI)','National Statistical Office (NSO)','National Sample Survey Office (NSSO)','Central Statistics Office (CSO)','National Statistical Systems Training Academy (NSSTA)','Field Operations Division (FOD), NSO','Data Processing Division, NSO','State Directorate of Economics and Statistics'],
  designation: ['Statistical Investigator Grade II / Junior Statistical Officer (JSO)','Statistical Investigator Grade I','Statistical Officer','Senior Statistical Officer','Assistant Director (ISS, Junior Time Scale)','Deputy Director (ISS, Senior Time Scale)','Joint Director (ISS, JAG)','Director (ISS, NFSG)','Deputy Director General (ISS, SAG)','Additional Director General (ISS, HAG)','Director General (ISS, HAG Plus)'],
  role: ['Field Operations','Survey Design and Research','Data Processing','Coordination and Publication','Price Statistics','National Accounts','Social Statistics','Economic Census','IT and Systems','Training (NSSTA faculty)'],
  assignment: ['Periodic Labour Force Survey (PLFS)','Consumer Price Index (CPI)','Annual Survey of Industries (ASI)','Household Consumption Expenditure Survey (HCES)','National Accounts / GDP estimates','Economic Census','Population Census / demographic statistics','Health and social statistics','Agriculture and environment statistics','Data quality, validation or dissemination','Dashboard / MIS development']
};
function Field({label,name,value,onChange,type='text',placeholder,required=true}) { return <label className="field"><span>{label}{required && <b> *</b>}</span><input type={type} name={name} value={value} onChange={onChange} placeholder={placeholder}/></label>; }
function SelectField({label,name,value,onChange,options=[],required=true}) { return <label className="field"><span>{label}{required && <b> *</b>}</span><select name={name} value={value} onChange={onChange}><option value="">Select an option</option>{options.map(option=><option key={option} value={option}>{option}</option>)}</select></label>; }
function ErrorList({errors}) { const messages=[...new Set(Object.values(errors).filter(Boolean))]; return messages.length ? <div className="errors">{messages.map(x=><p key={x}>{x}</p>)}</div> : null; }
function authErrorMessage(err) {
  const messages = {
    'auth/email-already-in-use': 'That email is already registered — try signing in instead.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/weak-password': 'Use a stronger password (at least 8 characters).',
    'auth/wrong-password': 'Incorrect password.',
    'auth/invalid-credential': 'Incorrect email or password.',
    'auth/user-not-found': 'No account found with that email — try creating one instead.',
    'auth/popup-closed-by-user': 'Google sign-in was cancelled.',
    'auth/network-request-failed': 'Network error — check your connection and try again.',
    'auth/api-key-not-valid.-please-pass-a-valid-api-key.': 'Firebase is not configured yet — set the REACT_APP_FIREBASE_* values in .env.local.'
  };
  return messages[err?.code] || err?.message || 'Something went wrong. Please try again.';
}

export default function App() {
  const stored = (()=>{try{return JSON.parse(localStorage.getItem('technova-onboarding'))||{};}catch{return {};}})();
  // Stages 4-6 depend on live data from the backend (attemptId / questions / result)
  // which we don't persist to localStorage, so a reload mid-assessment goes back to
  // the level-select step instead of showing a broken screen.
  const [stage,setStage]=useState(stored.stage>=4?3:stored.stage||1), [account,setAccount]=useState({...initialAccount,...stored.account}), [profile,setProfile]=useState({...initialProfile,...stored.profile}), [level,setLevel]=useState(stored.level||'Intermediate'), [attemptId,setAttemptId]=useState(null), [questions,setQuestions]=useState([]), [answers,setAnswers]=useState({}), [errors,setErrors]=useState({}), [submitted,setSubmitted]=useState(false), [result,setResult]=useState(null), [starting,setStarting]=useState(false), [finishing,setFinishing]=useState(false), [apiError,setApiError]=useState(null), [authMode,setAuthMode]=useState('signup'), [authBusy,setAuthBusy]=useState(false);
  const autoAdvanced=useRef(false);
  useEffect(()=>localStorage.setItem('technova-onboarding',JSON.stringify({stage,account,profile,level})),[stage,account,profile,level]);
  // If a Firebase session already exists (returning visitor, or immediately after
  // sign-in/sign-up below), skip straight past the account step. Guarded by a ref
  // so later token-refresh events don't yank the user back to stage 2 mid-flow.
  useEffect(()=>{
    const unsubscribe=onAuthStateChanged(auth,user=>{
      if(user&&!autoAdvanced.current){
        autoAdvanced.current=true;
        setAccount(x=>({...x,name:x.name||user.displayName||'',email:x.email||user.email||''}));
        setStage(s=>s===1?2:s);
      }
    });
    return unsubscribe;
  },[]);
  const accountChange=e=>setAccount(x=>({...x,[e.target.name]:e.target.type==='checkbox'?e.target.checked:e.target.value}));
  const profileChange=e=>setProfile(x=>({...x,[e.target.name]:e.target.value}));
  const switchAuthMode=()=>{setAuthMode(m=>m==='signin'?'signup':'signin');setErrors({});setApiError(null);};
  const googleSignIn=async()=>{
    setAuthBusy(true);setApiError(null);
    try{
      const {user}=await signInWithPopup(auth,googleProvider);
      setAccount(x=>({...x,name:x.name||user.displayName||'',email:user.email||x.email}));
    }catch(err){setApiError(authErrorMessage(err));}
    finally{setAuthBusy(false);}
  };
  const continueAccount=async()=>{
    setApiError(null);
    if(authMode==='signin'){
      const e={};if(!account.email)e.email='Please complete this field.';if(!account.password)e.password='Please complete this field.';
      setErrors(e);if(Object.keys(e).length)return;
      setAuthBusy(true);
      try{
        const {user}=await signInWithEmailAndPassword(auth,account.email,account.password);
        setAccount(x=>({...x,name:x.name||user.displayName||'',password:''}));
        setStage(2);
      }catch(err){setApiError(authErrorMessage(err));}
      finally{setAuthBusy(false);}
      return;
    }
    const alreadySignedIn=!!auth.currentUser;
    const e={};
    if(!account.name)e.name='Please complete this field.';
    if(!alreadySignedIn){
      if(!account.email)e.email='Please complete this field.';else if(!/^\S+@\S+\.\S+$/.test(account.email))e.email='Enter a valid email address.';
      if(!account.password)e.password='Please complete this field.';else if(account.password.length<8)e.password='Use at least 8 characters.';
    }
    if(!account.phone)e.phone='Please complete this field.';
    if(!account.terms)e.terms='Please accept the terms to continue.';
    setErrors(e);if(Object.keys(e).length)return;
    if(alreadySignedIn){setStage(2);return;}
    setAuthBusy(true);
    try{
      const {user}=await createUserWithEmailAndPassword(auth,account.email,account.password);
      if(account.name)await updateProfile(user,{displayName:account.name});
      setAccount(x=>({...x,password:''}));
      setStage(2);
    }catch(err){setApiError(authErrorMessage(err));}
    finally{setAuthBusy(false);}
  };
  const toggleSkill=skill=>setProfile(x=>({...x,techSkills:x.techSkills.includes(skill)?x.techSkills.filter(y=>y!==skill):[...x.techSkills,skill]}));
  const nextProfile=()=>{const e={};['organization','designation','role','assignment','experience','education','domain'].forEach(k=>!profile[k]&&(e[k]='Please complete this field.'));if(!profile.techSkills.length)e.techSkills='Choose at least one technology skill.';setErrors(e);if(!Object.keys(e).length)setStage(3);};
  const start=async()=>{
    setStarting(true);setApiError(null);
    try{
      const {attemptId:id,questions:q}=await startAssessment(profile,level);
      setAttemptId(id);setQuestions(q);setAnswers({});setSubmitted(false);setStage(4);window.scrollTo(0,0);
    }catch(err){setApiError(`Could not start the assessment: ${err.message}. Is the backend server running on port 4000?`);}
    finally{setStarting(false);}
  };
  const finish=async()=>{
    setFinishing(true);setApiError(null);
    try{
      const r=await submitAssessment(attemptId,answers);
      setResult(r);setStage(5);window.scrollTo(0,0);
    }catch(err){setApiError(`Could not submit the assessment: ${err.message}.`);}
    finally{setFinishing(false);}
  };
  const restart=async()=>{localStorage.removeItem('technova-onboarding');autoAdvanced.current=false;try{await signOut(auth);}catch{/* ignore */}setStage(1);setAccount(initialAccount);setProfile(initialProfile);setAttemptId(null);setQuestions([]);setAnswers({});setSubmitted(false);setResult(null);setApiError(null);setAuthMode('signup');};
  if(stage===5&&result)return <Results {...{account,profile,result,restart,openDashboard:()=>setStage(6)}}/>;
  if(stage===6&&result)return <JuryDashboard account={account} profile={profile} result={result} onRetake={()=>setStage(3)} onReset={restart}/>;
  return <main className="shell"><header><a className="brand" href="/" onClick={e=>e.preventDefault()}><span>TN</span> Tech Nova</a><div className="secure"><LockKeyhole size={15}/> Secure onboarding</div></header>{stage<=3&&<><section className="progress-label"><span>Step {stage} of 3</span><strong>{['Account','Professional profile','Competency check'][stage-1]}</strong></section><div className="progress-track"><i style={{width:`${stage/3*100}%`}}/></div></>}{apiError&&<p className="error" style={{margin:'0 auto',maxWidth:640}}>{apiError}</p>}<section className="content">{stage===1&&<Account {...{account,accountChange,errors,continueAccount,authMode,switchAuthMode,authBusy,googleSignIn}}/>}{stage===2&&<Profile {...{profile,profileChange,toggleSkill,errors,nextProfile,setStage}}/>}{stage===3&&<Level {...{profile,level,setLevel,setStage,start,starting}}/>}{stage===4&&<Assessment {...{questions,answers,setAnswers,submitted,setSubmitted,setStage,finish,finishing}}/>}</section></main>;
}
function Account({account,accountChange,errors,continueAccount,authMode,switchAuthMode,authBusy,googleSignIn}) {const isSignIn=authMode==='signin';return <div className="panel narrow"><div className="eyebrow"><Sparkles size={16}/> YOUR LEARNING JOURNEY STARTS HERE</div><h1>{isSignIn?'Sign in to Tech Nova':'Create your Tech Nova account'}</h1><p className="lead">{isSignIn?'Welcome back — sign in with your official credentials.':'Build a learning profile designed around the work you do.'}</p><button className="google" onClick={googleSignIn} disabled={authBusy}><span className="google-mark">G</span> Continue with Google</button><div className="or"><span>or continue with email</span></div><div className="form-grid">{!isSignIn&&<Field label="Full name" name="name" value={account.name} onChange={accountChange} placeholder="Your full name"/>}<Field label="Work email" name="email" type="email" value={account.email} onChange={accountChange} placeholder="name@organisation.gov"/>{!isSignIn&&<Field label="Mobile number" name="phone" type="tel" value={account.phone} onChange={accountChange} placeholder="Your mobile number"/>}<Field label={isSignIn?'Password':'Create password'} name="password" type="password" value={account.password} onChange={accountChange} placeholder={isSignIn?'Your password':'At least 8 characters'}/></div><ErrorList errors={errors}/>{!isSignIn&&<label className="check"><input name="terms" type="checkbox" checked={account.terms} onChange={accountChange}/><span>I agree to the terms of use and privacy notice.</span></label>}<button className="primary full" onClick={continueAccount} disabled={authBusy}>{authBusy?'Please wait…':<>{isSignIn?'Sign in':'Continue'} <ArrowRight size={18}/></>}</button><p className="small"><ShieldCheck size={14}/> Authenticated with Firebase — your information is used only to personalize your learning path.</p><button type="button" onClick={switchAuthMode} style={{background:'none',border:'none',color:'inherit',textDecoration:'underline',cursor:'pointer',marginTop:12,fontSize:14,padding:0}}>{isSignIn?'New here? Create an account':'Already have an account? Sign in'}</button></div>}
function Profile({profile,profileChange,toggleSkill,errors,nextProfile,setStage}) {const selects={experience:['0–1 years','2–4 years','5–7 years','8+ years'],education:['Higher secondary','Diploma',"Bachelor's degree","Master's degree",'Doctorate / PhD'],domain:['Labour Statistics','Population & Demography','Economic Statistics','Health Statistics','Agriculture & Environment']};return <div className="panel"><div className="eyebrow"><UserRound size={16}/> PROFESSIONAL PROFILE</div><h1>Tell us about your work</h1><p className="lead">These fields are restricted to real designations and roles within India's Official Statistical System — choose the closest match to your work.</p><div className="form-grid three"><SelectField label="Department or organization" name="organization" value={profile.organization} onChange={profileChange} options={profileOptions.organization}/><SelectField label="Designation" name="designation" value={profile.designation} onChange={profileChange} options={profileOptions.designation}/><SelectField label="Job role" name="role" value={profile.role} onChange={profileChange} options={profileOptions.role}/><SelectField label="Current assignment" name="assignment" value={profile.assignment} onChange={profileChange} options={profileOptions.assignment}/>{Object.entries(selects).map(([name,values])=><label className="field" key={name}><span>{name==='experience'?'Years of experience':name==='education'?'Education':'Statistical domain'} <b>*</b></span><select name={name} value={profile[name]} onChange={profileChange}><option value="">Select an option</option>{values.map(x=><option key={x}>{x}</option>)}</select></label>)}</div><div className="field wide"><span>Technology skills <b>*</b></span><div className="skills">{skills.map(skill=><button className={profile.techSkills.includes(skill)?'skill selected':'skill'} key={skill} onClick={()=>toggleSkill(skill)}>{profile.techSkills.includes(skill)&&<Check size={14}/>} {skill}</button>)}</div></div><div className="form-grid extra"><Field label="Previous training (optional)" required={false} name="training" value={profile.training} onChange={profileChange} placeholder="Courses, workshops or certifications"/><Field label="Learning goal (optional)" required={false} name="goal" value={profile.goal} onChange={profileChange} placeholder="What would you like to achieve?"/></div><ErrorList errors={errors}/><div className="actions"><button className="secondary" onClick={()=>setStage(1)}><ArrowLeft size={18}/> Back</button><button className="primary" onClick={nextProfile}>Continue <ArrowRight size={18}/></button></div></div>}
function Level({profile,level,setLevel,setStage,start,starting}) {return <div className="panel narrow"><div className="eyebrow"><CircleHelp size={16}/> PERSONALIZED COMPETENCY CHECK</div><h1>Choose your starting level</h1><p className="lead">We created a question set for a <strong>{profile.designation||'professional'}</strong> working in <strong>{profile.domain||'your domain'}</strong>.</p><div className="level-list">{levels.map(([name,description])=><button className={level===name?'level selected':'level'} key={name} onClick={()=>setLevel(name)}><span className="radio"/><span><strong>{name}</strong><small>{description}</small></span><ChevronRight size={18}/></button>)}</div><div className="assessment-note"><BookOpen size={20}/><span><strong>20 questions · about 12 minutes</strong><br/>Your results identify strengths and useful next learning steps.</span></div><div className="actions"><button className="secondary" onClick={()=>setStage(2)} disabled={starting}><ArrowLeft size={18}/> Back</button><button className="primary" onClick={start} disabled={starting}>{starting?'Preparing your assessment…':<>Start assessment <ArrowRight size={18}/></>}</button></div></div>}
function Assessment({questions,answers,setAnswers,submitted,setSubmitted,setStage,finish,finishing}) {const answered=Object.keys(answers).length;return <div className="panel assessment"><div className="assessment-head"><div><div className="eyebrow"><CircleHelp size={16}/> COMPETENCY CHECK</div><h1>Your personalized assessment</h1><p className="lead">Answer every question. You can review choices before submitting.</p></div><div className="counter">{answered} / {questions.length}<small>answered</small></div></div>{questions.map((q,i)=><article className="question" key={q.id}><div className="question-meta"><span>{q.category}</span><small>Question {i+1}</small></div><h3>{q.question}</h3><div className="options">{q.options.map((x,n)=><label className={answers[q.id]===n?'option chosen':'option'} key={x}><input type="radio" name={q.id} checked={answers[q.id]===n} onChange={()=>setAnswers(old=>({...old,[q.id]:n}))}/><span>{x}</span></label>)}</div></article>)}{submitted&&answered<questions.length&&<p className="error">Please answer all 20 questions before submitting.</p>}<div className="actions"><button className="secondary" onClick={()=>setStage(3)} disabled={finishing}><ArrowLeft size={18}/> Back</button><button className="primary" onClick={()=>answered===questions.length?finish():setSubmitted(true)} disabled={finishing}>{finishing?'Scoring your answers…':<>See my results <Award size={18}/></>}</button></div></div>}
function Results({account,profile,result,restart,openDashboard}) {const {score,total,percent}=result, rec=result.recommendations.slice(0,3);return <main className="shell results-shell"><header><a className="brand" href="/" onClick={e=>e.preventDefault()}><span>TN</span> Tech Nova</a></header><section className="content"><div className="panel result"><div className="award"><Award size={34}/></div><div className="eyebrow">COMPETENCY PROFILE COMPLETE</div><h1>Nice work, {account.name.split(' ')[0]||'there'}.</h1><p className="lead">{percent>=75?'A strong foundation to build on.':percent>=50?'A promising foundation with clear next steps.':'A great starting point for a focused learning plan.'}</p><div className="score"><strong>{percent}%</strong><span>{score} correct out of {total}</span></div><div className="result-grid"><section><h2>Your profile</h2><p><strong>{profile.designation}</strong> · {profile.organization}</p><p>{profile.domain} · {profile.experience}</p></section><section><h2>Suggested next steps</h2>{rec.length?rec.map(x=><p className="recommendation" key={x.title}><Check size={16}/> {x.title}</p>):<p className="recommendation"><Check size={16}/> Strong across the board — explore the dashboard for optional deepening modules.</p>}</section></div><div className="result-actions"><button className="secondary" onClick={restart}>Start over</button><button className="primary" onClick={openDashboard}>Open my learning dashboard <ArrowRight size={18}/></button></div><p className="small">Scored by the TechNova backend from your saved answers.</p></div></section></main>}
