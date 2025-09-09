/* Core helpers & state (trimmed from previous build but includes Firebase live + QR) */
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
let commentary=[], stats={ rallies:0, longestRun:0, runA:0, runB:0, setStart:Date.now(), setDurations:[] };
let theme = load('vb_theme','dark'); document.documentElement.setAttribute('data-theme', theme);
let viewOnly=false; let liveRoom=null; let unsubLive=null; let mvp={A:0,B:0};

function vibrate(p){ if('vibrate' in navigator) navigator.vibrate(p); }
function notify(text){ if('Notification' in window && Notification.permission==='granted'){ new Notification(text); } }
function fmt(s){ const m=Math.floor(s/60), ss=s%60; return String(m).padStart(2,'0')+':'+String(ss).padStart(2,'0'); }
function toSecs(mmss){ const [m,s]=mmss.split(':').map(x=>parseInt(x||'0',10)); return m*60+(s||0); }

/* Theme + notifications */
on($('#themeBtn'),'click',()=>{
  theme=(document.documentElement.getAttribute('data-theme')==='dark')?'light':'dark';
  document.documentElement.setAttribute('data-theme',theme); store('vb_theme', theme);
});
on($('#notifyBtn'),'click',async()=>{
  if('Notification' in window){
    if(Notification.permission!=='granted') await Notification.requestPermission();
    if(Notification.permission==='granted') new Notification('VolleyBoard notifications enabled');
  }
});

/* Courts */
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

/* Chips */
$$('#modeChips .chip').forEach(ch=>on(ch,'click',()=>{
  $$('#modeChips .chip').forEach(x=>x.classList.remove('active')); ch.classList.add('active'); mode=ch.dataset.mode;
}));
$$('#timedChips .chip').forEach(ch=>on(ch,'click',()=>{
  $$('#timedChips .chip').forEach(x=>x.classList.remove('active')); ch.classList.add('active'); timed=ch.dataset.timed==='true';
  $('#timeInputWrap').style.display=timed?'flex':'none';
}));
$('#timeInputWrap').style.display='none';

/* Swatches */
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

/* Coin toss */
on($('#coinBtn'),'click',()=>{
  serve=Math.random()<0.5?'A':'B';
  $('#coinResult').textContent=(serve==='A'?'Left':'Right')+' serves first';
});

/* Start match */
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
  commentary=[]; mvp={A:0,B:0};
  $('#home').classList.add('hidden'); $('#board').classList.remove('hidden');
  if(timed){ startMatchTimer(); } else { $('#timerLine').classList.add('hidden'); }
  refreshBoard(); livePush('sync');
});

/* Board interactions */
on($('#leftHalf'),'click',()=>{ if(viewOnly) return; scorePoint('A'); });
on($('#rightHalf'),'click',()=>{ if(viewOnly) return; scorePoint('B'); });
on($('#toA'),'click',e=>{ e.stopPropagation(); if(viewOnly) return; callTimeout('A'); });
on($('#toB'),'click',e=>{ e.stopPropagation(); if(viewOnly) return; callTimeout('B'); });
on($('#resetBtn'),'click',()=>{ if(viewOnly) return; fullReset(); });
on($('#statsBtn'),'click',()=> openStats());
on($('#voiceBtn'),'click',()=> toggleVoice());
on($('#voteBtn'),'click',()=> doVoteModal());

