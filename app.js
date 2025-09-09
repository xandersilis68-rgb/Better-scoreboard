// Helpers
const $ = s=>document.querySelector(s); const $$=s=>[...document.querySelectorAll(s)];
const store=(k,v)=>localStorage.setItem(k, JSON.stringify(v));
const load=(k,d=null)=>{try{return JSON.parse(localStorage.getItem(k))??d;}catch(e){return d;}};
const on=(el,ev,fn)=>el&&el.addEventListener(ev,fn);
const COLORS=['#E53935','#1E88E5','#43A047','#FBC02D','#FB8C00','#8E24AA','#D81B60','#00897B','#111111','#FFFFFF'];

let mode='indoor', timed=false, matchSeconds=20*60;
let setIndex=0, setTarget=25;
let A={name:'Team A', color:'#1E88E5', logo:null, rot:[], rotIdx:0, timeouts:2, points:0, sets:0};
let B={name:'Team B', color:'#E53935', logo:null, rot:[], rotIdx:0, timeouts:2, points:0, sets:0};
let serve='A', sets=[], courtId='Court 1';
let stats={ rallies:0, longestRun:0, runA:0, runB:0, setStart:Date.now(), setDurations:[] };
let theme = load('vb_theme','dark'); document.documentElement.setAttribute('data-theme', theme);
let viewOnly=false; let liveRoom=null; let unsubLive=null;

function fmt(s){ const m=Math.floor(s/60), ss=s%60; return String(m).padStart(2,'0')+':'+String(ss).padStart(2,'0'); }
function toSecs(mmss){ const [m,s]=mmss.split(':').map(x=>parseInt(x||'0',10)); return m*60+(s||0); }

// Theme
on($('#themeBtn'),'click',()=>{
  theme=(document.documentElement.getAttribute('data-theme')==='dark')?'light':'dark';
  document.documentElement.setAttribute('data-theme',theme); store('vb_theme', theme);
});

// Courts
function refreshCourts(){
  const courts=load('vb_courts',['Court 1']); const sel=$('#courtSelect'); sel.innerHTML='';
  courts.forEach(c=>{ const o=document.createElement('option'); o.textContent=c; sel.appendChild(o); });
  sel.value=courtId||courts[0];
}
on($('#newCourtBtn'),'click',()=>{
  const name=prompt('New court name?','Court '+Math.floor(Math.random()*90+2));
  if(!name) return; const courts=load('vb_courts',['Court 1']); if(!courts.includes(name)) courts.push(name);
  store('vb_courts', courts); courtId=name; refreshCourts();
});

// Chips
$$('#modeChips .chip').forEach(ch=>on(ch,'click',()=>{
  $$('#modeChips .chip').forEach(x=>x.classList.remove('active')); ch.classList.add('active'); mode=ch.dataset.mode;
}));
$$('#timedChips .chip').forEach(ch=>on(ch,'click',()=>{
  $$('#timedChips .chip').forEach(x=>x.classList.remove('active')); ch.classList.add('active'); timed=ch.dataset.timed==='true';
  $('#timeInputWrap').style.display=timed?'flex':'none';
}));
$('#timeInputWrap').style.display='none';

// Swatches
function initSwatches(){
  $$('.swatches').forEach(sw=>{
    const side=sw.dataset.for;
    COLORS.forEach(c=>{
      const b=document.createElement('button'); b.className='swatch'; b.style.background=c;
      on(b,'click',()=>{ [...sw.children].forEach(x=>x.classList.remove('active')); b.classList.add('active'); if(side==='A') A.color=c; else B.color=c; refreshBoard(); });
      if((side==='A'&&c===A.color)||(side==='B'&&c===B.color)) b.classList.add('active');
      sw.appendChild(b);
    });
  });
}
initSwatches();

// Coin toss
on($('#coinBtn'),'click',()=>{
  serve=Math.random()<0.5?'A':'B';
  $('#coinResult').textContent=(serve==='A'?'Left':'Right')+' serves first';
});

