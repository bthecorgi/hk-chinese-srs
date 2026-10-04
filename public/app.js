import {
  newCard, schedule, previewIntervals, dayKey, isMature, formatDelay,
  AGAIN, HARD, GOOD, EASY, LEARN_AHEAD, DAY,
} from './srs.js';

const STORE_KEY = 'hk-srs-v1';
const LEVELS = [1, 2, 3, 4, 5, 6];
const LEVEL_ZH = ['', '小一', '小二', '小三', '小四', '小五', '小六'];
const DEFAULT_SETTINGS = {
  levels: [1],
  newPerDay: 10,
  front: 'char', // char | listen | meaning
  autoplay: 'yue', // off | yue | cmn | both
  showJyutping: true,
  showPinyin: true,
  toneColors: true,
  serif: false,
  yueVoice: '',
  cmnVoice: '',
  rate: 0.8,
};

// ---------- state ----------

let DATA = null; // { chars: [...] }
let BY_CHAR = new Map();
let store = loadStore();
let route = { name: 'home' };
let session = null;

function loadStore() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { /* corrupt or unavailable */ }
  return {
    cards: s.cards || {},
    days: s.days || {},
    settings: { ...DEFAULT_SETTINGS, ...(s.settings || {}) },
  };
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    toast('Could not save progress — storage is full or blocked.');
  }
}

const S = () => store.settings;
const today = () => {
  const k = dayKey(Date.now());
  store.days[k] ||= { new: 0, rev: 0 };
  return store.days[k];
};

// ---------- helpers ----------

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2400);
}

function jyutHtml(jp) {
  return jp.split(' ').map((syl) => {
    const tone = syl.match(/([1-6])$/)?.[1];
    return tone ? `<span class="tone-${tone}">${esc(syl)}</span>` : esc(syl);
  }).join(' ');
}

const PINYIN_TONES = { 'āēīōūǖ': 1, 'áéíóúǘ': 2, 'ǎěǐǒǔǚ': 3, 'àèìòùǜ': 4 };
function pinyinTone(syl) {
  for (const [chars, t] of Object.entries(PINYIN_TONES)) {
    if ([...syl].some((ch) => chars.includes(ch))) return t;
  }
  return 5;
}
function pinyinHtml(py) {
  return py.split(' ').map((syl) => `<span class="tone-${pinyinTone(syl)}">${esc(syl)}</span>`).join(' ');
}
const stripTones = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ü/g, 'v').toLowerCase();

function cardStatus(c) {
  const card = store.cards[c];
  if (!card || card.state === 'new') return 'new';
  if (card.state !== 'review') return 'learn';
  return isMature(card) ? 'mature' : 'young';
}

// ---------- speech ----------

const speech = {
  voices: [],
  load() {
    if (!('speechSynthesis' in window)) return;
    this.voices = speechSynthesis.getVoices();
  },
  norm: (v) => v.lang.replace('_', '-').toLowerCase(),
  list(kind) {
    return this.voices.filter((v) => {
      const l = this.norm(v);
      return kind === 'yue'
        ? l.startsWith('zh-hk') || l.startsWith('yue')
        : (l.startsWith('zh-cn') || l.startsWith('zh-tw') || l.startsWith('cmn') || l === 'zh');
    });
  },
  pick(kind) {
    const wanted = kind === 'yue' ? S().yueVoice : S().cmnVoice;
    const list = this.list(kind);
    return list.find((v) => v.voiceURI === wanted)
      || (kind === 'cmn' && list.find((v) => this.norm(v).startsWith('zh-cn')))
      || list[0] || null;
  },
  say(text, kind, { queue = false } = {}) {
    if (!('speechSynthesis' in window)) { toast('Speech is not supported in this browser.'); return; }
    if (!queue) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = kind === 'yue' ? 'zh-HK' : 'zh-CN';
    const v = this.pick(kind);
    if (v) u.voice = v;
    u.rate = S().rate;
    speechSynthesis.speak(u);
  },
  auto(text) {
    const a = S().autoplay;
    if (a === 'off') return;
    if (a === 'both') { this.say(text, 'yue'); this.say(text, 'cmn', { queue: true }); return; }
    this.say(text, a);
  },
};
if ('speechSynthesis' in window) {
  speech.load();
  speechSynthesis.addEventListener?.('voiceschanged', () => {
    speech.load();
    if (route.name === 'settings') render();
  });
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-say]');
  if (!b) return;
  e.stopPropagation();
  speech.say(b.dataset.say, b.dataset.kind);
});