/* Voice */
let rec=null, voiceOn=false;
function toggleVoice(){
  if(viewOnly) return;
  if(!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)){
    alert('Speech Recognition not supported'); return;
  }
  if(voiceOn){ rec.stop(); voiceOn=false; $('#voiceBtn').textContent='🎙️ Voice'; return; }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  rec=new SR(); rec.lang='en-US'; rec.continuous=true; rec.interimResults=false;
  rec.onresult=(e)=>{
    for(let i=e.resultIndex;i<e.results.length;i++){
      if(e.results[i].isFinal){
        const t=e.results[i][0].transcript.trim().toLowerCase();
        commentary.push(`[voice] ${t}`); updateCommOut();
        if(t.includes('point left')||t.includes('left point')||t.includes('team a')) scorePoint('A', true);
        if(t.includes('point right')||t.includes('right point')||t.includes('team b')) scorePoint('B', true);
        if(t.includes('timeout left')) callTimeout('A');
        if(t.includes('timeout right')) callTimeout('B');
      }
    }
  };
  rec.onend=()=>{ if(voiceOn) rec.start(); };
  rec.start(); voiceOn=true; $('#voiceBtn').textContent='🛑 Voice';
}

/* Timer */
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
  vibrate([100,50,100,50,200]); notify('Match time expired');
  const lead=Math.abs(A.points-B.points);
  if((A.points>=13||B.points>=13)&&lead>=2){ const w=A.points>B.points?'A':'B'; pushSetWin(w); }
  endMatch('timer');
}

/* Score / Timeouts / Set rules */
function scorePoint(side, viaVoice=false){
  if($('#final').classList.contains('hidden')===false) return;
  if(side==='A'){ A.points++; serve='A'; stats.runA++; stats.runB=0; } else { B.points++; serve='B'; stats.runB++; stats.runA=0; }
  stats.rallies++; stats.longestRun=Math.max(stats.longestRun, stats.runA, stats.runB);
  commentary.push(`${side==='A'?A.name:B.name} scores → ${A.points}-${B.points}`); updateCommOut();
  momentumCheck(); refreshBoard(); checkSetEnd(); livePush('event');
}
function callTimeout(side){
  if(timed && matchSeconds<=300){ showModal('Timeout Unavailable','Last 5:00 of a timed match.'); return; }
  if((side==='A'&&A.timeouts===0)||(side==='B'&&B.timeouts===0)){ showModal('No Timeouts','Both timeouts used this set.'); return; }
  if(side==='A') A.timeouts--; else B.timeouts--;
  refreshBoard();
  showTimeout(side);
  commentary.push(`Timeout – ${side==='A'?A.name:B.name}`); updateCommOut();
  livePush('event');
}
function showTimeout(side){
  const color = side==='A'?A.color:B.color;
  showModal(`${side==='A'?A.name:B.name} Timeout`, `<div id="toCount">30</div>`, [
    {label:'Start', action:()=>{
      let s=30; const el=$('#toCount'); el.textContent=s;
      const id=setInterval(()=>{ s--; el.textContent=s; if(s<=0){clearInterval(id); hideModal(); celebrate('timeout'); vibrate([200]); notify('Timeout ended'); }},1000);
    }},{label:'Close'}
  ], color);
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
  commentary.push(`Set ${sets.length} → ${w==='A'?A.name:B.name} wins ${A.points}-${B.points}`); updateCommOut();
  celebrate('set'); A.points=B.points=0; A.timeouts=B.timeouts=2; A.rotIdx=B.rotIdx=0;
}
function betweenSets(){
  setIndex++; setTarget=(mode==='indoor'&&setIndex===4)?15:(mode==='indoor'?25:(setIndex===2?15:21));
  stats.setStart=Date.now(); stats.runA=stats.runB=0;
  showModal('⏳ Break', 'Next set in 2:00', [{label:'Skip'}]); // auto close in 2:00
  let s=120; const el=document.createElement('div'); el.id='breakTimer'; el.textContent='02:00'; $('#modalBody').appendChild(el);
  const id=setInterval(()=>{ s--; el.textContent=fmt(s); if(s<=0){ clearInterval(id); hideModal(); vibrate([200]); } },1000);
}