// Start match
on($('#startBtn'),'click',()=>{
  A.name=$('#teamAName').value.trim()||'Team A';
  B.name=$('#teamBName').value.trim()||'Team B';
  A.rot=[...$('#rotA').querySelectorAll('input')].map(i=>i.value.trim()).filter(Boolean);
  B.rot=[...$('#rotB').querySelectorAll('input')].map(i=>i.value.trim()).filter(Boolean);
  matchSeconds = toSecs($('#matchTime').value.trim()||'20:00');
  const la=$('#logoA').files[0], lb=$('#logoB').files[0];
  if(la){ const fr=new FileReader(); fr.onload=()=>{A.logo=fr.result; refreshBoard();}; fr.readAsDataURL(la); }
  if(lb){ const fr=new FileReader(); fr.onload=()=>{B.logo=fr.result; refreshBoard();}; fr.readAsDataURL(lb); }
  courtId=$('#courtSelect').value||'Court 1';
  setIndex=0; sets=[]; A.points=B.points=0; A.timeouts=B.timeouts=2; A.sets=B.sets=0; A.rotIdx=B.rotIdx=0;
  setTarget=(mode==='indoor'&&setIndex===4)?15:(mode==='indoor'?25:(setIndex===2?15:21));
  stats={rallies:0,longestRun:0,runA:0,runB:0,setStart:Date.now(),setDurations:[]};
  $('#home').classList.add('hidden'); $('#board').classList.remove('hidden');
  if(timed){ startMatchTimer(); } else { $('#timerLine').classList.add('hidden'); }
  refreshBoard(); livePush('sync');
});

// Board interactions
on($('#leftHalf'),'click',()=>{ if(viewOnly) return; scorePoint('A'); });
on($('#rightHalf'),'click',()=>{ if(viewOnly) return; scorePoint('B'); });
on($('#toA'),'click',e=>{ e.stopPropagation(); if(viewOnly) return; callTimeout('A'); });
on($('#toB'),'click',e=>{ e.stopPropagation(); if(viewOnly) return; callTimeout('B'); });
on($('#resetBtn'),'click',()=>{ if(viewOnly) return; fullReset(); });
on($('#statsBtn'),'click',()=> openStats());

// Timer
let tInt=null;
function startMatchTimer(){
  $('#timerLine').classList.remove('hidden');
  updateTimer(); clearInterval(tInt);
  tInt=setInterval(()=>{
    matchSeconds--; if(matchSeconds<=0){ matchSeconds=0; clearInterval(tInt); onTimeExpired(); }
    updateTimer(); livePush('tick');
  },1000);
}
function updateTimer(){ $('#timer').textContent=fmt(matchSeconds); $('#timer').classList.toggle('flash', matchSeconds<=10); }
function onTimeExpired(){
  const lead=Math.abs(A.points-B.points);
  if((A.points>=13||B.points>=13)&&lead>=2){ const w=A.points>B.points?'A':'B'; pushSetWin(w); }
  endMatch('timer');
}

