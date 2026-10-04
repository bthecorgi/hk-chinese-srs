// Builds public/data/chars.json from the downloaded sources.
//
// Sources (see README.md for licences):
//   data/sources/hk-graded-2600-1990.txt  香港《小學分級常用字表》(1990), via github.com/zispace/hanzi-chars
//   LSHK 粵拼表 list.tsv                     Cantonese readings, downloaded on first run (CC BY 4.0)
//   @mandel59/mojidata (Unihan)            stroke counts, Mandarin readings, English glosses, simplified forms
//   cedict-json (CC-CEDICT)                example words with pinyin + English
//   subtlex-ch-wf (SUBTLEX-CH)             word frequency, used to pick common example words
//   to-jyutping                            context-aware Jyutping for characters and words
//   data/example-overrides.json            hand-checked fixes and exclusions for example words
//
// Usage: npm install && npm run build:data

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'data', 'cache');
const OUT = path.join(ROOT, 'public', 'data', 'chars.json');
const LSHK_URL = 'https://raw.githubusercontent.com/lshk-org/jyutping-table/master/list.tsv';

// The graded list is ordered grade by grade, each block sorted by stroke count.
// A stroke-count reset marks a block boundary. The file has 8 blocks: P1 and P2
// each come in two blocks, P3–P6 one each. EXPECTED_BLOCKS guards against a
// silently changed upstream file.
const EXPECTED_BLOCKS = [374, 86, 367, 133, 530, 590, 260, 260];
const BLOCK_GRADE = [1, 1, 2, 2, 3, 4, 5, 6];

export function splitBlocks(chars, strokesOf) {
  const blocks = [[]];
  let prev = 0;
  for (const ch of chars) {
    const s = strokesOf(ch);
    if (s < prev - 2) blocks.push([]);
    blocks.at(-1).push(ch);
    prev = s;
  }
  return blocks;
}

const TONE_MARKS = {
  a: 'āáǎà', e: 'ēéěè', i: 'īíǐì', o: 'ōóǒò', u: 'ūúǔù', 'ü': 'ǖǘǚǜ',
};

// "lu:4 xing2" -> "lǜ xíng"
export function numberedToMarked(pinyin) {
  return pinyin.split(' ').map((syl) => {
    const m = syl.match(/^([a-zA-Zü:]+)([1-5])$/);
    if (!m) return syl;
    let [, base, tone] = m;
    base = base.replace(/u:/g, 'ü').replace(/U:/g, 'Ü');
    const t = Number(tone);
    if (t === 5) return base;
    const lower = base.toLowerCase();
    let idx = lower.search(/[ae]/);
    if (idx < 0) idx = lower.indexOf('ou');
    if (idx < 0) {
      // last vowel
      for (let k = lower.length - 1; k >= 0; k--) {
        if ('aeiouü'.includes(lower[k])) { idx = k; break; }
      }
    }
    if (idx < 0) return base;
    const v = lower[idx];
    let marked = TONE_MARKS[v][t - 1];
    if (base[idx] !== v) marked = marked.toUpperCase();
    return base.slice(0, idx) + marked + base.slice(idx + 1);
  }).join(' ');
}