const speakBtn = (text, kind, sm = false) =>
  `<button class="speak${sm ? ' sm' : ''}" data-say="${esc(text)}" data-kind="${kind}" aria-label="Play ${kind === 'yue' ? 'Cantonese' : 'Mandarin'}">${kind === 'yue' ? '粵' : '普'}</button>`;

// ---------- queue ----------

function newQueue() {
  const levels = new Set(S().levels);
  return DATA.chars.filter((x) => levels.has(x.g) && cardStatus(x.c) === 'new');
}

function counts(now = Date.now()) {
  let learn = 0; let due = 0;
  for (const card of Object.values(store.cards)) {
    if (card.state === 'learning' || card.state === 'relearning') { if (card.due <= now + LEARN_AHEAD) learn++; } else if (card.state === 'review' && card.due <= now) due++;
  }
  const quota = Math.max(0, S().newPerDay - today().new);
  const fresh = Math.min(quota, newQueue().length);
  return { learn, due, fresh };
}

function nextCard(now = Date.now()) {
  const entries = Object.entries(store.cards);
  const learning = entries.filter(([, c]) => c.state === 'learning' || c.state === 'relearning').sort((a, b) => a[1].due - b[1].due);
  const learnNow = learning.find(([, c]) => c.due <= now);
  if (learnNow) return learnNow[0];

  const reviews = entries.filter(([, c]) => c.state === 'review' && c.due <= now).sort((a, b) => a[1].due - b[1].due);
  const quota = S().newPerDay - today().new;
  const fresh = quota > 0 ? newQueue()[0]?.c : null;

  // Mix new cards in among reviews: one new card after every three reviews.
  if (fresh && (!reviews.length || session.sinceNew >= 3)) return fresh;
  if (reviews.length) return reviews[0][0];
  if (fresh) return fresh;

  const ahead = learning.find(([, c]) => c.due <= now + LEARN_AHEAD);
  return ahead ? ahead[0] : null;
}

// ---------- rendering ----------

function setTitle(text, back = null) {
  const bar = $('.topbar');
  bar.innerHTML = `${back ? `<button class="back" data-back="${back}">‹ Back</button>` : ''}<h1>${esc(text)}</h1>`;
  const b = $('[data-back]', bar);
  if (b) b.onclick = () => go(b.dataset.back);
}

function go(name, extra = {}) {
  if (route.name === 'study' && name !== 'study') {
    session = null;
    window.speechSynthesis?.cancel();
  }
  route = { name, ...extra };
  document.body.classList.toggle('studying', name === 'study');
  document.querySelectorAll('.tabbar button').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === (name === 'level' ? 'levels' : name));
  });
  render();
  window.scrollTo(0, 0);
}

function render() {
  const v = $('#view');
  switch (route.name) {
    case 'home': return renderHome(v);
    case 'levels': return renderLevels(v);
    case 'level': return renderLevel(v, route.g);
    case 'settings': return renderSettings(v);
    case 'study': return renderStudy(v);
  }
}

function levelStats(g) {
  const chars = DATA.chars.filter((x) => x.g === g);
  const s = { total: chars.length, new: 0, learn: 0, young: 0, mature: 0 };
  for (const x of chars) s[cardStatus(x.c)]++;
  return s;
}

function barHtml(s) {
  const pct = (n) => `${(100 * n / s.total).toFixed(2)}%`;
  return `<div class="bar" role="img" aria-label="${s.mature} mature, ${s.young} young, ${s.learn} learning, ${s.new} new">
    <i class="mature" style="width:${pct(s.mature)}"></i><i class="young" style="width:${pct(s.young)}"></i><i class="learn" style="width:${pct(s.learn)}"></i></div>`;
}

