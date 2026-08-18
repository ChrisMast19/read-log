import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";

/* ================================================================
 *  THE READ LOG v2 — mixed-day woodsmanship instrument
 *  Atom = the EFFORT (a Sit or a Stalk). A day holds one or more.
 *  Two scores: THE READ (prediction, season-aggregated, hedge-proof)
 *              THE ADJUST (reaction, gated to drift-days / every stalk)
 *  Stalk = logged + leak-map coached, not yet numerically scored.
 *  Grades the hunter's judgment, never the yield.
 * ================================================================ */

const CALL = { Dead: 0, Marginal: 1, Good: 2, Prime: 3 };
const OUT = { None: 0, Distant: 1, Close: 2, Encounter: 3 };
const CALLS = ["Dead", "Marginal", "Good", "Prime"];
const OUTS = ["None", "Distant", "Close", "Encounter"];
const CONFS = ["Low", "Med", "High"];
const SPECIES = ["Blacktail", "Whitetail", "Mule Deer", "Elk", "Turkey", "Other"];
const RESULTS = ["Busted", "No shot", "Shot opp", "Filled tag"];
const CAUSES = ["Winded", "Skylined", "Too fast", "Ran out of light", "Animal left"];
const ADAPT = ["Adjusted", "Held — right call", "Missed it"];
const KEY = "readlog:efforts:v1";
const MODEL = "claude-sonnet-4-6";

/* ---- sample season: mixed sits + stalks, engineered to demo cleanly ---- */
const SAMPLE = [
  // day, loc, species, TYPE, ...fields
  ["2025-09-14","Ridge Clearcut","Blacktail","sit",{call:"Prime",confidence:"High",keyRead:"Fresh rubs, cold snap coming",hours:4,outcome:"None",harvest:"No",drift:false,adaptGood:null,notes:"Too warm still. Nothing moved."}],
  ["2025-09-21","Alder Bench","Blacktail","sit",{call:"Good",confidence:"Med",keyRead:"Trail chewed into the salal",hours:3,outcome:"Distant",harvest:"No",drift:true,adaptGood:"yes",notes:"Wind swung mid-morning, I slipped to the far corner. Doe at 200."}],
  ["2025-09-28","South Face","Mule Deer","stalk",{keyRead:"Glassed two bucks bedded across the basin",closest:"250y",result:"Busted",bustCause:"Winded",harvest:"No",notes:"Thermal switched climbing the last bench. Blew out."}],
  ["2025-10-05","Creek Timber","Blacktail","sit",{call:"Good",confidence:"Med",keyRead:"Sign everywhere",hours:4,outcome:"None",harvest:"No",drift:false,adaptGood:null,notes:"Slow. Maybe overhunted."}],
  ["2025-10-12","Burn Edge","Blacktail","sit",{call:"Marginal",confidence:"Low",keyRead:"Full moon, not hopeful",hours:3,outcome:"Close",harvest:"No",drift:false,adaptGood:null,notes:"Surprised me — buck at 60."}],
  ["2025-10-12","Burn Edge","Blacktail","stalk",{keyRead:"Same buck fed into the open, tried to close",closest:"90y",result:"No shot",bustCause:"none",harvest:"No",notes:"Ran out of cover. Backed out clean, didn't spook him."}],
  ["2025-10-19","Creek Timber","Blacktail","sit",{call:"Good",confidence:"Med",keyRead:"Steady drizzle, cool",hours:4,outcome:"Close",harvest:"No",drift:true,adaptGood:"yes",notes:"Rain shifted the wind, re-set downwind of the trail. Doe group."}],
  ["2025-10-26","Ridge Clearcut","Blacktail","sit",{call:"Marginal",confidence:"Med",keyRead:"High pressure, bright, warm",hours:4,outcome:"None",harvest:"No",drift:false,adaptGood:null,notes:"Called it dead, it was."}],
  ["2025-11-02","Rockslide Basin","Mule Deer","stalk",{keyRead:"Bachelor group, wide open country",closest:"400y",result:"Busted",bustCause:"Skylined",harvest:"No",notes:"Crested the ridge too high, they saw me first."}],
  ["2025-11-09","Alder Bench","Blacktail","sit",{call:"Good",confidence:"High",keyRead:"Pre-rut, cooling, light wind",hours:5,outcome:"Close",harvest:"No",drift:true,adaptGood:"no",notes:"Wind quartered wrong for an hour and I sat it. Should've moved."}],
  ["2025-11-16","Burn Edge","Blacktail","sit",{call:"Prime",confidence:"High",keyRead:"Rut + front + drizzle stacked",hours:6,outcome:"Encounter",harvest:"Yes",drift:true,adaptGood:"yes",notes:"Pressure dropped, still-hunted to the edge. 3x4 at 80."}],
  ["2025-11-23","Creek Timber","Blacktail","sit",{call:"Good",confidence:"Med",keyRead:"Post-front, still rutty",hours:4,outcome:"Close",harvest:"No",drift:false,adaptGood:null,notes:"Doe chased past."}],
  ["2025-11-23","Creek Timber","Blacktail","stalk",{keyRead:"Buck dogging her, tried to cut them off",closest:"120y",result:"Busted",bustCause:"Winded",harvest:"No",notes:"Swirl in the bottom gave me up."}],
  ["2025-11-30","Alder Bench","Blacktail","sit",{call:"Marginal",confidence:"Med",keyRead:"Warm, high pressure, late",hours:3,outcome:"Distant",harvest:"No",drift:false,adaptGood:null,notes:"Slow, as expected."}],
  ["2025-12-06","Ridge Clearcut","Blacktail","sit",{call:"Dead",confidence:"High",keyRead:"Bluebird, warm, season nearly over",hours:3,outcome:"None",harvest:"No",drift:false,adaptGood:null,notes:"Knew it. Scouted more than hunted."}],
].map((r, i) => ({ id: "s" + i, dayId: r[0] + "|" + r[1], date: r[0], location: r[1], species: r[2], type: r[3], ...r[4], wx: r[3] === "sit" ? synthWx(!!r[4].drift, i) : undefined }));

/* ------------------------------ scoring ------------------------------ */
const sitScored = (e) => e.type === "sit" && e.call in CALL && e.outcome in OUT;
const calOf = (e) => (sitScored(e) ? 1 - Math.abs(OUT[e.outcome] - CALL[e.call]) / 3 : null);
const pct = (x) => (x == null ? "—" : Math.round(x * 100) + "%");

function computeRead(efforts) {
  const s = efforts.filter(sitScored);
  // stair-step: avg outcome index per call bucket
  const step = CALLS.map((c) => {
    const g = s.filter((e) => e.call === c);
    return { call: c, n: g.length, avg: g.length ? g.reduce((a, e) => a + OUT[e.outcome], 0) / g.length : null };
  });
  // hedge-proof concordance over pairs whose CALLS differ
  let conc = 0, comparable = 0;
  for (let i = 0; i < s.length; i++)
    for (let j = i + 1; j < s.length; j++) {
      const dc = CALL[s[i].call] - CALL[s[j].call];
      if (dc === 0) continue;
      comparable++;
      const dou = OUT[s[i].outcome] - OUT[s[j].outcome];
      if (dou === 0) conc += 0.5;
      else if (Math.sign(dc) === Math.sign(dou)) conc += 1;
    }
  const score = comparable >= 6 ? conc / comparable : null;
  return { score, step, comparable, need: Math.max(0, 8 - s.length), nSits: s.length };
}