// Score / Timeouts / Set rules
function scorePoint(side){
  if($('#final').classList.contains('hidden')===false) return;
  if(side==='A'){ A.points++; serve='A'; stats.runA++; stats.runB=0; } else { B.points++; serve='B'; stats.runB++; stats.runA=0; }
  stats.rallies++; stats.longestRun=Math.max(stats.longestRun, stats.runA, stats.runB);
  refreshBoard(); checkSetEnd(); livePush('event');
}
function callTimeout(side){
  if(timed && matchSeconds<=300){ showFs('Timeout Unavailable','<p class="note">Timeouts are disabled in the last 5:00 of a timed match.</p>'); return; }
  if((side==='A'&&A.timeouts===0)||(side==='B'&&B.timeouts===0)){ showFs('No Timeouts','<p class="note">Both timeouts used this set.</p>'); return; }
  if(side==='A') A.timeouts--; else B.timeouts--;
  refreshBoard();
  showFs((side==='A'?A.name:B.name)+' Timeout', '<div id="toCount" class="bigTimer">30</div><div class="note">Auto closes at 0</div>', null);
  let s=30; const el=$('#toCount'); const id=setInterval(()=>{ s--; el.textContent=s; if(s<=0){clearInterval(id); closeFs(); }},1000);
}
function checkSetEnd(){
  const target=setTarget; const lead=Math.abs(A.points-B.points);
  if((A.points>=target||B.points>=target)&&lead>=2){
    const w=A.points>B.points?'A':'B'; pushSetWin(w);
    const need=(mode==='indoor')?3:2; if(A.sets>=need||B.sets>=need){ endMatch('normal'); } else { betweenSets(); }
  }
}
function pushSetWin(w){
  sets.push({a:A.points,b:B.points,winner:w}); if(w==='A') A.sets++; else B.sets++;
  const dur=Math.floor((Date.now()-stats.setStart)/1000); stats.setDurations.push(dur);
  celebrate('set'); A.points=B.points=0; A.timeouts=B.timeouts=2; A.rotIdx=B.rotIdx=0;
}
function betweenSets(){
  setIndex++; setTarget=(mode==='indoor'&&setIndex===4)?15:(mode==='indoor'?25:(setIndex===2?15:21));
  stats.setStart=Date.now(); stats.runA=stats.runB=0;
  showFs('Break','<div id="breakTimer" class="bigTimer">02:00</div><div class="note">Next set auto in 2:00</div>');
  let s=120; const el=$('#breakTimer'); const id=setInterval(()=>{ s--; el.textContent=fmt(s); if(s<=0){ clearInterval(id); closeFs(); } },1000);
}

// End match + exports + history
function endMatch(){ celebrate('match'); showFinal(); saveHistory(); livePush('end'); }
function showFinal(){
  const lines=[]; lines.push(`${mode==='indoor'?'Indoor':'Beach'} (${timed?'Timed':'Untimed'}) – ${courtId}`);
  lines.push(`${A.name} vs ${B.name}`); lines.push('---------------------------');
  sets.forEach((s,i)=>{ const w=s.winner==='A'?A.name:B.name; lines.push(`Set ${i+1}: ${s.a}-${s.b}  Winner: ${w}`); });
  lines.push('---------------------------'); const winner=A.sets===B.sets?'Draw':(A.sets>B.sets?A.name:B.name); lines.push(`Winner: ${winner}`);
  $('#finalBody').innerHTML=lines.join('<br>'); $('#final').classList.remove('hidden');
}
on($('#homeEndBtn'),'click',()=>{ $('#final').classList.add('hidden'); $('#home').classList.remove('hidden'); });
on($('#finalClose'),'click',()=>$('#final').classList.add('hidden'));
on($('#againBtn'),'click',()=> location.reload());
function download(name, text, mime){ const blob=new Blob([text],{type:mime}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1200); }
on($('#dlTxt'),'click',()=>{ const t=$('#finalBody').innerText.replace(/\\n/g,'\\r\\n'); download(`${A.name}_vs_${B.name}_results.txt`, t,'text/plain'); });
on($('#dlCsv'),'click',()=>{ const rows=[['Set','Team A','Team B','Winner']]; sets.forEach((s,i)=>rows.push([i+1,s.a,s.b,s.winner==='A'?A.name:B.name])); download(`${A.name}_vs_${B.name}_results.csv`, rows.map(r=>r.join(',')).join('\\n'),'text/csv'); });
function saveHistory(){ const hist=load('vb_history',[]); hist.unshift({ts:Date.now(),mode,timed,court:courtId,A:{name:A.name},B:{name:B.name},sets,score:`${A.sets}-${B.sets}`}); store('vb_history', hist.slice(0,100)); }