function streak() {
  let n = 0;
  const d = new Date();
  if (!(store.days[dayKey(d.getTime())]?.rev)) d.setDate(d.getDate() - 1); // today not done yet still counts yesterday's streak
  for (;;) {
    const k = dayKey(d.getTime());
    if (!store.days[k]?.rev) break;
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

function renderHome(v) {
  setTitle('港小字卡');
  const c = counts();
  const total = c.learn + c.due + c.fresh;
  const started = Object.values(store.cards).filter((x) => x.state !== 'new').length;
  const mature = Object.values(store.cards).filter(isMature).length;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  const levelsText = S().levels.length ? S().levels.map((g) => `P${g}`).join(', ') : 'none selected';

  v.innerHTML = `
    ${isIOS && !standalone ? `<div class="card install-hint"><b>Install on iPhone / iPad</b>
      <p class="small">Tap <b>Share</b> <span aria-hidden="true">⎋</span> in Safari, then <b>Add to Home Screen</b>. The app then works offline and opens full screen.</p></div>` : ''}
    <div class="card">
      <h2>Today</h2>
      <div class="counts">
        <div class="n-new"><b>${c.fresh}</b><span>New</span></div>
        <div class="n-learn"><b>${c.learn}</b><span>Learning</span></div>
        <div class="n-due"><b>${c.due}</b><span>To review</span></div>
      </div>
      <button class="btn primary block" id="study" ${total ? '' : 'disabled'}>${total ? 'Study now' : 'All done for today 🎉'}</button>
      <p class="small muted" style="margin:10px 0 0">New characters come from: <b>${esc(levelsText)}</b> · ${S().newPerDay}/day.
        <a href="#" id="pick-levels">Change</a></p>
    </div>
    <div class="card">
      <h2>Progress</h2>
      <div class="stats">
        <div><b>${started}</b><span>Started / 2600</span></div>
        <div><b>${mature}</b><span>Mature (21d+)</span></div>
        <div><b>${streak()}</b><span>Day streak</span></div>
        <div><b>${today().rev}</b><span>Reviews today</span></div>
      </div>
    </div>
    <div class="card">
      <h2>Levels</h2>
      ${LEVELS.map((g) => { const s = levelStats(g); return `<div style="margin:8px 0"><div class="row small"><b>P${g}</b><span class="muted zh">${LEVEL_ZH[g]}</span><span class="spacer"></span><span class="muted">${s.total - s.new}/${s.total}</span></div>${barHtml(s)}</div>`; }).join('')}
    </div>`;
  $('#study').onclick = () => startStudy();
  $('#pick-levels').onclick = (e) => { e.preventDefault(); go('levels'); };
}

function renderLevels(v) {
  setTitle('Levels 年級');
  v.innerHTML = `
    <input class="search" id="q" type="search" placeholder="Search 字, jyutping, pinyin or English" autocomplete="off" autocapitalize="off" spellcheck="false">
    <div id="search-results"></div>
    <div id="level-list">
      <p class="small muted">Switch on the levels you want new characters from. Characters are introduced in curriculum order, P1 first.</p>
      ${LEVELS.map((g) => { const s = levelStats(g); return `
        <div class="card level">
          <div class="badge">P${g}</div>
          <div class="name">Primary ${g}<span class="zh">${LEVEL_ZH[g]}</span>
            <div class="small muted">${s.total} characters · ${s.new} new · ${s.learn + s.young} learning · ${s.mature} mature</div></div>
          <label class="toggle" title="Include P${g} in new cards"><input type="checkbox" data-level="${g}" ${S().levels.includes(g) ? 'checked' : ''} aria-label="Learn P${g}"><span></span></label>
          <div class="bar-wrap" style="grid-column:2/4">${barHtml(s)}</div>
          <div style="grid-column:1/4;margin-top:6px"><button class="btn" data-open="${g}">Browse P${g} characters</button></div>
        </div>`; }).join('')}
      <div class="legend"><span><i style="background:var(--st-mature)"></i>Mature</span><span><i style="background:var(--st-young)"></i>Young</span><span><i style="background:var(--st-learn)"></i>Learning</span><span><i style="background:var(--st-new)"></i>New</span></div>
    </div>`;

  v.querySelectorAll('[data-level]').forEach((el) => {
    el.onchange = () => {
      const g = Number(el.dataset.level);
      const set = new Set(S().levels);
      el.checked ? set.add(g) : set.delete(g);
      S().levels = [...set].sort();
      save();
    };
  });
  v.querySelectorAll('[data-open]').forEach((el) => { el.onclick = () => go('level', { g: Number(el.dataset.open) }); });

  const q = $('#q');
  q.oninput = () => {
    const res = search(q.value);
    $('#level-list').hidden = !!q.value.trim();
    $('#search-results').innerHTML = q.value.trim()
      ? (res.length ? `<div class="results">${res.slice(0, 60).map((x) => `
          <button data-detail="${x.c}"><span class="big" lang="zh-Hant-HK">${x.c}</span>
          <span><b>${esc(x.j[0] || '')}</b> · ${esc(x.p[0] || '')} <span class="muted small">P${x.g}</span><br><span class="small muted">${esc(x.d)}</span></span></button>`).join('')}</div>`
        : '<p class="muted">No matches.</p>')
      : '';
  };
}

function search(raw) {
  const q = raw.trim();
  if (!q) return [];
  const hanzi = [...q].filter((ch) => /\p{Script=Han}/u.test(ch));
  if (hanzi.length) {
    const set = new Set(hanzi);
    return DATA.chars.filter((x) => set.has(x.c) || set.has(x.sc) || set.has(x.v));
  }
  const lower = q.toLowerCase();
  const bare = stripTones(lower).replace(/\s+/g, '');
  const hasDigit = /\d/.test(lower);
  const scored = [];
  for (const x of DATA.chars) {
    let score = 0;
    for (const j of x.j) {
      if (j === lower) score = Math.max(score, 3);
      else if (!hasDigit && j.replace(/\d/g, '') === bare) score = Math.max(score, 2.5);
    }
    for (const p of x.p) {
      if (p === lower) score = Math.max(score, 3);
      else if (stripTones(p) === bare) score = Math.max(score, 2.5);
    }
    if (!score && lower.length >= 2 && new RegExp(`\\b${lower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(x.d)) score = 1;
    if (score) scored.push([score, x]);
  }
  return scored.sort((a, b) => b[0] - a[0]).map((s) => s[1]);
}

function renderLevel(v, g) {
  setTitle(`P${g} ${LEVEL_ZH[g]}`, 'levels');
  const chars = DATA.chars.filter((x) => x.g === g);
  const s = levelStats(g);
  v.innerHTML = `
    <div class="card">${barHtml(s)}
      <div class="legend"><span><i style="background:var(--st-mature)"></i>Mature ${s.mature}</span><span><i style="background:var(--st-young)"></i>Young ${s.young}</span><span><i style="background:var(--st-learn)"></i>Learning ${s.learn}</span><span><i style="background:var(--st-new)"></i>New ${s.new}</span></div>
    </div>
    <div class="grid" lang="zh-Hant-HK">${chars.map((x) => `<button class="s-${cardStatus(x.c)}" data-detail="${x.c}" aria-label="${x.c}">${x.c}</button>`).join('')}</div>`;
}

function answerHtml(x, { revealedChar = true } = {}) {
  const st = S();
  const plain = st.toneColors ? '' : ' plain';
  const readings = [];
  if (st.showJyutping) {
    readings.push(`<span class="reading"><span><span class="lbl">粵 Jyutping</span><br><span class="val">${jyutHtml(x.j[0])}</span></span>${speakBtn(x.c, 'yue')}</span>`);
  }
  if (st.showPinyin) {
    readings.push(`<span class="reading"><span><span class="lbl">普 Pinyin</span><br><span class="val">${pinyinHtml(x.p[0])}</span></span>${speakBtn(x.c, 'cmn')}</span>`);
  }
  const alts = [];
  if (st.showJyutping && x.j.length > 1) alts.push(`粵 also ${x.j.slice(1, 4).join(', ')}`);
  if (st.showPinyin && x.p.length > 1) alts.push(`普 also ${x.p.slice(1, 3).join(', ')}`);
  const examples = x.e.map(([w, jp, py, en]) => `
    <li><span class="w" lang="zh-Hant-HK">${[...w].map((ch) => ch === x.c ? `<mark>${ch}</mark>` : ch).join('')}</span>
      <span class="grow"><span class="r">${st.showJyutping ? jyutHtml(jp) : ''}${st.showJyutping && st.showPinyin ? ' · ' : ''}${st.showPinyin ? pinyinHtml(py) : ''}</span><br><span class="e">${esc(en)}</span></span>
      ${st.showJyutping ? speakBtn(w, 'yue', true) : ''}${st.showPinyin ? speakBtn(w, 'cmn', true) : ''}</li>`).join('');
  return `
    ${revealedChar ? `<div class="hanzi${st.serif ? ' serif' : ''}" lang="zh-Hant-HK">${x.c}</div>` : ''}
    <div class="answer${plain}">
      <div class="readings">${readings.join('')}</div>
      ${alts.length ? `<div class="alt">${esc(alts.join(' · '))}</div>` : ''}
      <div class="def">${esc(x.d)}</div>
      <div class="meta">P${x.g} · ${x.s} strokes${x.sc ? ` · simplified <span lang="zh-Hans">${x.sc}</span>` : ''}${x.v ? ` · variant <span lang="zh-Hant">${x.v}</span>` : ''}</div>
      ${examples ? `<ul class="examples">${examples}</ul>` : ''}
    </div>`;
}

// ---------- detail sheet ----------

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-detail]');
  if (b) showDetail(b.dataset.detail);
});

function showDetail(c) {
  const x = BY_CHAR.get(c);
  const card = store.cards[c];
  const status = cardStatus(c);
  const label = { new: 'Not started', learn: 'Learning', young: 'Young', mature: 'Mature' }[status];
  const next = card && card.state !== 'new'
    ? ` · next review ${card.due <= Date.now() ? 'now' : `in ${formatDelay(card.due - Date.now())}`}${card.state === 'review' ? ` · interval ${card.ivl}d` : ''}`
    : '';
  const sheet = $('#sheet');
  sheet.innerHTML = `<div class="sheet-body">
    <button class="sheet-close" aria-label="Close">✕</button>
    ${answerHtml(x)}
    <p class="small muted">${label}${next}</p>
    <div class="btn-row" style="justify-content:center">
      ${status === 'mature' ? '' : '<button class="btn" data-act="known">I know this</button>'}
      ${status === 'new' ? '' : '<button class="btn danger" data-act="reset">Reset</button>'}
    </div></div>`;
  $('.sheet-close', sheet).onclick = () => sheet.close();
  sheet.onclick = (e) => { if (e.target === sheet) sheet.close(); };
  sheet.querySelectorAll('[data-act]').forEach((b) => {
    b.onclick = () => {
      if (b.dataset.act === 'known') {
        const ivl = 30;
        const d = new Date(Date.now() + ivl * DAY);
        store.cards[c] = { ...newCard(), ...(store.cards[c] || {}), state: 'review', ivl, due: d.getTime(), step: 0 };
        toast(`${c} marked as known`);
      } else {
        delete store.cards[c];
        toast(`${c} reset`);
      }
      save();
      sheet.close();
      render();
    };
  });
  if (!sheet.open) sheet.showModal();
}

// ---------- study ----------

function startStudy() {
  session = { current: null, revealed: false, sinceNew: 0, done: 0, undo: null };
  go('study');
}

function renderStudy(v) {
  setTitle('Study 溫習', 'home');
  if (!session) session = { current: null, revealed: false, sinceNew: 0, done: 0, undo: null };
  if (!session.current) {
    session.current = nextCard();
    session.revealed = false;
    if (session.current && S().front === 'listen') speech.say(session.current, 'yue');
  }
  const c = counts();
  const head = `<div class="study-head">
      <span class="q"><b class="c-new">${c.fresh}</b> + <b class="c-learn">${c.learn}</b> + <b class="c-due">${c.due}</b></span>
      <span class="spacer"></span>
      <span>${session.done} done</span>
      ${session.undo ? '<button class="btn" id="undo" style="padding:4px 10px">↶ Undo</button>' : ''}
    </div>`;

  if (!session.current) {
    v.innerHTML = `<div class="study">${head}<div class="done"><div class="big">🎉</div>
      <h2>All caught up</h2><p class="muted">You studied ${session.done} card${session.done === 1 ? '' : 's'}. Come back later for more reviews, or add another level / raise the daily limit for more new characters.</p>
      <button class="btn primary" id="home">Back to Today</button></div></div>`;
    $('#home').onclick = () => go('home');
    bindUndo();
    return;
  }

  const x = BY_CHAR.get(session.current);
  const card = store.cards[x.c] || newCard();
  const isNew = card.state === 'new';
  let front;
  if (session.revealed) {
    front = answerHtml(x);
  } else if (S().front === 'listen') {
    front = `<div class="prompt">Which character is this?</div>
      <div class="row" style="justify-content:center;margin-top:16px">${speakBtn(x.c, 'yue')} ${speakBtn(x.c, 'cmn')}</div>
      ${x.e[0] ? `<div class="prompt small">as in: ${speakBtn(x.e[0][0], 'yue', true)} ${speakBtn(x.e[0][0], 'cmn', true)}</div>` : ''}`;
  } else if (S().front === 'meaning') {
    front = `<div class="prompt">Write the character for</div>
      <div class="prompt"><span class="meaning">${esc(x.d)}</span></div>
      <div class="prompt">${S().showJyutping ? jyutHtml(x.j[0]) : ''} ${S().showPinyin ? pinyinHtml(x.p[0]) : ''}</div>`;
  } else {
    front = `<div class="hanzi${S().serif ? ' serif' : ''}" lang="zh-Hant-HK">${x.c}</div>
      <div class="prompt small">${isNew ? '✨ New character' : 'How do you say it? What does it mean?'}</div>`;
  }

  const prev = previewIntervals(card, Date.now());
  const actions = session.revealed
    ? `<div class="ratings">
        <button class="r1" data-rate="${AGAIN}">Again<small>${prev[AGAIN]}</small></button>
        <button class="r2" data-rate="${HARD}">Hard<small>${prev[HARD]}</small></button>
        <button class="r3" data-rate="${GOOD}">Good<small>${prev[GOOD]}</small></button>
        <button class="r4" data-rate="${EASY}">Easy<small>${prev[EASY]}</small></button></div>`
    : '<button class="btn primary block" id="reveal">Show answer</button>';

  v.innerHTML = `<div class="study">${head}
    <div class="flash${session.revealed ? ' revealed' : ''}">${front}</div>
    <div class="actions">${actions}</div></div>`;

  const reveal = $('#reveal');
  if (reveal) {
    reveal.onclick = doReveal;
    const flash = $('.flash', v);
    flash.classList.add('tap');
    flash.onclick = (e) => { if (!e.target.closest('button')) doReveal(); };
  }
  v.querySelectorAll('[data-rate]').forEach((b) => { b.onclick = () => rate(Number(b.dataset.rate)); });
  bindUndo();
}

function bindUndo() {
  const u = $('#undo');
  if (!u) return;
  u.onclick = () => {
    const { c, prevCard, prevDay, prevSinceNew } = session.undo;
    if (prevCard) store.cards[c] = prevCard; else delete store.cards[c];
    store.days[dayKey(Date.now())] = prevDay;
    session.sinceNew = prevSinceNew;
    session.done = Math.max(0, session.done - 1);
    session.undo = null;
    session.current = c;
    session.revealed = true;
    save();
    render();
  };
}

function doReveal() {
  session.revealed = true;
  render();
  if (S().front !== 'listen') speech.auto(session.current);
}

function rate(r) {
  const c = session.current;
  const prevCard = store.cards[c];
  const card = prevCard || newCard();
  const day = today();
  session.undo = { c, prevCard, prevDay: { ...day }, prevSinceNew: session.sinceNew };
  if (card.state === 'new') { day.new++; session.sinceNew = 0; } else session.sinceNew++;
  day.rev++;
  store.cards[c] = schedule(card, r, Date.now());
  save();
  session.done++;
  session.current = null;
  render();
}

document.addEventListener('keydown', (e) => {
  if (route.name !== 'study' || !session?.current || e.target.matches('input, select, textarea')) return;
  if (!session.revealed && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); doReveal(); }
  else if (session.revealed && ['1', '2', '3', '4'].includes(e.key)) rate(Number(e.key));
  else if (session.revealed && e.key === ' ') { e.preventDefault(); rate(GOOD); }
});

// ---------- settings ----------

function renderSettings(v) {
  setTitle('Settings 設定');
  const st = S();
  const voiceOpts = (kind, current) => {
    const list = speech.list(kind);
    if (!list.length) return '<option value="">System default</option>';
    return `<option value="">Automatic</option>${list.map((vo) => `<option value="${esc(vo.voiceURI)}" ${vo.voiceURI === current ? 'selected' : ''}>${esc(vo.name)} (${esc(vo.lang)})</option>`).join('')}`;
  };
  const noYue = 'speechSynthesis' in window && speech.voices.length && !speech.list('yue').length;
  v.innerHTML = `
    <div class="card"><h2>Study</h2>
      <div class="field"><label for="newPerDay">New characters per day</label>
        <input id="newPerDay" type="number" min="0" max="200" inputmode="numeric" value="${st.newPerDay}"></div>
      <div class="field"><label for="front">Card front<small>Read: see 字, recall sound &amp; meaning · Listen: hear it, recall 字 · Write: see meaning, write 字</small></label>
        <select id="front">
          <option value="char" ${st.front === 'char' ? 'selected' : ''}>Character (read)</option>
          <option value="listen" ${st.front === 'listen' ? 'selected' : ''}>Sound (listen)</option>
          <option value="meaning" ${st.front === 'meaning' ? 'selected' : ''}>Meaning (write)</option>
        </select></div>
      <div class="field"><label for="autoplay">Auto-play on reveal</label>
        <select id="autoplay">
          <option value="yue" ${st.autoplay === 'yue' ? 'selected' : ''}>Cantonese</option>
          <option value="cmn" ${st.autoplay === 'cmn' ? 'selected' : ''}>Mandarin</option>
          <option value="both" ${st.autoplay === 'both' ? 'selected' : ''}>Both</option>
          <option value="off" ${st.autoplay === 'off' ? 'selected' : ''}>Off</option>
        </select></div>
    </div>
    <div class="card"><h2>Display</h2>
      <div class="field"><label for="showJyutping">Show Cantonese (Jyutping)</label>${toggle('showJyutping', st.showJyutping)}</div>
      <div class="field"><label for="showPinyin">Show Mandarin (Pinyin)</label>${toggle('showPinyin', st.showPinyin)}</div>
      <div class="field"><label for="toneColors">Colour tones</label>${toggle('toneColors', st.toneColors)}</div>
      <div class="field"><label for="serif">Kai/Song style characters<small>Closer to textbook print</small></label>${toggle('serif', st.serif)}</div>
    </div>
    <div class="card"><h2>Voices</h2>
      <div class="field"><label for="yueVoice">Cantonese voice</label><select id="yueVoice">${voiceOpts('yue', st.yueVoice)}</select>${speakBtn('廣東話', 'yue')}</div>
      <div class="field"><label for="cmnVoice">Mandarin voice</label><select id="cmnVoice">${voiceOpts('cmn', st.cmnVoice)}</select>${speakBtn('普通話', 'cmn')}</div>
      <div class="field"><label for="rate">Speed <small>${st.rate.toFixed(2)}×</small></label><input id="rate" type="range" min="0.5" max="1.2" step="0.05" value="${st.rate}"></div>
      ${noYue ? `<p class="small muted">No Cantonese voice found on this device. On iPhone/iPad: <b>Settings → Accessibility → Read &amp; Speak → Voices → Chinese</b> (older iOS: Spoken Content), download <b>Sinji (Cantonese, Hong Kong)</b>, then reopen the app.</p>` : '<p class="small muted">Tip: on iPhone/iPad, enhanced voices can be downloaded in Settings → Accessibility → Read &amp; Speak → Voices → Chinese (older iOS: Spoken Content). Or search Settings for “Voices”.</p>'}
    </div>
    <div class="card"><h2>Progress backup</h2>
      <p class="small muted">Progress is stored on this device only. Export a backup now and then, especially before deleting the app.</p>
      <div class="btn-row">
        <button class="btn" id="export">Export backup</button>
        <label class="btn" for="import">Import backup</label>
        <input id="import" type="file" accept="application/json,.json" hidden>
        <button class="btn danger" id="reset">Reset all progress</button>
      </div>
    </div>
    <div class="card small"><h2>About</h2>
      <p>Characters: 香港課程發展議會《小學中國語文科（小一至小六課程綱要）》(1990) <b>小學分級常用字表</b> — 2,600 characters graded P1–P6, as transcribed by <a href="https://github.com/zispace/hanzi-chars">zispace/hanzi-chars</a>.</p>
      <p>Cantonese: <a href="https://github.com/lshk-org/jyutping-table">LSHK 粵拼表</a> (CC BY 4.0) and <a href="https://github.com/CanCLID/to-jyutping">to-jyutping</a>. Mandarin readings, glosses and stroke counts: Unicode Unihan. Example words: <a href="https://cc-cedict.org/">CC-CEDICT</a> (CC BY-SA 4.0), ranked by SUBTLEX-CH frequency.</p>
      <p class="muted">${DATA.generated ? `Data built ${esc(DATA.generated)}.` : ''}</p>
    </div>`;

  const num = $('#newPerDay');
  num.onchange = () => { st.newPerDay = Math.max(0, Math.min(200, parseInt(num.value, 10) || 0)); num.value = st.newPerDay; save(); };
  for (const id of ['front', 'autoplay', 'yueVoice', 'cmnVoice']) {
    $(`#${id}`).onchange = (e) => { st[id] = e.target.value; save(); };
  }
  for (const id of ['showJyutping', 'showPinyin', 'toneColors', 'serif']) {
    $(`#${id}`).onchange = (e) => { st[id] = e.target.checked; save(); };
  }
  $('#rate').oninput = (e) => { st.rate = Number(e.target.value); $('label[for=rate] small').textContent = `${st.rate.toFixed(2)}×`; };
  $('#rate').onchange = () => save();
  $('#export').onclick = exportBackup;
  $('#import').onchange = importBackup;
  $('#reset').onclick = () => {
    if (!confirm('Delete all progress on this device? This cannot be undone.')) return;
    store.cards = {};
    store.days = {};
    save();
    toast('Progress reset');
    render();
  };
}

const toggle = (id, on) => `<span class="toggle"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span></span></span>`;

async function exportBackup() {
  const json = JSON.stringify({ app: 'hk-srs', version: 1, exported: new Date().toISOString(), ...store });
  const name = `hk-srs-backup-${dayKey(Date.now())}.json`;
  const file = new File([json], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function importBackup(e) {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (data.app !== 'hk-srs' || typeof data.cards !== 'object') throw new Error('not a backup file');
    if (!confirm(`Replace current progress with this backup (${Object.keys(data.cards).length} cards)?`)) return;
    store = { cards: data.cards, days: data.days || {}, settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) } };
    save();
    toast('Backup restored');
    render();
  } catch (err) {
    toast(`Import failed: ${err.message}`);
  } finally {
    e.target.value = '';
  }
}

// ---------- boot ----------

// iOS Safari only shows :active (press) styles when a touch listener is registered.
document.addEventListener('touchstart', () => {}, { passive: true });

document.querySelectorAll('.tabbar button').forEach((b) => { b.onclick = () => go(b.dataset.tab); });

async function boot() {
  try {
    const res = await fetch('data/chars.json');
    DATA = await res.json();
  } catch {
    $('#view').innerHTML = '<p class="loading">Could not load the character list. Check your connection and reload.</p>';
    return;
  }
  BY_CHAR = new Map(DATA.chars.map((x) => [x.c, x]));
  render();
  navigator.storage?.persist?.();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
    // When an updated service worker takes over, reload once so the new version shows.
    if (navigator.serviceWorker.controller) {
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloaded || route.name === 'study') return;
        reloaded = true;
        location.reload();
      });
    }
  }
}

boot();