function computeAdjust(efforts) {
  const drift = efforts.filter((e) => e.type === "sit" && sitDrifted(e));
  const ok = drift.filter((e) => e.adaptGood === "yes");
  const list = drift.map((e) => ({ date: e.date, location: e.location, ok: e.adaptGood === "yes", summary: driftSummaryOf(e) }));
  return { n: drift.length, ok: ok.length, score: drift.length >= 2 ? ok.length / drift.length : null, list, need: Math.max(0, 2 - drift.length) };
}

function stalkMap(efforts) {
  const st = efforts.filter((e) => e.type === "stalk");
  const busted = st.filter((e) => e.result === "Busted");
  const causes = {};
  busted.forEach((e) => { if (e.bustCause && e.bustCause !== "none") causes[e.bustCause] = (causes[e.bustCause] || 0) + 1; });
  const topCause = Object.entries(causes).sort((a, b) => b[1] - a[1])[0];
  return { n: st.length, busted: busted.length, causes, topCause, list: st };
}

function groupByDay(efforts) {
  const m = {};
  efforts.forEach((e) => { (m[e.dayId] = m[e.dayId] || { dayId: e.dayId, date: e.date, location: e.location, species: e.species, efforts: [] }).efforts.push(e); });
  return Object.values(m).sort((a, b) => (a.date < b.date ? 1 : -1));
}

async function callClaude(messages, system) {
  const res = await fetch("/.netlify/functions/claude", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system, messages }),
  });
  if (!res.ok) throw new Error("api " + res.status);
  const data = await res.json();
  return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
}

/* ---- weather-verified drift: the objective backbone of The Adjust ---- */
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const compass = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
const circDiff = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

function detectDrift(wx) {
  if (!wx || wx.length < 2) return { drifted: false, summary: "" };
  const dir = wx.map((p) => p.dir), spd = wx.map((p) => p.spd), pres = wx.map((p) => p.pres), temp = wx.map((p) => p.temp);
  let dirSwing = 0, iF = 0, iT = 0;
  for (let i = 0; i < wx.length; i++) for (let j = i + 1; j < wx.length; j++) { const d = circDiff(dir[i], dir[j]); if (d > dirSwing) { dirSwing = d; iF = i; iT = j; } }
  const spdRange = Math.max(...spd) - Math.min(...spd);
  const presRange = Math.max(...pres) - Math.min(...pres);
  const tempRange = Math.max(...temp) - Math.min(...temp);
  const dPres = pres[pres.length - 1] - pres[0];
  const flags = [];
  if (dirSwing > 45) flags.push([dirSwing, `wind swung ${compass(dir[iF])}→${compass(dir[iT])}`]);
  if (presRange > 3) flags.push([presRange * 15, `pressure ${dPres < 0 ? "fell" : "rose"} ${presRange.toFixed(0)} hPa`]);
  if (spdRange > 8) flags.push([spdRange * 6, `wind ${spd[0] <= spd[spd.length - 1] ? "built" : "dropped"} ${Math.round(Math.min(...spd))}→${Math.round(Math.max(...spd))} mph`]);
  if (tempRange > 10) flags.push([tempRange * 4, `temp moved ${tempRange.toFixed(0)}°`]);
  flags.sort((a, b) => b[0] - a[0]);
  return { drifted: flags.length > 0, summary: flags.slice(0, 2).map((f) => f[1]).join(", ") };
}
const sitDrifted = (e) => (e.wx ? detectDrift(e.wx).drifted : e.drift === true);
const driftSummaryOf = (e) => (e.wx ? detectDrift(e.wx).summary : e.drift ? "conditions shifted" : "");

/* realistic sit-window arc for the sample season (stands in for a live pull) */
function synthWx(drifted, seed) {
  const n = 5;
  if (!drifted) return Array.from({ length: n }, (_, k) => ({ dir: 300 + (k - 2) * 3, spd: 5 + (k % 2), pres: 1018 + (k === 2 ? 1 : 0), temp: 44 + k }));
  const mode = seed % 3;
  return Array.from({ length: n }, (_, k) => {
    const f = k / (n - 1);
    if (mode === 0) return { dir: 315 - f * 155, spd: 6 + f * 2, pres: 1016 - f, temp: 45 + f * 4 };
    if (mode === 1) return { dir: 210 + f * 8, spd: 5 + f * 3, pres: 1016 - f * 7, temp: 44 - f * 3 };
    return { dir: 200 + f * 10, spd: 3 + f * 12, pres: 1015 - f * 2, temp: 47 - f * 5 };
  });
}

/* live weather for a sit window — works on deploy; callers fall back if blocked */
async function fetchSitWeather(location, date) {
  const r = await fetch(`/.netlify/functions/weather?location=${encodeURIComponent(location)}&date=${date}`);
  if (!r.ok) throw new Error("weather " + r.status);
  const j = await r.json();
  if (!j.wx || j.wx.length < 2) throw new Error("no weather");
  return j.wx;
}
const ADAPT_MAP = { Adjusted: "yes", "Held — right call": "yes", "Missed it": "no" };

function useSpeech() {
  const R = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
  const [listening, setListening] = useState(false);
  const [text, setText] = useState("");
  const ref = useRef(null);
  const stop = useCallback(() => ref.current && ref.current.stop(), []);
  const start = useCallback(() => {
    if (!R) return; const rec = new R(); rec.lang = "en-US"; rec.interimResults = true; rec.continuous = true;
    let fin = "";
    rec.onresult = (e) => { let itm = ""; for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) fin += t + " "; else itm += t; } setText((fin + itm).trim()); };
    rec.onerror = () => setListening(false); rec.onend = () => setListening(false);
    ref.current = rec; rec.start(); setListening(true);
  }, [R]);
  return { supported: !!R, listening, text, start, stop, reset: () => setText("") };
}

/* ================================ APP ================================ */
export default function App() {
  const [efforts, setEfforts] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState("home");

  useEffect(() => { try { const r = localStorage.getItem(KEY); if (r) setEfforts(JSON.parse(r)); } catch (e) {} setLoaded(true); }, []);
  useEffect(() => { if (!loaded) return; try { localStorage.setItem(KEY, JSON.stringify(efforts)); } catch (e) {} }, [efforts, loaded]);

  const read = useMemo(() => computeRead(efforts), [efforts]);
  const adjust = useMemo(() => computeAdjust(efforts), [efforts]);
  const stalks = useMemo(() => stalkMap(efforts), [efforts]);
  const addEfforts = (list) => setEfforts((p) => [...p, ...list]);

  return (
    <div className="rl">
      <style>{CSS}</style>
      {view === "home" && <Home read={read} adjust={adjust} efforts={efforts} go={setView} loadSample={() => setEfforts(SAMPLE)} />}
      {view === "log" && <LogFlow onSaveDay={addEfforts} back={() => setView("home")} />}
      {view === "book" && <Logbook efforts={efforts} back={() => setView("home")} del={(dayId) => setEfforts((p) => p.filter((e) => e.dayId !== dayId))} />}
      {view === "coach" && <Coach read={read} adjust={adjust} stalks={stalks} efforts={efforts} back={() => setView("home")} />}
    </div>
  );
}