/* End match + exports + history */
function endMatch(reason){
  celebrate('match'); showFinal(); saveHistory(); livePush('end');
}
function showFinal(){
  const lines=[]; lines.push(`${mode==='indoor'?'Indoor':'Beach'} (${timed?'Timed':'Untimed'}) – ${courtId}`);
  lines.push(`${A.name} vs ${B.name}`); lines.push('---------------------------');
  sets.forEach((s,i)=>{ const w=s.winner==='A'?A.name:B.name; lines.push(`Set ${i+1}: ${s.a}-${s.b}  Winner: ${w}`); });
  lines.push('---------------------------'); const winner=A.sets===B.sets?'Draw':(A.sets>B.sets?A.name:B.name); lines.push(`Winner: ${winner}`);
  $('#finalBody').innerHTML=lines.join('<br>'); $('#final').classList.remove('hidden');
}
on($('#homeEndBtn'),'click',()=>{ $('#final').classList.add('hidden'); $('#home').classList.remove('hidden'); });
on($('#againBtn'),'click',()=> location.reload());
function download(name, text, mime){ const blob=new Blob([text],{type:mime}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1200); }
on($('#dlTxt'),'click',()=>{ const t=$('#finalBody').innerText.replace(/\n/g,'\r\n'); download(`${A.name}_vs_${B.name}_results.txt`, t,'text/plain'); });
on($('#dlCsv'),'click',()=>{ const rows=[['Set','Team A','Team B','Winner']]; sets.forEach((s,i)=>rows.push([i+1,s.a,s.b,s.winner==='A'?A.name:B.name])); download(`${A.name}_vs_${B.name}_results.csv`, rows.map(r=>r.join(',')).join('\n'),'text/csv'); });
function saveHistory(){ const hist=load('vb_history',[]); hist.unshift({ts:Date.now(),mode,timed,court:courtId,A:{name:A.name},B:{name:B.name},sets,score:`${A.sets}-${B.sets}`}); store('vb_history', hist.slice(0,100)); }

/* History */
function openHistory(){
  const hist=load('vb_history',[]); const div=$('#historyBody'); div.innerHTML='';
  if(hist.length===0){ div.innerHTML='<div class="note">No matches yet.</div>'; }
  hist.forEach(h=>{ const d=document.createElement('div'); d.className='match'; const dt=new Date(h.ts).toLocaleString(); d.innerHTML=`<div><b>${h.A.name}</b> vs <b>${h.B.name}</b> — ${h.score}</div><div class="small">${dt} • ${h.mode} • ${h.timed?'Timed':'Untimed'} • ${h.court}</div>`; div.appendChild(d); });
  $('#historyPanel').classList.remove('hidden');
}
on($('#historyClose'),'click',()=>$('#historyPanel').classList.add('hidden'));
on($('#historyClear'),'click',()=>{ if(confirm('Clear all history?')){ localStorage.removeItem('vb_history'); openHistory(); } });

/* Bracket (same as before, trimmed) */
on($('#bracketBtnTop'),'click',()=>{ $('#bracketPanel').classList.remove('hidden'); renderBracket(load('vb_bracket',null)); });
on($('#bracketClose'),'click',()=>$('#bracketPanel').classList.add('hidden'));
on($('#bracketNew'),'click',()=>{
  const size=parseInt($('#bracketSize').value,10);
  const teams=Array.from({length:size},(_,i)=>prompt('Team '+(i+1),'Team '+(i+1))||('Team '+(i+1)));
  const rounds=Math.log2(size); const cols=[]; cols.push(teams.map((t,i)=>({id:'R1M'+(i>>1), a:i%2===0?teams[i]:null, b:i%2===1?teams[i]:null, res:null})));
  let matches=size/2; for(let r=2;r<=rounds;r++){ cols.push(Array.from({length:matches/2},(_,i)=>({id:'R'+r+'M'+i,a:null,b:null,res:null}))); matches/=2; }
  const bracket={size, cols}; store('vb_bracket',bracket); renderBracket(bracket);
});
function renderBracket(b){
  const body=$('#bracketBody'); body.innerHTML=''; if(!b){ body.innerHTML='<div class="note">Create a new bracket.</div>'; return; }
  b.cols.forEach((col,ci)=>{ const c=document.createElement('div'); c.className='column'; col.forEach((m,mi)=>{ const x=document.createElement('div'); x.className='match'; const a=m.a??'TBD', b2=m.b??'TBD'; x.innerHTML=`<div><b>${a}</b></div><div><b>${b2}</b></div><div class="small">Round ${ci+1}</div>`; on(x,'click',()=>{ if(ci===0){ const winner=prompt(`Winner?\n1) ${a}\n2) ${b2}`)==='1'?a:b2; if(b.cols[ci+1]){ const dest=Math.floor(mi/2); const slot=(mi%2===0)?'a':'b'; b.cols[ci+1][dest][slot]=winner; store('vb_bracket',b); renderBracket(b);} $('#teamAName').value=a; $('#teamBName').value=b2; }}); c.appendChild(x); }); body.appendChild(c); });
}