// History modal
on($('#historyBtnTop'),'click',()=> openHistory());
function openHistory(){
  const hist=load('vb_history',[]); const div=$('#historyBody'); div.innerHTML='';
  if(hist.length===0){ div.innerHTML='<div class="note">No matches yet.</div>'; }
  hist.forEach(h=>{ const d=document.createElement('div'); d.className='match'; const dt=new Date(h.ts).toLocaleString(); d.innerHTML=`<div><b>${h.A.name}</b> vs <b>${h.B.name}</b> — ${h.score}</div><div class="note">${dt} • ${h.mode} • ${h.timed?'Timed':'Untimed'} • ${h.court}</div>`; div.appendChild(d); });
  $('#historyPanel').classList.remove('hidden');
}
on($('#historyClose'),'click',()=>$('#historyPanel').classList.add('hidden'));
on($('#historyClear'),'click',()=>{ if(confirm('Clear all history?')){ localStorage.removeItem('vb_history'); openHistory(); } });

// Bracket fullscreen modal (improved)
on($('#bracketBtnTop'),'click',()=> openBracket());
function openBracket(){
  const body=`
  <div class="inline">
    <label>Size</label>
    <select id="bracketSize"><option>4</option><option selected>8</option><option>16</option></select>
    <button id="bracketNew" class="btn">New Bracket</button>
    <button id="bracketExport" class="btn">Export</button>
  </div>
  <div id="bracketBody" class="bracket"></div>`;
  showFs('🧩 Tournament Bracket', body);
  renderBracket(load('vb_bracket',null));
  on($('#bracketNew'),'click',()=>{
    const size=parseInt($('#bracketSize').value,10);
    const teams=Array.from({length:size},(_,i)=>prompt('Team '+(i+1),'Team '+(i+1))||('Team '+(i+1)));
    const rounds=Math.log2(size);
    const cols=[];
    // R1
    cols.push(Array.from({length:size/2},(_,i)=>({id:`R1M${i}`, a:teams[i*2], b:teams[i*2+1], w:null})));
    // Next rounds
    let matches=size/2;
    for(let r=2;r<=rounds;r++){ matches/=2; cols.push(Array.from({length:matches},(_,i)=>({id:`R${r}M${i}`, a:null,b:null,w:null}))); }
    const bracket={size, cols};
    store('vb_bracket', bracket); renderBracket(bracket);
  });
  on($('#bracketExport'),'click',()=>{
    const b=load('vb_bracket',null); if(!b){ alert('No bracket to export'); return; }
    const lines=['Bracket Export','--------------'];
    b.cols.forEach((col,ci)=>{
      lines.push(`Round ${ci+1}`);
      col.forEach((m,mi)=> lines.push(`  M${mi+1}: ${m.a||'TBD'} vs ${m.b||'TBD'}  Winner: ${m.w||'TBD'}`));
    });
    const blob=new Blob([lines.join('\\n')],{type:'text/plain'}); const url=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download='bracket.txt'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1200);
  });
}
function renderBracket(b){
  const body=$('#bracketBody'); if(!body) return;
  body.innerHTML='';
  if(!b){ body.innerHTML='<div class="note">Create a new bracket.</div>'; return; }
  b.cols.forEach((col,ci)=>{
    const c=document.createElement('div'); c.className='brCol';
    col.forEach((m,mi)=>{
      const x=document.createElement('div'); x.className='brMatch';
      x.innerHTML=`<button class="slot">${m.a||'TBD'}</button><button class="slot">${m.b||'TBD'}</button><div class="note">Round ${ci+1}</div>`;
      const [sa,sb]=x.querySelectorAll('.slot');
      on(sa,'click',()=> chooseWinner(b,ci,mi,'a'));
      on(sb,'click',()=> chooseWinner(b,ci,mi,'b'));
      c.appendChild(x);
    });
    body.appendChild(c);
  });
}
function chooseWinner(b, ci, mi, side){
  const match=b.cols[ci][mi]; const winner=side==='a'?match.a:match.b; match.w=winner;
  if(b.cols[ci+1]){
    const dst = Math.floor(mi/2);
    const slot = (mi%2===0)?'a':'b';
    b.cols[ci+1][dst][slot]=winner;
  } else {
    celebrate('match'); alert('Champion: '+winner);
  }
  store('vb_bracket', b); renderBracket(b);
}