/* -------------------------------- HOME ------------------------------- */
function Home({ read, adjust, efforts, go, loadSample }) {
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const has = efforts.length > 0;
  return (
    <div className="rl-wrap">
      <div className="rl-eyebrow">THE READ LOG · {today.toUpperCase()}</div>
      <h1 className="rl-title">First light.</h1>
      {has ? (
        <div className="rl-twoscore">
          <ScoreChip label="The Read" hint="calling it right" score={read.score} need={read.need} unit="pct" />
          <ScoreChip label="The Adjust" hint="changing when it changes" score={adjust.score} okOf={[adjust.ok, adjust.n]} need={adjust.need} unit="ofn" />
        </div>
      ) : (
        <p className="rl-sub">Two things get graded here: how well you <em>call</em> a hunt before it happens, and how well you <em>adjust</em> when the woods change on you. Never how many deer walked by.</p>
      )}
      <div className="rl-doors">
        <button className="rl-door" onClick={() => go("log")}><IconPen /><div><h3>Log a hunt</h3><p>Sit, stalk, or both in a day. A few questions, by voice or thumb.</p></div><span className="rl-chev">→</span></button>
        <button className="rl-door" onClick={() => go("book")}><IconBook /><div><h3>Your logbook</h3><p>Every day, every effort — and how each one actually played out.</p></div><span className="rl-chev">→</span></button>
        <button className="rl-door" onClick={() => go("coach")}><IconAntler /><div><h3>The coach's read</h3><p>Where you're sharpening, and the one leak to plug next.</p></div><span className="rl-chev">→</span></button>
      </div>
      {!has && <button className="rl-ghost rl-center" onClick={loadSample}>load a sample season to explore</button>}
      <div className="rl-foot">You still sit the cold hours and grind out every stalk. This just watches you get better at reading them.</div>
    </div>
  );
}

function ScoreChip({ label, hint, score, okOf, need, unit }) {
  const gated = score == null;
  return (
    <div className="rl-scorechip">
      <div className="rl-scoreval">
        {gated ? <span className="rl-gate">—</span> : unit === "ofn" ? <span>{okOf[0]}<i>/{okOf[1]}</i></span> : <span>{Math.round(score * 100)}</span>}
      </div>
      <div className="rl-scorelab">{label}</div>
      <div className="rl-scorehint">{gated ? (need ? `${need} more to unlock` : "warming up") : hint}</div>
    </div>
  );
}

/* -------------------------------- LOG -------------------------------- */
function LogFlow({ onSaveDay, back }) {
  const todayISO = new Date().toISOString().slice(0, 10);
  const [phase, setPhase] = useState("day"); // day | branch | steps | confirm | another
  const [day, setDay] = useState({ date: todayISO, location: "", species: "Blacktail" });
  const [efforts, setEfforts] = useState([]);
  const [draft, setDraft] = useState(null);

  const startEffort = (type) => {
    setDraft(type === "sit"
      ? { type: "sit", call: "", confidence: "Med", keyRead: "", hours: "", outcome: "", harvest: "No", drift: null, adaptGood: null, notes: "" }
      : { type: "stalk", keyRead: "", closest: "", result: "", bustCause: "none", harvest: "No", notes: "" });
    setPhase("steps");
  };
  const saveEffort = () => {
    const e = { ...draft, id: "u" + Date.now() + Math.random().toString(36).slice(2, 5), dayId: day.date + "|" + (day.location || "Unnamed"), date: day.date, location: day.location || "Unnamed", species: day.species };
    setEfforts((p) => [...p, e]); setDraft(null); setPhase("another");
  };
  const finishDay = () => { if (efforts.length) onSaveDay(efforts); back(); };

  if (phase === "day")
    return (
      <div className="rl-wrap">
        <Top back={back} label="new day" />
        <h2 className="rl-q">Where and when?</h2>
        <p className="rl-qsub">Set the day once — every sit and stalk in it shares this.</p>
        <div className="rl-daterow"><button className={"rl-chip " + (day.date === todayISO ? "on" : "")} onClick={() => setDay({ ...day, date: todayISO })}>Today</button><input className="rl-input rl-dateinput" type="date" value={day.date} onChange={(e) => setDay({ ...day, date: e.target.value })} /></div>
        <F l="Location"><input value={day.location} placeholder="Ridge Clearcut" onChange={(e) => setDay({ ...day, location: e.target.value })} /></F>
        <F l="Species"><Sel v={day.species} opts={SPECIES} onC={(v) => setDay({ ...day, species: v })} /></F>
        <div className="rl-flownav"><button className="rl-primary rl-grow" disabled={!day.location} onClick={() => setPhase("branch")}>next →</button></div>
      </div>
    );

  if (phase === "branch")
    return (
      <div className="rl-wrap">
        <Top back={() => setPhase(efforts.length ? "another" : "day")} label={day.location} />
        <h2 className="rl-q">How'd you hunt this stretch?</h2>
        <p className="rl-qsub">Pick the effort you want to log. You can add another after.</p>
        <div className="rl-branch">
          <button className="rl-branchbtn" onClick={() => startEffort("sit")}><b>Sit</b><span>Posted up — stand, blind, glassing knob. Graded on your <em>call</em>.</span></button>
          <button className="rl-branchbtn" onClick={() => startEffort("stalk")}><b>Stalk</b><span>On the move after an animal. Graded on the <em>stalk</em> itself.</span></button>
        </div>
      </div>
    );

  if (phase === "steps" && draft?.type === "sit") return <SitSteps draft={draft} setDraft={setDraft} onDone={() => setPhase("weather")} back={() => setPhase("branch")} />;
  if (phase === "steps" && draft?.type === "stalk") return <StalkSteps draft={draft} setDraft={setDraft} onDone={() => setPhase("confirm")} back={() => setPhase("branch")} />;
  if (phase === "weather") return <WeatherCheck day={day} draft={draft} setDraft={setDraft} onDone={() => setPhase("confirm")} back={() => setPhase("steps")} />;

  if (phase === "confirm") return <EffortConfirm draft={draft} setDraft={setDraft} onBack={() => setPhase("steps")} onSave={saveEffort} />;

  if (phase === "another")
    return (
      <div className="rl-wrap">
        <Top back={() => setPhase("branch")} label={day.location} />
        <h2 className="rl-q">Logged.</h2>
        <p className="rl-qsub">{efforts.length} effort{efforts.length > 1 ? "s" : ""} this day{efforts.some((e) => e.type === "stalk") && efforts.some((e) => e.type === "sit") ? " — a sit and a stalk. That's a real day." : "."}</p>
        <div className="rl-recap">{efforts.map((e) => <div className="rl-recapitem" key={e.id}><span className={"rl-tagpill " + e.type}>{e.type}</span>{e.type === "sit" ? `${e.call} → ${e.outcome}` : `stalk → ${e.result}`}</div>)}</div>
        <div className="rl-flownav rl-col">
          <button className="rl-primary rl-grow" onClick={() => setPhase("branch")}>+ another go</button>
          <button className="rl-ghost rl-grow" onClick={finishDay}>done for the day</button>
        </div>
      </div>
    );
  return null;
}