/* Stats & commentary */
function openStats(){
  const s=[]; s.push(`Sets: ${A.sets}-${B.sets}`); s.push(`Current set score: ${A.points}-${B.points}`); s.push(`Rallies: ${stats.rallies}`); s.push(`Longest run: ${stats.longestRun}`); s.push(`Set durations: ${stats.setDurations.map(x=>fmt(x)).join(', ')}`);
  $('#statsBody').innerHTML=s.join('<br>'); $('#statsPanel').classList.remove('hidden');
}
on($('#statsClose'),'click',()=>$('#statsPanel').classList.add('hidden'));
on($('#commClear'),'click',()=>{ commentary=[]; updateCommOut(); });
on($('#commDownload'),'click',()=>{ const t=commentary.join('\n'); const name=`commentary_${Date.now()}.txt`; const blob=new Blob([t],{type:'text/plain'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1200); });
function updateCommOut(){ $('#commOut').value=commentary.join('\n'); }

/* Momentum suggestion */
function momentumCheck(){ const n=Math.max(stats.runA,stats.runB); if(n>=3){ const team=stats.runA>stats.runB?A.name:B.name; showToast(`Momentum: ${team} on a ${n}-0 run. Consider timeout.`);}}

/* Refined Win Probability (quick Monte Carlo) */
function winProb(){
  // Simulate rest of current set with p=0.5 per rally + lead bias then derive match odds
  const target=setTarget, need=(mode==='indoor')?3:2;
  const trials=400; let matchWins=0;
  for(let t=0;t<trials;t++){
    let a=A.points, b=B.points, wa=A.sets, wb=B.sets;
    let srv=serve;
    while(wa<need && wb<need){
      // finish this set
      while((a<target && b<target) || Math.abs(a-b)<2){
        // slight bias for leader
        const leadBias = 0.02*Math.sign((a-b));
        const p = 0.5 + leadBias;
        if(Math.random()<p){ a++; srv='A'; } else { b++; srv='B'; }
      }
      if(a>b) wa++; else wb++;
      // next set target (final set logic)
      const setNum=wa+wb; const isFinal = (mode==='indoor'&&setNum===4)||(mode==='beach'&&setNum===2);
      const nextTarget = isFinal?15:(mode==='indoor'?25:21);
      a=0; b=0; // reset points
      // keep serve winner
    }
    if(wa>wb) matchWins++;
  }
  const pa=Math.round(100*matchWins/trials);
  return [pa, 100-pa];
}

/* Render */
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
  const [pa,pb]=winProb(); $('#wpA').textContent=pa+'%'; $('#wpB').textContent=pb+'%'; $('#wpLine').classList.remove('hidden');
}