// Live modal (Firebase optional)
on($('#liveOpen'),'click',()=> openLive());
on($('#liveBtnTop'),'click',()=> openLive());
function openLive(){
  const body=`
    <div class="note">If Firebase isn't configured, you'll see a warning. See README to set it up.</div>
    <div class="two">
      <button id="liveCreate" class="btn">Create Live Room</button>
      <button id="liveJoin" class="btn">Join as Viewer</button>
    </div>
    <div id="liveArea" class="mono" style="margin-top:12px"></div>`;
  showFs('📡 Live Sharing', body);
  on($('#liveCreate'),'click', async()=>{
    if(!window.FB_CFG || !window.FB_CFG.apiKey){ $('#liveArea').innerHTML='<p>⚠ Firebase not configured. Open <code>firebase-config.js</code> and README.</p>'; return; }
    await fbInit();
    const code = Math.random().toString(36).slice(2,8).toUpperCase();
    liveRoom=code;
    const {db, doc, setDoc} = window.fb;
    const ref = doc(db,'matches', code);
    await setDoc(ref, { created: Date.now(), state: serialize() });
    const url = new URL(location.href); url.searchParams.set('match', code); url.searchParams.set('view','1');
    $('#liveArea').innerHTML = '<p>Share this link with viewers:</p><div>'+url.toString()+'</div><img class="qr" src="'+('https://chart.googleapis.com/chart?cht=qr&chs=256x256&chl='+encodeURIComponent(url.toString()))+'">';
  });
  on($('#liveJoin'),'click', async()=>{
    const code=prompt('Enter room code (e.g., ABC123)'); if(!code) return;
    if(!window.FB_CFG || !window.FB_CFG.apiKey){ $('#liveArea').innerHTML='<p>⚠ Firebase not configured.</p>'; return; }
    await joinRoom(code);
  });
}

// Firebase basic helpers
async function fbInit(){
  if(window.fb) return window.fb;
  if(!window.FB_CFG || !window.FB_CFG.apiKey) return null;
  if(!window.firebase){
    const s=document.createElement('script'); s.src='https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js'; document.head.appendChild(s);
    await new Promise(r=>s.onload=r);
    const s2=document.createElement('script'); s2.src='https://www.gstatic.com/firebasejs/8.10.1/firebase-firestore.js'; document.head.appendChild(s2);
    await new Promise(r=>s2.onload=r);
  }
  const app = window.firebaseApp ?? (window.firebaseApp = firebase.initializeApp(window.FB_CFG));
  const db = firebase.firestore();
  window.fb = {app, db, doc:(...a)=>db.doc(...a), collection:(...a)=>db.collection(...a), setDoc:(ref,data)=>ref.set(data), updateDoc:(ref,data)=>ref.update(data), onSnapshot:(ref,cb)=>ref.onSnapshot(cb)};
  return window.fb;
}
function serialize(){ return {mode,timed,matchSeconds,setIndex,setTarget,A,B,serve,sets,courtId,stats}; }
function hydrate(st){ ({mode,timed,matchSeconds,setIndex,setTarget,serve,courtId,stats}=st); A=st.A; B=st.B; sets=st.sets; refreshBoard(); }
async function joinRoom(code){
  const fb = await fbInit(); if(!fb){ alert('Firebase not configured'); return; }
  const {db, doc, onSnapshot} = fb; const ref = doc('matches/'+code);
  if(unsubLive) unsubLive();
  unsubLive = onSnapshot(ref, snap=>{
    if(!snap.exists){ alert('Room not found'); return; }
    const data = snap.data(); hydrate(data.state);
  });
  $('#home').classList.add('hidden'); $('#board').classList.remove('hidden'); viewOnly=true; $('#viewBanner').classList.remove('hidden');
}
async function livePush(){
  if(!liveRoom || !window.fb) return;
  const {db, doc, updateDoc} = window.fb; const ref = doc('matches/'+liveRoom);
  try{ await updateDoc(ref, { state: serialize(), updated: Date.now() }); }catch(e){}
}

