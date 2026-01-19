/* LexiQuest — Offline TOEFL 400
   - Daily session (10/14/18)
   - Crossword puzzle generator
   - Hints + audio + image
   - Progress + streak + XP stored locally
*/

const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

// -----------------------------
// Storage
// -----------------------------
const STORAGE_KEY = "lexiquest_v1";
function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return null;
    return JSON.parse(raw);
  }catch{ return null; }
}
function saveState(state){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function todayISO(){
  const d = new Date();
  return d.toISOString().slice(0,10);
}
function daysBetween(aISO, bISO){
  const a = new Date(aISO+"T00:00:00");
  const b = new Date(bISO+"T00:00:00");
  return Math.floor((b - a) / (1000*60*60*24));
}

// -----------------------------
// Data loading
// -----------------------------
async function loadWords(){
  const res = await fetch("data.json");
  if(!res.ok) throw new Error("Failed to load data.json");
  const data = await res.json();
  const words = [];
  for(const lesson of (data.flashcard||[])){
    const lessonId = (lesson.en||"").trim();
    for(const w of (lesson.wordlist||[])){
      words.push({
        lesson: lessonId,
        word: (w.en||"").trim(),
        pron: (w.pron||"").trim(),
        desc: (w.desc||"").trim(),
        examHTML: w.exam||"",
        image: w.image||null,
        sound: w.sound||null,
        // where the asset is located
        assetBase: `./${sanitizeLessonFolder(lessonId)}/wordlist/`
      });
    }
  }
  return words;
}

function sanitizeLessonFolder(lessonName){
  // data folders use: LESSON-1---Food-Crops
  // The lessonName in JSON is: "LESSON 1 - Food Crops"
  // We'll map by searching existing folder names from a prebuilt table if needed.
  // For now, create a robust mapping based on number + words.
  const m = lessonName.match(/LESSON\s*(\d+)\s*-\s*(.+)$/i);
  if(!m) return "";
  const num = m[1];
  const title = m[2]
    .trim()
    .replace(/[’'“”]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `LESSON-${num}---${title}`;
}

// -----------------------------
// Session selection (30-day journey)
// -----------------------------
function getSessionWords(allWords, state){
  const start = state.startDate || todayISO();
  const dayIndex = Math.max(0, daysBetween(start, todayISO()));
  const sessionSize = state.settings.sessionSize;

  // chunk sequentially to keep it predictable
  const chunkStart = (dayIndex * sessionSize) % allWords.length;
  const picked = [];
  for(let i=0;i<sessionSize;i++){
    picked.push(allWords[(chunkStart+i) % allWords.length]);
  }
  return { dayIndex, start, picked };
}

// -----------------------------
// Crossword generator (greedy with intersections)
// -----------------------------
function makeCrossword(words){
  // Use up to 10 words for crossword to keep it compact; rest used in drills.
  const max = Math.min(10, words.length);
  const selected = words.slice(0,max).map(w => ({...w, word: w.word.toUpperCase()}));

  const grid = new Map(); // key "x,y" -> letter
  const placements = []; // {id, word, x, y, dir}

  function key(x,y){ return `${x},${y}`; }
  function get(x,y){ return grid.get(key(x,y)) || null; }
  function set(x,y,ch){ grid.set(key(x,y), ch); }

  // Place first word horizontally at (0,0)
  let first = selected[0];
  placements.push({ id: 0, wordObj: first, word: first.word, x: 0, y: 0, dir: "H" });
  for(let i=0;i<first.word.length;i++) set(i,0, first.word[i]);

  // Helpers
  function canPlace(word, x, y, dir){
    for(let i=0;i<word.length;i++){
      const cx = x + (dir==="H"? i : 0);
      const cy = y + (dir==="V"? i : 0);
      const existing = get(cx,cy);
      if(existing && existing !== word[i]) return false;

      // avoid touching letters side-by-side unless it's a crossing
      const left = get(cx-1, cy);
      const right = get(cx+1, cy);
      const up = get(cx, cy-1);
      const down = get(cx, cy+1);

      if(!existing){
        if(dir==="H"){
          if(up || down) return false;
        }else{
          if(left || right) return false;
        }
      }
    }
    // check cells before and after the word are empty
    const bx = x - (dir==="H"? 1:0);
    const by = y - (dir==="V"? 1:0);
    const ax = x + (dir==="H"? word.length:0);
    const ay = y + (dir==="V"? word.length:0);
    if(get(bx,by)) return false;
    if(get(ax,ay)) return false;
    return true;
  }

  function placeWord(wordObj, id){
    const w = wordObj.word;
    let best = null;

    // Try to intersect with existing letters
    for(const [kLetterPos, letter] of grid.entries()){
      const [sx, sy] = kLetterPos.split(",").map(Number);
      for(let wi=0; wi<w.length; wi++){
        if(w[wi] !== letter) continue;

        // Try horizontal: word crosses vertical letters => place H through (sx,sy)
        let xH = sx - wi;
        let yH = sy;
        if(canPlace(w, xH, yH, "H")){
          const score = intersectionScore(w, xH, yH, "H");
          if(!best || score > best.score) best = {x:xH, y:yH, dir:"H", score};
        }
        // Try vertical
        let xV = sx;
        let yV = sy - wi;
        if(canPlace(w, xV, yV, "V")){
          const score = intersectionScore(w, xV, yV, "V");
          if(!best || score > best.score) best = {x:xV, y:yV, dir:"V", score};
        }
      }
    }

    if(!best) return false;

    placements.push({ id, wordObj, word: w, x: best.x, y: best.y, dir: best.dir });
    for(let i=0;i<w.length;i++){
      const cx = best.x + (best.dir==="H"? i:0);
      const cy = best.y + (best.dir==="V"? i:0);
      set(cx,cy,w[i]);
    }
    return true;
  }

  function intersectionScore(word, x, y, dir){
    let score = 0;
    for(let i=0;i<word.length;i++){
      const cx = x + (dir==="H"? i:0);
      const cy = y + (dir==="V"? i:0);
      const existing = get(cx,cy);
      if(existing === word[i]) score++;
    }
    return score;
  }

  for(let i=1;i<selected.length;i++){
    placeWord(selected[i], i);
  }

  // Bounds
  let minX=0, minY=0, maxX=0, maxY=0;
  for(const k of grid.keys()){
    const [x,y] = k.split(",").map(Number);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  // Normalize coords to start at 0
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const cells = Array.from({length: height}, () => Array.from({length: width}, () => null));
  for(const [k, ch] of grid.entries()){
    const [x,y] = k.split(",").map(Number);
    cells[y-minY][x-minX] = ch;
  }

  const normPlacements = placements.map(p => ({
    ...p,
    x: p.x - minX,
    y: p.y - minY,
  }));

  return { cells, placements: normPlacements, width, height };
}

// -----------------------------
// UI + Game State
// -----------------------------
let ALL_WORDS = [];
let STATE = null;
let GAME = null; // current session game state

function defaultState(){
  return {
    version: 1,
    startDate: todayISO(),
    lastOpenDate: null,
    streak: 0,
    xp: 0,
    settings: { sessionSize: 14 },
    progress: {
      // word -> {level, nextReviewISO, correct, wrong}
    }
  };
}

function bumpStreak(state){
  const today = todayISO();
  const last = state.lastOpenDate;
  if(!last){
    state.streak = 1;
  }else{
    const d = daysBetween(last, today);
    if(d === 0){
      // same day, no change
    }else if(d === 1){
      state.streak += 1;
    }else{
      state.streak = 1;
    }
  }
  state.lastOpenDate = today;
}

function addXP(amount){
  STATE.xp = (STATE.xp||0) + amount;
  $('#xp').textContent = STATE.xp;
}

function updateHUD(){
  $('#streak').textContent = STATE.streak || 0;
  $('#xp').textContent = STATE.xp || 0;
  $('#sessionSize').value = String(STATE.settings.sessionSize || 14);
}

function openSettings(){
  $('#settingsModal').classList.add('open');
}
function closeSettings(){
  $('#settingsModal').classList.remove('open');
}

function htmlToText(html){
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return (tmp.textContent || tmp.innerText || '').replace(/\s+/g,' ').trim();
}

// -----------------------------
// Crossword play
// -----------------------------
function startSession(){
  const { dayIndex, picked } = getSessionWords(ALL_WORDS, STATE);

  $('#dayTitle').textContent = `اليوم ${dayIndex+1} / 30`;
  $('#daySub').textContent = `جلسة اليوم: ${picked.length} كلمة`;

  // Pick due words based on simple SRS: show due words first
  const due = [];
  const fresh = [];
  const today = todayISO();
  for(const w of picked){
    const p = STATE.progress[w.word];
    if(p && p.nextReviewISO && p.nextReviewISO <= today) due.push(w);
    else fresh.push(w);
  }
  const sessionWords = [...due, ...fresh];

  // Crossword uses first 10
  const crosswordWords = sessionWords.slice(0, Math.min(10, sessionWords.length));
  const crossword = makeCrossword(crosswordWords);

  GAME = {
    sessionWords,
    crosswordWords,
    crossword,
    entries: createEmptyEntries(crossword),
    selectedPlacementId: crossword.placements[0]?.id ?? null,
    selectedDir: crossword.placements[0]?.dir ?? 'H',
    solved: new Set(),
    mistakes: 0,
  };

  $('#sessionStart').classList.add('hidden');
  $('#sessionView').classList.remove('hidden');

  renderCrossword();
  renderClues();
  updateSelectedClueUI();
  renderDrillCards();
}

function createEmptyEntries(crossword){
  const {width, height} = crossword;
  return Array.from({length: height}, () => Array.from({length: width}, () => ""));
}

function renderCrossword(){
  const gridEl = $('#grid');
  gridEl.innerHTML = '';
  const {cells, width, height} = GAME.crossword;

  gridEl.style.setProperty('--cols', width);
  gridEl.style.setProperty('--rows', height);

  for(let y=0;y<height;y++){
    for(let x=0;x<width;x++){
      const isWall = cells[y][x] === null;
      const btn = document.createElement('button');
      btn.className = 'cell' + (isWall ? ' wall' : '');
      btn.type = 'button';
      btn.dataset.x = String(x);
      btn.dataset.y = String(y);
      if(!isWall){
        btn.textContent = GAME.entries[y][x] || '';
      }
      btn.addEventListener('click', () => onCellClick(x,y));
      gridEl.appendChild(btn);
    }
  }

  highlightSelection();
}

function placementCells(p){
  const coords = [];
  for(let i=0;i<p.word.length;i++){
    const x = p.x + (p.dir==='H'? i:0);
    const y = p.y + (p.dir==='V'? i:0);
    coords.push({x,y, i});
  }
  return coords;
}

function onCellClick(x,y){
  // Find placements that include this cell
  const ps = GAME.crossword.placements.filter(p => placementCells(p).some(c => c.x===x && c.y===y));
  if(ps.length===0) return;

  // toggle between H/V if both exist
  let chosen = ps[0];
  if(ps.length===2){
    const current = GAME.crossword.placements.find(p => p.id===GAME.selectedPlacementId);
    if(current && current.id===ps[0].id) chosen = ps[1];
  }

  GAME.selectedPlacementId = chosen.id;
  GAME.selectedDir = chosen.dir;
  highlightSelection();
  updateSelectedClueUI();
}

function highlightSelection(){
  const gridEl = $('#grid');
  const cellsEl = $$('.cell', gridEl);
  cellsEl.forEach(c => c.classList.remove('active','sel','correct'));

  const p = GAME.crossword.placements.find(p => p.id===GAME.selectedPlacementId);
  if(!p) return;

  // Mark all non-wall as active background
  const {cells,width,height} = GAME.crossword;
  for(let y=0;y<height;y++){
    for(let x=0;x<width;x++){
      if(cells[y][x]!==null){
        const idx = y*width + x;
        cellsEl[idx].classList.add('active');
      }
    }
  }

  // Mark selected word
  for(const c of placementCells(p)){
    const idx = c.y*GAME.crossword.width + c.x;
    cellsEl[idx].classList.add('sel');
  }

  // Mark solved words
  for(const solvedId of GAME.solved){
    const sp = GAME.crossword.placements.find(p => p.id===solvedId);
    if(!sp) continue;
    for(const c of placementCells(sp)){
      const idx = c.y*GAME.crossword.width + c.x;
      cellsEl[idx].classList.add('correct');
    }
  }
}

function renderClues(){
  const list = $('#clueList');
  list.innerHTML = '';

  // Sort by direction then by y/x for readability
  const placements = [...GAME.crossword.placements].sort((a,b)=>{
    if(a.dir!==b.dir) return a.dir.localeCompare(b.dir);
    if(a.dir==='H') return (a.y-b.y) || (a.x-b.x);
    return (a.x-b.x) || (a.y-b.y);
  });

  for(const p of placements){
    const li = document.createElement('li');
    li.className = 'clue';
    li.dataset.pid = String(p.id);

    const title = document.createElement('div');
    title.className = 'clueTitle';
    const dirLabel = p.dir==='H' ? '→' : '↓';
    title.innerHTML = `<span class="dir">${dirLabel}</span> <span class="w">${escapeHTML(p.wordObj.word)}</span>`;

    const desc = document.createElement('div');
    desc.className = 'clueDesc';
    desc.textContent = p.wordObj.desc;

    const media = document.createElement('div');
    media.className = 'clueMedia';

    if(p.wordObj.image){
      const img = document.createElement('img');
      img.alt = `صورة: ${p.wordObj.word}`;
      img.loading = 'lazy';
      img.src = p.wordObj.assetBase + p.wordObj.image;
      img.addEventListener('click', ()=> openImage(p.wordObj));
      media.appendChild(img);
    }

    const btns = document.createElement('div');
    btns.className = 'clueBtns';

    const audioBtn = document.createElement('button');
    audioBtn.className = 'miniBtn';
    audioBtn.type = 'button';
    audioBtn.textContent = '🔊';
    audioBtn.title = 'نطق';
    audioBtn.addEventListener('click', (e)=>{ e.stopPropagation(); playAudio(p.wordObj); });

    const exampleBtn = document.createElement('button');
    exampleBtn.className = 'miniBtn';
    exampleBtn.type = 'button';
    exampleBtn.textContent = '📝';
    exampleBtn.title = 'مثال';
    exampleBtn.addEventListener('click', (e)=>{ e.stopPropagation(); openExample(p.wordObj); });

    btns.appendChild(audioBtn);
    btns.appendChild(exampleBtn);

    li.appendChild(title);
    li.appendChild(desc);
    li.appendChild(media);
    li.appendChild(btns);

    li.addEventListener('click', ()=>{
      GAME.selectedPlacementId = p.id;
      GAME.selectedDir = p.dir;
      highlightSelection();
      updateSelectedClueUI();
    });

    list.appendChild(li);
  }
}

function updateSelectedClueUI(){
  $$('#clueList .clue').forEach(el => el.classList.remove('selected'));
  const active = $(`#clueList .clue[data-pid="${GAME.selectedPlacementId}"]`);
  if(active) active.classList.add('selected');

  const p = GAME.crossword.placements.find(p=>p.id===GAME.selectedPlacementId);
  if(!p) return;

  $('#selectedWord').textContent = p.wordObj.word;
  $('#selectedPron').textContent = p.wordObj.pron || '';
  $('#selectedDesc').textContent = p.wordObj.desc || '';
}

function escapeHTML(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function playAudio(wordObj){
  if(!wordObj.sound) return;
  const audio = new Audio(wordObj.assetBase + wordObj.sound);
  audio.play().catch(()=>{});
}

function openExample(wordObj){
  $('#modalTitle').textContent = wordObj.word;
  $('#modalBody').innerHTML = `<div class="modalBlock"><div class="modalLabel">المعنى (EN)</div><div class="modalText">${escapeHTML(wordObj.desc)}</div></div>
  <div class="modalBlock"><div class="modalLabel">مثال</div><div class="modalText">${escapeHTML(htmlToText(wordObj.examHTML))}</div></div>`;
  $('#modal').classList.add('open');
}

function openImage(wordObj){
  $('#modalTitle').textContent = wordObj.word;
  $('#modalBody').innerHTML = `<img class="modalImage" src="${wordObj.assetBase + wordObj.image}" alt="${escapeHTML(wordObj.word)}" />`;
  $('#modal').classList.add('open');
}

function closeModal(){
  $('#modal').classList.remove('open');
}

function setEntry(x,y,ch){
  GAME.entries[y][x] = ch;
}

function currentPlacement(){
  return GAME.crossword.placements.find(p=>p.id===GAME.selectedPlacementId) || null;
}

function trySolveCurrent(){
  const p = currentPlacement();
  if(!p) return;

  const coords = placementCells(p);
  const attempt = coords.map(c => (GAME.entries[c.y][c.x] || '').toUpperCase()).join('');
  const filled = attempt.length === p.word.length && !attempt.includes('');

  if(attempt === p.word){
    if(!GAME.solved.has(p.id)){
      GAME.solved.add(p.id);
      addXP(25);
      markWordResult(p.wordObj.word, true);
      toast(`✅ ممتاز! ${p.wordObj.word}`);
    }
    highlightSelection();
    maybeFinishCrossword();
    return;
  }

  if(filled){
    GAME.mistakes += 1;
    addXP(0);
    markWordResult(p.wordObj.word, false);
    toast('❌ جرّب مرة ثانية');
  }
}

function maybeFinishCrossword(){
  const total = GAME.crossword.placements.length;
  if(GAME.solved.size >= total){
    $('#btnFinish').disabled = false;
    toast('🏁 خلّصت الشبكة! انتقل للتثبيت السريع');
  }
}

function markWordResult(word, correct){
  const p = STATE.progress[word] || {level:0, correct:0, wrong:0, nextReviewISO: todayISO()};
  if(correct){
    p.correct += 1;
    p.level = Math.min(5, (p.level||0) + 1);
  }else{
    p.wrong += 1;
    p.level = Math.max(0, (p.level||0) - 1);
  }
  p.nextReviewISO = computeNextReview(p.level);
  STATE.progress[word] = p;
  saveState(STATE);
}

function computeNextReview(level){
  const intervals = [1, 1, 3, 7, 14, 30];
  const days = intervals[Math.max(0, Math.min(level, 5))];
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0,10);
}

// Keyboard input: type letters for current word
function handleKeydown(e){
  if(!GAME) return;
  const p = currentPlacement();
  if(!p) return;

  const k = e.key;
  if(k === 'Backspace'){
    e.preventDefault();
    backspaceInWord(p);
    renderCrossword();
    return;
  }
  if(k === 'Enter'){
    e.preventDefault();
    trySolveCurrent();
    return;
  }
  if(k.length===1 && /[a-zA-Z]/.test(k)){
    e.preventDefault();
    typeInWord(p, k.toUpperCase());
    renderCrossword();
    trySolveCurrent();
  }
}

function firstEmptyIndex(coords){
  for(let i=0;i<coords.length;i++){
    const c = coords[i];
    if(!(GAME.entries[c.y][c.x]||'')) return i;
  }
  return coords.length-1;
}

function typeInWord(p, ch){
  const coords = placementCells(p);
  const idx = firstEmptyIndex(coords);
  const c = coords[idx];
  setEntry(c.x,c.y,ch);
}

function backspaceInWord(p){
  const coords = placementCells(p);
  // remove last filled
  for(let i=coords.length-1;i>=0;i--){
    const c = coords[i];
    if(GAME.entries[c.y][c.x]){
      setEntry(c.x,c.y,'');
      break;
    }
  }
}

// Hint actions
function hintLetter(){
  const p = currentPlacement();
  if(!p) return;
  if(STATE.xp < 20){ toast('تحتاج 20 نقطة لاستخدام التلميح'); return; }

  const coords = placementCells(p);
  const empties = coords.filter(c => !(GAME.entries[c.y][c.x]||''));
  if(empties.length===0) return;

  const pick = empties[Math.floor(Math.random()*empties.length)];
  setEntry(pick.x, pick.y, p.word[pick.i]);
  STATE.xp -= 20;
  $('#xp').textContent = STATE.xp;
  saveState(STATE);
  renderCrossword();
  trySolveCurrent();
}

function hintWord(){
  const p = currentPlacement();
  if(!p) return;
  if(STATE.xp < 60){ toast('تحتاج 60 نقطة لاستخدام التلميح'); return; }

  const coords = placementCells(p);
  for(const c of coords){
    setEntry(c.x,c.y, p.word[c.i]);
  }
  STATE.xp -= 60;
  $('#xp').textContent = STATE.xp;
  saveState(STATE);
  renderCrossword();
  trySolveCurrent();
}

// -----------------------------
// Drill cards (fast fixation)
// -----------------------------
function renderDrillCards(){
  const wrap = $('#drills');
  wrap.innerHTML = '';

  // Build 6 quick questions from remaining session words
  const pool = GAME.sessionWords.map(w=>w.word);
  const quiz = GAME.sessionWords.slice(Math.min(10, GAME.sessionWords.length), Math.min(16, GAME.sessionWords.length));

  if(quiz.length===0){
    wrap.innerHTML = `<div class="muted">لا يوجد تمارين إضافية اليوم — ركّز على الشبكة 🎯</div>`;
    return;
  }

  for(const w of quiz){
    const card = document.createElement('div');
    card.className = 'drillCard';

    const q = document.createElement('div');
    q.className = 'drillQ';
    q.textContent = `اختر الكلمة المطابقة: ${w.desc}`;

    const opts = makeOptions(w.word, pool);
    const buttons = document.createElement('div');
    buttons.className = 'drillOpts';

    for(const opt of opts){
      const b = document.createElement('button');
      b.className = 'optBtn';
      b.type = 'button';
      b.textContent = opt;
      b.addEventListener('click', ()=>{
        const ok = opt === w.word;
        b.classList.add(ok? 'ok' : 'no');
        addXP(ok? 10 : 0);
        markWordResult(w.word, ok);
        // lock
        $$('.optBtn', buttons).forEach(x=> x.disabled = true);
      });
      buttons.appendChild(b);
    }

    card.appendChild(q);
    card.appendChild(buttons);
    wrap.appendChild(card);
  }
}

function makeOptions(correct, pool){
  const set = new Set([correct]);
  while(set.size < 4 && pool.length>0){
    set.add(pool[Math.floor(Math.random()*pool.length)]);
  }
  const arr = Array.from(set);
  // shuffle
  for(let i=arr.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// -----------------------------
// Finish session
// -----------------------------
function finishSession(){
  // Reward: session completion bonus
  const bonus = 120;
  addXP(bonus);
  toast(`🎉 أحسنت! مكافأة ${bonus} نقطة`);

  $('#sessionView').classList.add('hidden');
  $('#sessionStart').classList.remove('hidden');
}

// -----------------------------
// Toast
// -----------------------------
let toastTimer = null;
function toast(msg){
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> t.classList.remove('show'), 2200);
}

// -----------------------------
// Service worker
// -----------------------------
async function registerSW(){
  if('serviceWorker' in navigator){
    try{ await navigator.serviceWorker.register('./sw.js'); }
    catch{ /* ignore */ }
  }
}

// -----------------------------
// Boot
// -----------------------------
async function boot(){
  STATE = loadState() || defaultState();
  bumpStreak(STATE);
  saveState(STATE);
  updateHUD();

  ALL_WORDS = await loadWords();

  $('#btnStart').addEventListener('click', startSession);
  $('#btnLetter').addEventListener('click', hintLetter);
  $('#btnWord').addEventListener('click', hintWord);
  $('#btnFinish').addEventListener('click', finishSession);

  document.addEventListener('keydown', handleKeydown);

  // Settings
  $('#btnSettings').addEventListener('click', openSettings);
  $('#btnCloseSettings').addEventListener('click', closeSettings);
  $('#btnSaveSettings').addEventListener('click', ()=>{
    const size = parseInt($('#sessionSize').value, 10);
    STATE.settings.sessionSize = size;
    saveState(STATE);
    updateHUD();
    closeSettings();
    toast('✅ تم الحفظ');
  });
  $('#btnReset').addEventListener('click', ()=>{
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  });

  // Modal
  $('#modalClose').addEventListener('click', closeModal);
  $('#modal .backdrop').addEventListener('click', closeModal);

  // Initial display
  const { dayIndex } = getSessionWords(ALL_WORDS, STATE);
  $('#dayTitle').textContent = `اليوم ${dayIndex+1} / 30`;
  $('#daySub').textContent = `ابدأ جلسة اليوم خلال 10 دقائق تقريبًا`;

  await registerSW();
}

boot().catch(err => {
  console.error(err);
  toast('حدث خطأ في تحميل البيانات');
});