/* Modal & Toast */
function showModal(title, body, actions=[], bg=null){
  $('#modalTitle').textContent=title; $('#modalBody').innerHTML=body; const act=$('#modalActions'); act.innerHTML='';
  actions.forEach(a=>{ const b=document.createElement('button'); b.className='btn'; b.textContent=a.label; b.onclick=()=>{ if(a.action) a.action(); hideModal(); }; act.appendChild(b); });
  $('#modal').classList.remove('hidden');
}
function hideModal(){ $('#modal').classList.add('hidden'); }
let toastT=null;
function showToast(msg){ clearTimeout(toastT); $('#modalTitle').textContent=''; $('#modalBody').innerHTML=msg; $('#modalActions').innerHTML=''; $('#modal').classList.remove('hidden'); toastT=setTimeout(()=>$('#modal').classList.add('hidden'), 2000); }

/* Confetti */
const confettiCanvas=$('#confetti'); const ctx=confettiCanvas.getContext('2d');
function resizeCanvas(){ confettiCanvas.width=innerWidth; confettiCanvas.height=innerHeight; } window.addEventListener('resize',resizeCanvas); resizeCanvas();
let confettiItems=[];
function celebrate(kind){ const n=kind==='match'?200:(kind==='set'?120:60); for(let i=0;i<n;i++){ confettiItems.push({x:Math.random()*innerWidth,y:-10,vy:2+Math.random()*4,vx:(Math.random()-0.5)*2,s:4+Math.random()*6,a:Math.random()*360,c:(Math.random()<.5?A.color:B.color)}); } requestAnimationFrame(tickConfetti); }
function tickConfetti(){ ctx.clearRect(0,0,confettiCanvas.width,confettiCanvas.height); confettiItems.forEach(p=>{ p.y+=p.vy; p.x+=p.vx; p.a+=5; ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.a*Math.PI/180); ctx.fillStyle=p.c; ctx.fillRect(-p.s/2,-p.s/2,p.s,p.s); ctx.restore(); }); confettiItems=confettiItems.filter(p=>p.y<innerHeight+20); if(confettiItems.length) requestAnimationFrame(tickConfetti); }

/* MVP Voting (crowd) */
function doVoteModal(){
  if(viewOnly && !liveRoom){ showToast('Not connected to live room.'); return; }
  showModal('MVP Vote', `<div class="two"><button id="voteA" class="btn">${A.name}</button><button id="voteB" class="btn">${B.name}</button></div><div class="note">One tap sends a vote.</div>`);
  on($('#voteA'),'click',e=>{ e.stopPropagation(); sendVote('A'); });
  on($('#voteB'),'click',e=>{ e.stopPropagation(); sendVote('B'); });
}
async function sendVote(side){
  if(!liveRoom || !window.fb) { showToast('Live not enabled'); return; }
  const {db, doc, updateDoc, increment} = window.fb;
  await updateDoc(doc(db,'matches', liveRoom), { ['mvp_'+side]: increment(1) });
  showToast('Vote sent!');
}

/* Firebase: live state + viewers */
async function fbInit(){
  const cfg = window.FB_CFG; if(!cfg || !cfg.apiKey){ console.warn('No Firebase config set'); return null; }
  const app = window.firebaseApp ?? (window.firebaseApp = firebase.initializeApp(cfg));
  const db = firebase.firestore();
  window.fb = {app, db, doc:firebase.firestore().doc.bind(db), collection:firebase.firestore().collection.bind(db), onSnapshot:firebase.firestore().onSnapshot, setDoc:(ref,data)=>ref.set(data), updateDoc:(ref,data)=>ref.update(data), increment:(n)=>firebase.firestore.FieldValue.increment(n)};
  return window.fb;
}
function serialize(){ return {mode,timed,matchSeconds,setIndex,setTarget,A,B,serve,sets,courtId,stats,mvp}; }
function hydrate(st){ ({mode,timed,matchSeconds,setIndex,setTarget,serve,courtId,stats,mvp}=st); A=st.A; B=st.B; sets=st.sets; refreshBoard(); }
function isViewerURL(){ const u=new URL(location.href); return u.searchParams.get('view')==='1' && !!u.searchParams.get('match'); }