function SitSteps({ draft, setDraft, onDone, back }) {
  const steps = [
    { key: "call", kind: "choice", q: "Before you climbed in — what did you call it?", sub: "Your honest read of the sit. This is what we grade.", opts: CALLS, big: true },
    { key: "keyRead", kind: "text", q: "Why? What were you reading?", sub: "Wind, front, sign, moon, pressure.", ph: "Cold front, fresh rubs" },
    { key: "confidence", kind: "choice", q: "How sure were you?", opts: CONFS },
    { key: "hours", kind: "number", q: "How long did you sit?", ph: "4" },
    { key: "outcome", kind: "choice", q: "What did the woods give you?", sub: "None · Distant (far off) · Close (nearly in play) · Encounter (a real chance).", opts: OUTS, big: true },
    { key: "notes", kind: "text", q: "Anything else worth remembering?", ph: "Doe blew out at last light", optional: true },
  ];
  return <StepRunner steps={steps} draft={draft} setDraft={setDraft} onDone={onDone} back={back} finalLabel="check the weather →" />;
}

function StalkSteps({ draft, setDraft, onDone, back }) {
  const steps = [
    { key: "keyRead", kind: "text", q: "What did you glass up, and why go?", sub: "The setup you read before committing.", ph: "Two bucks bedded across the basin, wind in my face" },
    { key: "closest", kind: "text", q: "How close did you get?", sub: "Best guess — yards, or 'never closed'.", ph: "90y" },
    { key: "result", kind: "choice", q: "How'd it end?", opts: RESULTS, big: true },
    { key: "bustCause", kind: "choice", q: "What busted it?", sub: "The leak. Naming it is how you plug it.", opts: CAUSES, onlyIf: (d) => d.result === "Busted" },
    { key: "harvest", kind: "choice", q: "Fill a tag?", opts: ["No", "Yes"], onlyIf: (d) => d.result === "Filled tag" || d.result === "Shot opp" },
    { key: "notes", kind: "text", q: "Anything else worth remembering?", ph: "Backed out clean, didn't spook him", optional: true },
  ];
  return <StepRunner steps={steps} draft={draft} setDraft={setDraft} onDone={onDone} back={back} finalLabel="review this stalk →"
    postProcess={(d) => (d.result !== "Busted" ? { ...d, bustCause: "none" } : d)} />;
}