async function cached(url, name) {
  fs.mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, name);
  if (!fs.existsSync(file)) {
    console.log(`downloading ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return fs.readFileSync(file, 'utf8');
}

// Some data packages don't export their JSON files, so read them from disk.
function readPackageJson(pkg, file) {
  const dir = path.join(ROOT, 'node_modules', pkg);
  return JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
}

function readGradedList() {
  const raw = fs.readFileSync(path.join(ROOT, 'data', 'sources', 'hk-graded-2600-1990.txt'), 'utf8');
  return raw.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => {
    // e.g. "煙〔烟〕" — headword with a variant in brackets
    const m = l.match(/^(.)(?:〔(.)〕)?$/u);
    if (!m) throw new Error(`unexpected line: ${l}`);
    return { c: m[1], variant: m[2] || null };
  });
}

function openUnihan() {
  const pkgDir = path.join(ROOT, 'node_modules', '@mandel59', 'mojidata');
  const db = new DatabaseSync(path.join(pkgDir, 'dist', 'moji.db'), { readOnly: true });
  const single = (table) => {
    const m = new Map();
    for (const r of db.prepare(`SELECT UCS, value FROM "${table}"`).all()) m.set(r.UCS, r.value);
    return m;
  };
  const multi = (table) => {
    const m = new Map();
    for (const r of db.prepare(`SELECT UCS, value FROM "${table}" ORDER BY UCS, i`).all()) {
      if (!m.has(r.UCS)) m.set(r.UCS, []);
      m.get(r.UCS).push(r.value);
    }
    return m;
  };
  return {
    strokes: single('unihan_kTotalStrokes'),
    definition: single('unihan_kDefinition'),
    simplified: multi('unihan_each_kSimplifiedVariant'),
    mandarin: multi('unihan_each_kMandarin'),
    pinlu: multi('unihan_each_kHanyuPinlu'),
  };
}

function parseLshk(tsv) {
  const m = new Map();
  for (const line of tsv.split('\n').slice(1)) {
    const [ch, , jp] = line.split('\t');
    if (!ch || !jp) continue;
    if (!m.has(ch)) m.set(ch, []);
    if (!m.get(ch).includes(jp)) m.get(ch).push(jp);
  }
  return m;
}

const BAD_GLOSS = /^(variant of|old variant of|surname |see |used in |abbr\. for |\(old\)|archaic variant|Japanese variant)/i;
const isHan = (ch) => /\p{Script=Han}/u.test(ch);

function buildWordIndex(cedict, freq, inList, exclude = new Set()) {
  // traditional word -> best entry
  const words = new Map();
  for (const e of cedict) {
    const w = e.traditional;
    const chars = [...w];
    if (chars.length < 2 || chars.length > 4 || !chars.every(isHan)) continue;
    if (exclude.has(w)) continue;
    if (/^[A-Z]/.test(e.pinyin)) continue; // proper nouns
    const english = e.english.filter((g) => !BAD_GLOSS.test(g) && !/^CL:/.test(g));
    if (!english.length) continue;
    const f = freq.get(e.simplified) || 0;
    if (f < 5) continue;
    const prev = words.get(w);
    if (prev && prev.f >= f) continue;
    words.set(w, { w, f, pinyin: e.pinyin, english, chars });
  }
  const byChar = new Map();
  for (const entry of words.values()) {
    entry.allInList = entry.chars.every(inList);
    for (const ch of new Set(entry.chars)) {
      if (!byChar.has(ch)) byChar.set(ch, []);
      byChar.get(ch).push(entry);
    }
  }
  return byChar;
}

// CC-CEDICT often has several entries for one written word (結果 jiē guǒ "to bear
// fruit" vs jié guǒ "result"), and frequency can't tell them apart, so some
// examples get the wrong reading. Fixes are checked by hand in the overrides file.
export function applyFix(example, fix) {
  if (!fix) return example;
  const [w, jp, py, en] = example;
  return [w, fix.j ?? jp, fix.p ?? py, fix.en ?? en];
}

function trimGloss(english) {
  let s = english.slice(0, 2).join('; ');
  if (s.length > 70) s = s.slice(0, 67).replace(/[\s;,]+\S*$/, '') + '…';
  return s;
}

async function main() {
  const ToJyutping = require('to-jyutping');
  const unihan = openUnihan();
  const lshk = parseLshk(await cached(LSHK_URL, 'lshk-list.tsv'));
  const cedict = readPackageJson('cedict-json', 'cedict.json');
  const subtlex = readPackageJson('subtlex-ch-wf', 'SUBTLEX-CH-WF.json');
  const freq = new Map(subtlex.data.map((r) => [String(r.Word), r.WCount]));

  const list = readGradedList();
  const strokesOf = (ch) => parseInt(unihan.strokes.get(ch), 10);
  const blocks = splitBlocks(list.map((x) => x.c), strokesOf);
  const sizes = blocks.map((b) => b.length);
  if (JSON.stringify(sizes) !== JSON.stringify(EXPECTED_BLOCKS)) {
    throw new Error(`grade blocks changed: ${sizes.join(',')}`);
  }
  const grade = new Map();
  blocks.forEach((b, i) => b.forEach((ch) => grade.set(ch, BLOCK_GRADE[i])));
  const inList = (ch) => grade.has(ch);

  const overrides = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'example-overrides.json'), 'utf8'));
  const byChar = buildWordIndex(cedict, freq, inList, new Set(Object.keys(overrides.exclude)));
  const missing = [];

  const out = list.map(({ c, variant }) => {
    const g = grade.get(c);
    const jPrimary = ToJyutping.getJyutpingList(c)[0]?.[1] || lshk.get(c)?.[0] || null;
    const jAll = [...new Set([jPrimary, ...(lshk.get(c) || [])].filter(Boolean))];

    const pinlu = (unihan.pinlu.get(c) || []).map((v) => v.replace(/\(\d+\)$/, ''));
    const mand = unihan.mandarin.get(c) || [];
    const pAll = [...new Set([...mand, ...pinlu])];

    if (!jPrimary || !pAll.length) missing.push(c);

    const examples = (byChar.get(c) || [])
      .map((e) => {
        const otherMax = Math.max(0, ...e.chars.filter((x) => x !== c).map((x) => grade.get(x) || 9));
        const score = Math.log10(e.f) + (e.allInList ? 1 : 0) + (otherMax <= g ? 0.5 : 0);
        return { e, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(({ e }) => applyFix(
        [e.w, ToJyutping.getJyutpingText(e.w), numberedToMarked(e.pinyin), trimGloss(e.english)],
        overrides.fix[e.w],
      ));

    const simp = (unihan.simplified.get(c) || [])
      .map((u) => String.fromCodePoint(parseInt(u.replace('U+', ''), 16)))
      .filter((s) => s !== c);

    const rec = {
      c, g, s: strokesOf(c),
      j: jAll, p: pAll,
      d: unihan.definition.get(c) || '',
      e: examples,
    };
    if (simp.length) rec.sc = simp[0];
    if (variant) rec.v = variant;
    return rec;
  });

  if (missing.length) console.warn(`missing readings for: ${missing.join('')}`);
  const used = new Set(out.flatMap((r) => r.e.map((x) => x[0])));
  const unused = Object.keys(overrides.fix).filter((w) => !used.has(w));
  if (unused.length) console.warn(`example fixes not used by any character: ${unused.join(' ')}`);

  const payload = {
    source: '香港課程發展議會《小學中國語文科（小一至小六課程綱要）》(1990) 小學分級常用字表',
    generated: new Date().toISOString().slice(0, 10),
    counts: Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [`P${n}`, out.filter((x) => x.g === n).length])),
    chars: out,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload));
  console.log(`wrote ${out.length} characters to ${path.relative(ROOT, OUT)}`, payload.counts);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