function makeCode(n=6){ const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s=''; for(let i=0;i<n;i++) s+=chars[Math.floor(Math.random()*chars.length)]; return s; }

on($('#liveCreate'),'click', async()=>{
  const fb = await fbInit(); if(!fb){ alert('Add Firebase config in firebase-config.js'); return; }
  const code = makeCode(); liveRoom=code;
  const {db, collection, doc, setDoc} = fb;
  const ref = doc(db,'matches', code);
  await setDoc(ref, { created: Date.now(), state: serialize(), mvp_A:0, mvp_B:0 });
  const url = new URL(location.href); url.searchParams.set('match', code); url.searchParams.set('view','1');
  $('#shareWrap').classList.remove('hidden');
  $('#shareLink').textContent = url.toString();
  // QR using Google Charts API (works online)
  $('#qrImg').src = 'https://chart.googleapis.com/chart?cht=qr&chs=256x256&chl=' + encodeURIComponent(url.toString());
  on($('#copyLink'),'click',async()=>{ try{ await navigator.clipboard.writeText(url.toString()); showToast('Link copied'); }catch(e){ showToast('Copy failed'); } });
  on($('#shareLinkBtn'),'click',async()=>{ if(navigator.share){ try{ await navigator.share({title:'VolleyBoard Live+', text:'Join live match', url:url.toString()}); } catch(e){} } else { showToast('Share not supported'); } });
  if(confirm('Start as controller now?')){
    $('#home').classList.add('hidden'); $('#board').classList.remove('hidden'); viewOnly=false; $('#viewBanner').classList.add('hidden');
    // publish periodic heartbeat
    setInterval(()=> livePush('tick'), 5000);
  }
});

on($('#liveJoin'),'click', async()=>{
  const code=prompt('Enter room code (e.g., ABC123)'); if(!code) return; await joinRoom(code);
});
on($('#roomLoad'),'click', async()=>{
  const code = $('#roomCode').value.trim().toUpperCase(); if(!code) return; await joinRoom(code);
});

async function joinRoom(code){
  const fb = await fbInit(); if(!fb){ alert('Add Firebase config in firebase-config.js'); return; }
  liveRoom=code; const {db, doc, onSnapshot} = fb; const ref = doc(db,'matches', code);
  if(unsubLive) unsubLive();
  unsubLive = onSnapshot(ref, snap=>{
    if(!snap.exists){ showToast('Room not found'); return; }
    const data = snap.data(); hydrate(data.state);
  });
  $('#home').classList.add('hidden'); $('#board').classList.remove('hidden'); viewOnly=true; $('#viewBanner').classList.remove('hidden');
}

async function livePush(type){
  if(!liveRoom || !window.fb) return;
  const {db, doc, updateDoc} = window.fb; const ref = doc(db,'matches', liveRoom);
  try{ await updateDoc(ref, { state: serialize(), updated: Date.now() }); }catch(e){ /* setDoc fallback if first time */ }
}

/* MVP button shows tally for controller */
setInterval(()=>{
  if(!window.fb || !liveRoom) return;
  const {db, doc} = window.fb;
  doc(db,'matches', liveRoom).get().then(snap=>{
    if(snap.exists){
      const d=snap.data(); mvp.A=d.mvp_A||0; mvp.B=d.mvp_B||0;
      $('#voteBtn').textContent=`MVP Vote (${mvp.A}/${mvp.B})`;
    }
  }).catch(()=>{});
}, 5000);

/* URL viewer auto-join */
(async function bootFromURL(){
  refreshCourts();
  if(isViewerURL()){
    const code=new URL(location.href).searchParams.get('match');
    await joinRoom(code);
  }
})();

/* Serialization for other features */
function serializeState(){ return serialize(); }
function fullReset(){ location.reload(); }

/* Simple toast for momentum etc. */
window.addEventListener('keydown',e=>{ if(e.key==='Escape') hideModal(); });