// Render
function refreshBoard(){
  $('#leftHalf').style.background=A.color; $('#rightHalf').style.background=B.color;
  $('#nameA').textContent=A.name; $('#nameB').textContent=B.name;
  $('#scoreA').textContent=A.points; $('#scoreB').textContent=B.points;
  $('#serveA').classList.toggle('hidden', serve!=='A'); $('#serveB').classList.toggle('hidden', serve!=='B');
  $('#toDotsA').textContent=A.timeouts===2?'■ ■':(A.timeouts===1?'■ □':'□ □');
  $('#toDotsB').textContent=B.timeouts===2?'■ ■':(B.timeouts===1?'■ □':'□ □');
  $('#setLine').textContent=`Set ${setIndex+1} / Target ${setTarget}`;
  if(A.logo) $('#logoAImg').src=A.logo; if(B.logo) $('#logoBImg').src=B.logo;
  $('#rotationA').classList.toggle('hidden', !(mode==='indoor' && A.rot.length));
  $('#rotationB').classList.toggle('hidden', !(mode==='indoor' && B.rot.length));
  if(A.rot.length) $('#rotationA').textContent='Srv: '+A.rot[A.rotIdx%A.rot.length];
  if(B.rot.length) $('#rotationB').textContent='Srv: '+B.rot[B.rotIdx%B.rot.length];
}

// Confetti
const confettiCanvas=$('#confetti'); const ctx=confettiCanvas.getContext('2d');
function resizeCanvas(){ confettiCanvas.width=innerWidth; confettiCanvas.height=innerHeight; } window.addEventListener('resize',resizeCanvas); resizeCanvas();
let confettiItems=[];
function celebrate(kind){ const n=kind==='match'?200:(kind==='set'?120:60); for(let i=0;i<n;i++){ confettiItems.push({x:Math.random()*innerWidth,y:-10,vy:2+Math.random()*4,vx:(Math.random()-0.5)*2,s:4+Math.random()*6,a:Math.random()*360,c:(Math.random()<.5?A.color:B.color)}); } requestAnimationFrame(tickConfetti); }
function tickConfetti(){ ctx.clearRect(0,0,confettiCanvas.width,confettiCanvas.height); confettiItems.forEach(p=>{ p.y+=p.vy; p.x+=p.vx; p.a+=5; ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.a*Math.PI/180); ctx.fillStyle=p.c; ctx.fillRect(-p.s/2,-p.s/2,p.s,p.s); ctx.restore(); }); confettiItems=confettiItems.filter(p=>p.y<innerHeight+20); if(confettiItems.length) requestAnimationFrame(tickConfetti); }

// Fullscreen modal helpers
on($('#fsClose'),'click',()=> closeFs());
function showFs(title, html){ $('#fsTitle').textContent=title; $('#fsBody').innerHTML=html; $('#fsModal').classList.remove('hidden'); }
function closeFs(){ $('#fsModal').classList.add('hidden'); }

// Serialization & reset
function serializeState(){ return serialize(); }
function fullReset(){ location.reload(); }

// URL viewer auto-join
(async function boot(){ refreshCourts(); if(new URL(location.href).searchParams.get('view')==='1'){ const code=new URL(location.href).searchParams.get('match'); if(code) joinRoom(code); } })();