function WeatherCheck({ day, draft, setDraft, onDone, back }) {
  const [state, setState] = useState("loading");
  const [wx, setWx] = useState(null);
  const [summary, setSummary] = useState("");
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const w = await fetchSitWeather(day.location, day.date);
        if (!live) return;
        const v = detectDrift(w); setWx(w); setSummary(v.summary);
        setState(v.drifted ? "drifted" : "held");
      } catch (e) { if (live) setState("manual"); }
    })();
    return () => { live = false; };
  }, []); // eslint-disable-line
  const finishDrift = (c) => { setDraft((p) => ({ ...p, wx, drift: true, adaptGood: ADAPT_MAP[c] })); onDone(); };
  const finishHeld = () => { setDraft((p) => ({ ...p, wx, drift: false, adaptGood: null })); onDone(); };
  const manualAdapt = (c) => { setDraft((p) => ({ ...p, wx: null, drift: true, adaptGood: ADAPT_MAP[c] })); onDone(); };
  return (
    <div className="rl-wrap">
      <Top back={back} label="the adjust" />
      {state === "loading" && <><h2 className="rl-q">Checking what the weather actually did…</h2><p className="rl-qsub">Pulling the real conditions over your sit window — wind, pressure, temp — not the forecast.</p><div className="rl-wxload"><span /><span /><span /></div></>}
      {state === "held" && <><h2 className="rl-q">Conditions held.</h2><p className="rl-qsub">The weather stayed put through your sit — nothing to adapt to, so this one rides on The Read alone.</p><div className="rl-wxverdict">steady through the sit — {summary || "no material shift"}</div><div className="rl-flownav"><button className="rl-primary rl-grow" onClick={finishHeld}>continue →</button></div></>}
      {state === "drifted" && <><h2 className="rl-q">The woods changed on you.</h2><p className="rl-qsub">The record shows it moved mid-sit — and you didn't tell us that, the weather did. This is the moment The Adjust grades.</p><div className="rl-wxverdict big">⛅ {summary}</div><div className="rl-adaptq">When it shifted — what did you do?</div><div className="rl-chips big rl-stack">{ADAPT.map((o) => <button key={o} className="rl-chip" onClick={() => finishDrift(o)}>{o}</button>)}</div></>}
      {state === "manual" && <><h2 className="rl-q">Did the wind or weather shift while you sat?</h2><p className="rl-qsub">Couldn't reach the weather record for this spot — so tell us. On your own domain this check runs automatically.</p><div className="rl-chips big"><button className="rl-chip" onClick={() => setState("manualAdapt")}>Yes, it shifted</button><button className="rl-chip" onClick={finishHeld}>No, it held</button></div></>}
      {state === "manualAdapt" && <><h2 className="rl-q">When it shifted — what did you do?</h2><p className="rl-qsub">This is The Adjust: reading the change and moving with it.</p><div className="rl-chips big rl-stack">{ADAPT.map((o) => <button key={o} className="rl-chip" onClick={() => manualAdapt(o)}>{o}</button>)}</div></>}
    </div>
  );
}

function StepRunner({ steps, draft, setDraft, onDone, back, finalLabel, postProcess }) {
  const seq = steps.filter((s) => !s.onlyIf || s.onlyIf(draft));
  const [i, setI] = useState(0);
  const step = seq[Math.min(i, seq.length - 1)];
  const sp = useSpeech();
  useEffect(() => { sp.reset(); if (sp.listening) sp.stop(); /* eslint-disable-next-line */ }, [i]);
  useEffect(() => {
    if (!sp.text) return;
    if (step.kind === "text" || step.kind === "number") setDraft((p) => ({ ...p, [step.key]: sp.text }));
    if (step.kind === "choice") { const m = matchChoice(sp.text, step.opts); if (m) setDraft((p) => ({ ...p, [step.key]: m })); }
  }, [sp.text]); // eslint-disable-line
  const set = (v) => setDraft((p) => postProcess ? postProcess({ ...p, [step.key]: v }) : { ...p, [step.key]: v });
  const val = draft[step.key];
  const canNext = step.optional || step.kind === "bool" ? (step.kind === "bool" ? val != null : true) : (val !== "" && val != null);
  const realSeqLen = steps.filter((s) => !s.onlyIf || s.onlyIf(draft)).length;
  const last = i >= realSeqLen - 1;
  const next = () => { if (last) onDone(); else setI(i + 1); };
  const prev = () => (i ? setI(i - 1) : back());

  return (
    <div className="rl-wrap rl-flow">
      <div className="rl-flowtop"><button className="rl-back" onClick={prev}>← back</button><div className="rl-prog"><span style={{ width: `${((i + 1) / realSeqLen) * 100}%` }} /></div><span className="rl-stepn">{i + 1}/{realSeqLen}</span></div>
      <div className="rl-stepcard">
        <h2 className="rl-q">{step.q}</h2>
        {step.sub && <p className="rl-qsub">{step.sub}</p>}
        {step.kind === "choice" && <div className={"rl-chips " + (step.big ? "big" : "")}>{step.opts.map((o) => <button key={o} className={"rl-chip " + (val === o ? "on" : "")} onClick={() => set(o)}>{o}</button>)}</div>}
        {step.kind === "bool" && <div className="rl-chips big"><button className={"rl-chip " + (val === true ? "on" : "")} onClick={() => set(true)}>Yes, it shifted</button><button className={"rl-chip " + (val === false ? "on" : "")} onClick={() => set(false)}>No, it held</button></div>}
        {step.kind === "text" && <textarea className="rl-input" rows={2} value={val} placeholder={step.ph} onChange={(e) => set(e.target.value)} />}
        {step.kind === "number" && <input className="rl-input" inputMode="decimal" value={val} placeholder={step.ph} onChange={(e) => set(e.target.value)} />}
        {sp.supported && step.kind !== "bool" && <button className={"rl-mic " + (sp.listening ? "live" : "")} onClick={() => (sp.listening ? sp.stop() : sp.start())}><Mic /> {sp.listening ? "listening… tap to stop" : step.kind === "choice" ? "or say it" : "or speak"}</button>}
      </div>
      <div className="rl-flownav">
        {step.optional && (val === "" || val == null) && <button className="rl-ghost" onClick={next}>skip</button>}
        <button className="rl-primary rl-grow" onClick={next} disabled={!canNext}>{last ? finalLabel : "next →"}</button>
      </div>
    </div>
  );
}

function matchChoice(text, opts) {
  const t = text.toLowerCase();
  for (const o of opts) if (t.includes(o.toLowerCase())) return o;
  if (t.match(/\byes|yeah|yep\b/) && opts.includes("Yes")) return "Yes";
  if (t.match(/\bno|nope\b/) && opts.includes("No")) return "No";
  return null;
}

function EffortConfirm({ draft, setDraft, onBack, onSave }) {
  const isSit = draft.type === "sit";
  return (
    <div className="rl-wrap">
      <Top back={onBack} label="confirm" />
      <h2 className="rl-q">Confirm your {isSit ? "sit" : "stalk"}.</h2>
      <p className="rl-qsub">You own this read — the app only took dictation.</p>
      {isSit ? (
        <>
          <div className="rl-grid">
            <F l="Call"><Sel v={draft.call} opts={CALLS} onC={(v) => setDraft({ ...draft, call: v })} /></F>
            <F l="Confidence"><Sel v={draft.confidence} opts={CONFS} onC={(v) => setDraft({ ...draft, confidence: v })} /></F>
            <F l="Hours"><input value={draft.hours} onChange={(e) => setDraft({ ...draft, hours: e.target.value })} /></F>
            <F l="Outcome"><Sel v={draft.outcome} opts={OUTS} onC={(v) => setDraft({ ...draft, outcome: v })} /></F>
          </div>
          <F l="Your read (why)"><input value={draft.keyRead} onChange={(e) => setDraft({ ...draft, keyRead: e.target.value })} /></F>
          <div className="rl-driftline">{sitDrifted(draft) ? `Weather moved (${driftSummaryOf(draft)}) · you ${draft.adaptGood === "yes" ? "adjusted" : "missed it"}` : "Conditions held — no Adjust scored"}</div>
        </>
      ) : (
        <>
          <F l="The setup (why you went)"><input value={draft.keyRead} onChange={(e) => setDraft({ ...draft, keyRead: e.target.value })} /></F>
          <div className="rl-grid">
            <F l="Closest"><input value={draft.closest} onChange={(e) => setDraft({ ...draft, closest: e.target.value })} /></F>
            <F l="Result"><Sel v={draft.result} opts={RESULTS} onC={(v) => setDraft({ ...draft, result: v })} /></F>
          </div>
          {draft.result === "Busted" && <F l="What busted it"><Sel v={draft.bustCause} opts={CAUSES} onC={(v) => setDraft({ ...draft, bustCause: v })} /></F>}
        </>
      )}
      <F l="Notes"><input value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></F>
      <div className="rl-flownav"><button className="rl-primary rl-grow" onClick={onSave}>save this effort</button></div>
    </div>
  );
}

/* ------------------------------ LOGBOOK ------------------------------ */
function Logbook({ efforts, back, del }) {
  const [open, setOpen] = useState(null);
  const days = groupByDay(efforts);
  return (
    <div className="rl-wrap">
      <Top back={back} label="logbook" />
      <h2 className="rl-q">Your logbook</h2>
      {days.length === 0 ? <div className="rl-empty">Nothing logged yet. Head back and log a day — the story starts with one.</div> : (
        <div className="rl-bookrows">
          {days.map((d) => {
            const isOpen = open === d.dayId;
            const mixed = d.efforts.some((e) => e.type === "sit") && d.efforts.some((e) => e.type === "stalk");
            return (
              <div className={"rl-bookrow " + (isOpen ? "open" : "")} key={d.dayId}>
                <button className="rl-bookhead" onClick={() => setOpen(isOpen ? null : d.dayId)}>
                  <span className="rl-date">{d.date}</span><span className="rl-loc">{d.location}</span>
                  <span className="rl-effcount">{d.efforts.map((e) => <i key={e.id} className={"rl-dot " + e.type} />)}{mixed && <em>mixed</em>}</span>
                </button>
                {isOpen && (
                  <div className="rl-bookbody">
                    {d.efforts.map((e) => (
                      <div className="rl-effcard" key={e.id}>
                        <div className="rl-effhead"><span className={"rl-tagpill " + e.type}>{e.type}</span>
                          {e.type === "sit"
                            ? <><span className={"rl-call c" + CALL[e.call]}>{e.call}</span><span className="rl-arrow">→</span><span className="rl-out">{e.outcome}</span>{sitDrifted(e) && <span className={"rl-adot " + (e.adaptGood === "yes" ? "y" : "n")}>{e.adaptGood === "yes" ? "adjusted" : "missed shift"}</span>}<span className="rl-cal">{pct(calOf(e))}</span></>
                            : <><span className="rl-out">{e.result}</span>{e.bustCause !== "none" && e.bustCause && <span className="rl-bust">{e.bustCause}</span>}{e.closest && <span className="rl-range">{e.closest}</span>}</>}
                        </div>
                        <div className="rl-effread">{e.keyRead}</div>
                        {e.type === "sit" && sitDrifted(e) && <div className="rl-wxline">⛅ {driftSummaryOf(e)}</div>}
                        {e.notes && <div className="rl-effnotes">{e.notes}</div>}
                      </div>
                    ))}
                    <button className="rl-del" onClick={() => { del(d.dayId); setOpen(null); }}>delete this day</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------- COACH ------------------------------- */
function Coach({ read, adjust, stalks, efforts, back }) {
  const [txt, setTxt] = useState(""); const [loading, setLoading] = useState(false); const [err, setErr] = useState("");
  const [explain, setExplain] = useState(null);
  const enough = read.nSits >= 2 || stalks.n >= 1;

  async function getRead() {
    setLoading(true); setErr(""); setTxt("");
    const facts = {
      theRead: read.score == null ? "still warming up (need more varied sits)" : Math.round(read.score * 100) + "/100",
      readStairStep: read.step.filter((s) => s.n).map((s) => `${s.call}: avg outcome ${s.avg.toFixed(2)} (n=${s.n})`),
      theAdjust: adjust.score == null ? "no drift-days yet" : `${adjust.ok} of ${adjust.n} weather-shift days handled well`,
      stalks: `${stalks.n} committed, ${stalks.busted} busted` + (stalks.topCause ? `, most common leak: ${stalks.topCause[0]} (${stalks.topCause[1]}x)` : ""),
      recent: efforts.slice(-6).map((e) => e.type === "sit" ? `${e.date} SIT: called ${e.call} → ${e.outcome}${e.drift ? (e.adaptGood === "yes" ? " (adjusted to shift)" : " (missed a shift)") : ""}` : `${e.date} STALK: ${e.result}${e.bustCause !== "none" ? " — " + e.bustCause : ""}`),
    };
    const system = "You are a hunting-skills mentor reading a hunter's log. Numbers were computed for you — treat as given, never invent. Talk like a mentor at a tailgate: direct, specific, warm. HARD RULE: never say where animals are, never suggest anything that makes hunting easier or shortcuts effort. You sharpen how they READ conditions and how they hunt with skill — judgment, not yield.";
    const user = "Computed:\n" + JSON.stringify(facts, null, 2) + "\n\nUnder 160 words, no headers, no preamble:\n1) Are their READS sharpening or slipping — cite the stair-step or score.\n2) Their biggest single leak right now (a sit bias OR a stalk cause).\n3) Two specific things to sharpen next — reading/skill only, never location.\nEnd with one honest line about the effort itself.";
    try { setTxt((await callClaude([{ role: "user", content: user }], system)).trim()); }
    catch (e) { setErr("Couldn't reach the coach. Check your connection and try again."); }
    setLoading(false);
  }

  const maxStep = Math.max(1, ...read.step.map((s) => s.avg || 0));
  return (
    <div className="rl-wrap">
      <Top back={back} label="the coach" />
      <h2 className="rl-q">The coach's read</h2>
      {!enough ? <div className="rl-empty">Log a couple of efforts and the coach can start reading your season.</div> : (
        <>
          {/* THE READ */}
          <div className="rl-panel">
            <div className="rl-paneltop"><div><span className="rl-panelname">The Read</span><span className="rl-panelsub">do you call your hunts right?</span></div>
              <div className="rl-panelnum">{read.score == null ? <em>{read.need} more sits</em> : Math.round(read.score * 100)}</div></div>
            {read.score != null && (
              <>
                <div className="rl-stair">{read.step.map((s) => (
                  <div className="rl-stairbar" key={s.call}>
                    <div className="rl-stairfill" style={{ height: `${s.avg == null ? 2 : 12 + (s.avg / maxStep) * 78}%`, opacity: s.n ? 1 : 0.25 }} />
                    <span className="rl-stairlab">{s.call}</span>
                  </div>
                ))}</div>
                <div className="rl-plainline">Your good days really are your good days — the taller the climb left-to-right, the more your gut is worth trusting.</div>
              </>
            )}
            <button className="rl-explain" onClick={() => setExplain(explain === "read" ? null : "read")}>how's this figured?</button>
            {explain === "read" && <div className="rl-explainbody">Before every sit you called it — Dead to Prime. Across the whole season we lined those calls up against what actually showed. When your higher calls really do out-produce your lower ones, The Read climbs. We use your <b>whole season</b>, so one weird day barely moves it — and calling everything "Marginal" to stay safe just flattens the steps and <b>lowers</b> your score. No hedging your way to a good number.</div>}
          </div>

          {/* THE ADJUST */}
          <div className="rl-panel">
            <div className="rl-paneltop"><div><span className="rl-panelname">The Adjust</span><span className="rl-panelsub">when it changes, do you change too?</span></div>
              <div className="rl-panelnum">{adjust.score == null ? <em>no shift days yet</em> : <>{adjust.ok}<i>/{adjust.n}</i></>}</div></div>
            {adjust.n > 0 ? (
              <div className="rl-drifts">{adjust.list.map((d, i) => <div className="rl-driftrow" key={i}><span className={"rl-check " + (d.ok ? "y" : "n")}>{d.ok ? "✓" : "✗"}</span><span className="rl-date">{d.date}</span><span className="rl-wxsum">{d.summary}</span></div>)}</div>
            ) : <div className="rl-plainline">The Adjust only scores days the weather actually moved on you — none yet. It grades reaction, not luck, so slow days count the same as good ones.</div>}
            <button className="rl-explain" onClick={() => setExplain(explain === "adj" ? null : "adj")}>how's this figured?</button>
            {explain === "adj" && <div className="rl-explainbody">After each hunt we check what the weather actually did while you sat — not the forecast, what really happened. On the days it moved, we ask what you did: notice it, reposition, re-read the wind — or was holding tight the smart call. The times the woods changed and you changed with them, that's your Adjust. A dead sit where you read the shift right still counts as a win.</div>}
          </div>

          {/* STALK LEAK MAP */}
          {stalks.n > 0 && (
            <div className="rl-panel">
              <div className="rl-paneltop"><div><span className="rl-panelname">Stalks</span><span className="rl-panelsub">where your stalks leak</span></div>
                <div className="rl-panelnum small"><em>{stalks.n} logged</em></div></div>
              <div className="rl-leaks">{Object.keys(stalks.causes).length ? Object.entries(stalks.causes).sort((a, b) => b[1] - a[1]).map(([c, n]) => (
                <div className="rl-leakrow" key={c}><span className="rl-leakn">{n}×</span><span className="rl-leakc">{c}</span><div className="rl-leakbar"><span style={{ width: `${(n / stalks.busted) * 100}%` }} /></div></div>
              )) : <div className="rl-plainline">No busted stalks logged — clean work.</div>}</div>
              {stalks.topCause && <div className="rl-plainline">{stalks.topCause[0]} is your biggest leak. That's the skill to drill before the next one.</div>}
              <div className="rl-notescored">logged &amp; coached — not scored yet (stalks need more volume for an honest number)</div>
            </div>
          )}

          <button className="rl-primary rl-full" onClick={getRead} disabled={loading}>{loading ? "reading your season…" : "read my season →"}</button>
          <div className="rl-tagline"><span className="rl-tag">math: computed · words: AI</span></div>
          {err && <div className="rl-err">{err}</div>}
          {txt && <div className="rl-coach">{txt}</div>}
        </>
      )}
    </div>
  );
}

/* -------------------------------- bits ------------------------------- */
function Top({ back, label }) { return <div className="rl-flowtop"><button className="rl-back" onClick={back}>← back</button><span className="rl-stepn">{label}</span></div>; }
function F({ l, children }) { return <label className="rl-field"><span>{l}</span>{children}</label>; }
function Sel({ v, opts, onC }) { return <select value={v} onChange={(e) => onC(e.target.value)}><option value="">—</option>{opts.map((o) => <option key={o} value={o}>{o}</option>)}</select>; }
function Mic() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><line x1="12" y1="18" x2="12" y2="22" /></svg>; }
function IconPen() { return <svg className="rl-dicon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>; }
function IconBook() { return <svg className="rl-dicon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 5a2 2 0 0 1 2-2h13v18H6a2 2 0 0 0-2 2Z" /><path d="M9 3v16" /></svg>; }
function IconAntler() { return <svg className="rl-dicon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M12 22v-8" /><path d="M12 14c-1-2-1-3-3-4-1.5-.7-2-2-2-4M6 6c-1 .5-2 .3-3-.5M9 4c-.5-1-1.5-1.5-2.5-1.5" /><path d="M12 14c1-2 1-3 3-4 1.5-.7 2-2 2-4M18 6c1 .5 2 .3 3-.5M15 4c.5-1 1.5-1.5 2.5-1.5" /></svg>; }

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,900&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500;700&display=swap');
.rl{--ink:#0F140F;--panel:#171E17;--panel2:#1F271F;--bone:#EDE8DB;--lichen:#93A08C;--ember:#E0A24A;--rust:#C06B4A;--line:rgba(237,232,219,.10);background:var(--ink);color:var(--bone);font-family:'Inter',system-ui,sans-serif;min-height:100vh;-webkit-font-smoothing:antialiased}
.rl *{box-sizing:border-box}
.rl-wrap{max-width:680px;margin:0 auto;padding:30px 20px 56px}
.rl-eyebrow{font:600 11px/1 'JetBrains Mono',monospace;letter-spacing:.2em;color:var(--lichen);margin-bottom:14px}
.rl-title{font-family:'Fraunces',serif;font-weight:900;font-size:clamp(34px,9vw,58px);line-height:.98;letter-spacing:-.02em;margin:0 0 16px}
.rl-sub{color:var(--lichen);font-size:15px;line-height:1.55;max-width:54ch;margin:0 0 26px}
.rl-sub em,.rl-qsub em{color:var(--bone);font-style:italic}
.rl-twoscore{display:flex;gap:12px;margin:6px 0 26px}
.rl-scorechip{flex:1;background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:16px 18px}
.rl-scoreval{font-family:'JetBrains Mono',monospace;font-weight:700;font-size:40px;color:var(--ember);line-height:1}
.rl-scoreval i{font-style:normal;font-size:22px;color:var(--lichen)}
.rl-gate{color:var(--lichen)}
.rl-scorelab{font-family:'Fraunces',serif;font-size:17px;font-weight:600;margin-top:8px}
.rl-scorehint{font-size:12px;color:var(--lichen);margin-top:2px}
.rl-doors{display:flex;flex-direction:column;gap:12px;margin-bottom:22px}
.rl-door{display:flex;align-items:center;gap:16px;text-align:left;background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:20px;cursor:pointer;color:var(--bone);transition:border-color .15s,transform .1s}
.rl-door:hover{border-color:rgba(224,162,74,.45);transform:translateY(-1px)}
.rl-dicon{width:26px;height:26px;color:var(--ember);flex-shrink:0}
.rl-door h3{font-family:'Fraunces',serif;font-weight:600;font-size:20px;margin:0 0 3px}
.rl-door p{margin:0;font-size:13px;color:var(--lichen);line-height:1.4}
.rl-chev{margin-left:auto;color:var(--lichen);font-size:18px}
.rl-center{display:block;margin:0 auto 20px}
.rl-foot{color:var(--lichen);font-size:12.5px;font-style:italic;text-align:center;margin-top:26px;line-height:1.5;font-family:'Fraunces',serif}
.rl-flowtop{display:flex;align-items:center;gap:12px;margin-bottom:28px}
.rl-back{background:none;border:none;color:var(--lichen);font:500 13px 'Inter';cursor:pointer;padding:0}
.rl-prog{flex:1;height:3px;background:var(--panel2);border-radius:2px;overflow:hidden}
.rl-prog span{display:block;height:100%;background:var(--ember);transition:width .3s ease}
.rl-stepn{font:600 11px 'JetBrains Mono',monospace;color:var(--lichen);text-transform:lowercase}
.rl-flow{display:flex;flex-direction:column;min-height:78vh}
.rl-stepcard{flex:1;padding-top:10px}
.rl-q{font-family:'Fraunces',serif;font-weight:600;font-size:clamp(24px,6vw,34px);line-height:1.1;letter-spacing:-.01em;margin:0 0 10px}
.rl-qsub{color:var(--lichen);font-size:14px;line-height:1.5;margin:0 0 22px;max-width:52ch}
.rl-chips{display:flex;flex-wrap:wrap;gap:10px}
.rl-chips.big .rl-chip{font-size:16px;padding:14px 22px}
.rl-chip{background:var(--panel);border:1px solid var(--line);color:var(--bone);border-radius:999px;font:500 14px 'Inter';padding:11px 18px;cursor:pointer;transition:all .12s}
.rl-chip:hover{border-color:var(--lichen)}
.rl-chip.on{background:var(--ember);color:#20160A;border-color:var(--ember);font-weight:600}
.rl-input{width:100%;background:var(--panel);border:1px solid var(--line);border-radius:5px;color:var(--bone);font-family:inherit;font-size:16px;padding:14px;resize:vertical;line-height:1.5}
.rl-input:focus{outline:none;border-color:var(--ember)}
.rl-input::placeholder{color:#5C6A57}
.rl-daterow{display:flex;gap:10px;align-items:center;margin-bottom:4px}
.rl-dateinput{width:auto;flex:1}
.rl-mic{margin-top:16px;background:var(--panel2);border:1px solid var(--line);color:var(--bone);border-radius:5px;font:500 13px 'Inter';padding:11px 16px;cursor:pointer;display:inline-flex;align-items:center;gap:8px}
.rl-mic.live{border-color:var(--ember);color:var(--ember);animation:rlpulse 1.4s ease-in-out infinite}
@keyframes rlpulse{0%,100%{box-shadow:0 0 0 0 rgba(224,162,74,.35)}50%{box-shadow:0 0 0 7px rgba(224,162,74,0)}}
.rl-flownav{display:flex;gap:10px;margin-top:24px;align-items:center}
.rl-flownav.rl-col{flex-direction:column}
.rl-grow{flex:1}.rl-col .rl-grow{width:100%}
.rl-primary{background:var(--ember);color:#20160A;border:none;border-radius:5px;font:600 15px 'Inter';padding:14px 20px;cursor:pointer;text-align:center}
.rl-primary:disabled{opacity:.35;cursor:default}
.rl-full{width:100%;margin-top:8px}
.rl-ghost{background:none;border:1px solid var(--line);color:var(--lichen);border-radius:5px;font:500 13px 'Inter';padding:13px 16px;cursor:pointer;text-align:center}
.rl-branch{display:flex;flex-direction:column;gap:12px;margin-top:8px}
.rl-branchbtn{text-align:left;background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:20px;cursor:pointer;color:var(--bone)}
.rl-branchbtn:hover{border-color:var(--ember)}
.rl-branchbtn b{font-family:'Fraunces',serif;font-size:22px;font-weight:600;display:block;margin-bottom:4px}
.rl-branchbtn span{font-size:13px;color:var(--lichen);line-height:1.4}
.rl-recap{margin:6px 0;display:flex;flex-direction:column;gap:8px}
.rl-recapitem{display:flex;align-items:center;gap:10px;font-size:14px;padding:10px 14px;background:var(--panel);border:1px solid var(--line);border-radius:5px}
.rl-tagpill{font:600 10px 'JetBrains Mono',monospace;text-transform:uppercase;letter-spacing:.08em;padding:3px 8px;border-radius:3px;border:1px solid var(--line)}
.rl-tagpill.sit{color:var(--ember)}.rl-tagpill.stalk{color:#8FB0C4}
.rl-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:6px}
.rl-field{display:block;margin-top:10px}
.rl-field>span{display:block;font:600 10px 'JetBrains Mono',monospace;letter-spacing:.1em;color:var(--lichen);margin-bottom:5px;text-transform:uppercase}
.rl-field input,.rl-field select{width:100%;background:var(--panel);border:1px solid var(--line);border-radius:4px;color:var(--bone);font-family:inherit;font-size:15px;padding:11px}
.rl-field input:focus,.rl-field select:focus{outline:none;border-color:var(--ember)}
.rl-driftline{margin-top:14px;font-size:13px;color:var(--lichen);font-style:italic}
.rl-err{color:var(--rust);font-size:13px;margin-top:14px}
.rl-empty{color:var(--lichen);font-size:14.5px;font-style:italic;padding:24px 0;line-height:1.5}
.rl-bookrows{margin-top:4px}
.rl-bookrow{border-bottom:1px solid var(--line)}
.rl-bookhead{width:100%;display:flex;align-items:center;gap:10px;padding:15px 0;background:none;border:none;color:var(--bone);cursor:pointer;text-align:left;font-size:14px}
.rl-date{font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--lichen);flex-shrink:0}
.rl-loc{font-weight:600;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rl-effcount{display:flex;align-items:center;gap:5px;margin-left:auto}
.rl-dot{width:8px;height:8px;border-radius:2px;display:inline-block}
.rl-dot.sit{background:var(--ember)}.rl-dot.stalk{background:#8FB0C4}
.rl-effcount em{font:600 10px 'JetBrains Mono',monospace;color:var(--lichen);font-style:normal;margin-left:4px;text-transform:uppercase}
.rl-bookbody{padding:2px 0 16px;animation:rlfade .2s ease}
@keyframes rlfade{from{opacity:0}to{opacity:1}}
.rl-effcard{padding:12px 0;border-top:1px solid var(--line)}
.rl-effhead{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13.5px}
.rl-call{font:600 11px 'JetBrains Mono',monospace;padding:2px 8px;border-radius:3px;border:1px solid var(--line)}
.rl-call.c0{color:#7E8B78}.rl-call.c1{color:#B7A96B}.rl-call.c2{color:#CBBE6A}.rl-call.c3{color:var(--ember);border-color:rgba(224,162,74,.4)}
.rl-arrow{color:var(--lichen)}.rl-out{font-size:13px}
.rl-adot{font:600 10px 'JetBrains Mono',monospace;padding:2px 7px;border-radius:3px}
.rl-adot.y{color:var(--ember)}.rl-adot.n{color:var(--rust)}
.rl-cal{margin-left:auto;font-family:'JetBrains Mono',monospace;font-weight:700;color:var(--ember)}
.rl-bust{font:600 10px 'JetBrains Mono',monospace;color:var(--rust);border:1px solid rgba(192,107,74,.4);padding:2px 7px;border-radius:3px}
.rl-range{font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--lichen)}
.rl-effread{font-size:13px;color:var(--bone);margin-top:6px;line-height:1.45}
.rl-effnotes{font-size:12.5px;color:var(--lichen);font-style:italic;margin-top:4px;line-height:1.45}
.rl-del{margin-top:14px;background:none;border:1px solid var(--line);color:var(--rust);border-radius:4px;font:500 12px 'Inter';padding:8px 12px;cursor:pointer}
.rl-panel{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:20px;margin-bottom:14px}
.rl-paneltop{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.rl-panelname{font-family:'Fraunces',serif;font-size:22px;font-weight:600;display:block}
.rl-panelsub{font-size:12.5px;color:var(--lichen)}
.rl-panelnum{font-family:'JetBrains Mono',monospace;font-weight:700;font-size:40px;color:var(--ember);line-height:.9}
.rl-panelnum i{font-style:normal;font-size:22px;color:var(--lichen)}
.rl-panelnum em{font-size:12px;color:var(--lichen);font-style:italic;font-family:'Inter'}
.rl-panelnum.small{font-size:14px}
.rl-stair{display:flex;align-items:flex-end;gap:10px;height:120px;margin:18px 0 6px}
.rl-stairbar{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%}
.rl-stairfill{width:100%;background:linear-gradient(180deg,var(--ember),rgba(224,162,74,.35));border-radius:3px 3px 0 0;transition:height .4s ease}
.rl-stairlab{font:600 10px 'JetBrains Mono',monospace;color:var(--lichen);margin-top:8px;text-transform:uppercase}
.rl-plainline{font-size:13px;color:var(--bone);line-height:1.5;margin-top:10px;font-family:'Fraunces',serif}
.rl-explain{margin-top:14px;background:none;border:none;color:var(--ember);font:500 12.5px 'Inter';cursor:pointer;padding:0;text-decoration:underline;text-underline-offset:3px}
.rl-explainbody{margin-top:10px;font-size:13px;color:var(--lichen);line-height:1.6;border-left:2px solid var(--line);padding-left:14px}
.rl-explainbody b{color:var(--bone)}
.rl-drifts{margin-top:16px;display:flex;flex-direction:column;gap:2px}
.rl-driftrow{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--line);font-size:13px}
.rl-driftrow:last-child{border:none}
.rl-check{font-weight:700}.rl-check.y{color:var(--ember)}.rl-check.n{color:var(--rust)}
.rl-leaks{margin:16px 0 4px;display:flex;flex-direction:column;gap:10px}
.rl-leakrow{display:flex;align-items:center;gap:10px;font-size:13px}
.rl-leakn{font-family:'JetBrains Mono',monospace;font-weight:700;color:var(--rust);width:26px}
.rl-leakc{width:120px}
.rl-leakbar{flex:1;height:6px;background:var(--panel2);border-radius:3px;overflow:hidden}
.rl-leakbar span{display:block;height:100%;background:var(--rust)}
.rl-notescored{margin-top:14px;font:500 11px 'JetBrains Mono',monospace;color:var(--lichen);letter-spacing:.03em}
.rl-tagline{margin:12px 0 0;text-align:center}
.rl-tag{display:inline-block;font:600 10px 'JetBrains Mono',monospace;letter-spacing:.05em;color:var(--ember);border:1px solid var(--line);padding:3px 8px;border-radius:3px}
.rl-coach{margin-top:18px;padding:20px;background:var(--panel);border-left:3px solid var(--ember);border-radius:0 6px 6px 0;font-size:15px;line-height:1.65;white-space:pre-wrap;font-family:'Fraunces',serif}
.rl-wxload{display:flex;gap:8px;margin-top:24px}
.rl-wxload span{width:10px;height:10px;border-radius:50%;background:var(--ember);opacity:.3;animation:rlblink 1.1s ease-in-out infinite}
.rl-wxload span:nth-child(2){animation-delay:.2s}.rl-wxload span:nth-child(3){animation-delay:.4s}
@keyframes rlblink{0%,100%{opacity:.25}50%{opacity:1}}
.rl-wxverdict{margin-top:14px;padding:16px 18px;background:var(--panel);border:1px solid var(--line);border-radius:6px;font-family:'JetBrains Mono',monospace;font-size:14px;color:var(--bone)}
.rl-wxverdict.big{font-size:16px;border-color:rgba(224,162,74,.4);color:var(--ember)}
.rl-adaptq{margin:22px 0 12px;font-family:'Fraunces',serif;font-size:20px;font-weight:600}
.rl-stack{flex-direction:column;align-items:stretch}
.rl-stack .rl-chip{text-align:center}
.rl-wxline{font:500 12px 'JetBrains Mono',monospace;color:var(--lichen);margin-top:5px}
.rl-wxsum{font:500 12px 'JetBrains Mono',monospace;color:var(--lichen);flex:1}
`;
