// Builds public/ja/data/phrases.json from data/japanese/pimsleur-ja1.txt.
// Usage: npm run build:ja
//
// Each phrase becomes { id, l, k, j, r, e, s?, n? }:
//   id  stable key for progress (the Japanese text)
//   l   lesson number (21 = Culture Notes)
//   k   kana reading, words separated by spaces
//   j   natural written Japanese
//   r   romaji (Hepburn, macrons for long o and u)
//   e   English
//   s   text for the voice, when different from j
//   n   note

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'data', 'japanese', 'pimsleur-ja1.txt');
const OUT = path.join(ROOT, 'public', 'ja', 'data', 'phrases.json');

const BASE = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o',
  か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko',
  さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so',
  た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
  な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no',
  は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo',
  や: 'ya', ゆ: 'yu', よ: 'yo',
  ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro',
  わ: 'wa', を: 'o', ん: 'n',
  が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go',
  ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
  だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do',
  ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
  ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po',
  ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o',
};
const SMALL_Y = { ゃ: 'a', ゅ: 'u', ょ: 'o' };
const PUNCT = { '。': '.', '、': ',', '？': '?', '！': '!', '…': '…', '「': '"', '」': '"' };
// Particles written as their own word.
const PARTICLE = { は: 'wa', へ: 'e', を: 'o' };
// Greetings that end in the particle は.
const WA_ENDINGS = ['にちは', 'ばんは'];

function kanaWord(word) {
  const syl = [];
  const ch = [...word];
  for (let i = 0; i < ch.length; i++) {
    const c = ch[i];
    const y = SMALL_Y[ch[i + 1]];
    if (c === 'っ') { syl.push('っ'); continue; }
    if (y && BASE[c]) {
      const b = BASE[c];
      // し+ゃ → sha, ち+ゃ → cha, じ+ゃ → ja, き+ゃ → kya
      const stem = ['shi', 'chi', 'ji'].includes(b) ? b.slice(0, -1) : `${b.slice(0, -1)}y`;
      syl.push(stem + y);
      i++;
      continue;
    }
    if (BASE[c]) { syl.push(BASE[c]); continue; }
    if (PUNCT[c]) { syl.push(PUNCT[c]); continue; }
    throw new Error(`no romaji for "${c}" in "${word}"`);
  }
  let out = '';
  for (let i = 0; i < syl.length; i++) {
    let s = syl[i];
    if (s === 'っ') {
      const next = syl[i + 1] || '';
      out += next.startsWith('ch') ? 't' : next[0] && /[a-z]/.test(next[0]) ? next[0] : '';
      continue;
    }
    // ん before a vowel or y: n' (きんえん → kin'en)
    if (s === 'n' && /^[aeiouy]/.test(syl[i + 1] || '')) s = "n'";
    out += s;
  }
  // Long vowels: ou, oo → ō; uu → ū.
  return out.replace(/o[ou]/g, 'ō').replace(/uu/g, 'ū');
}

export function toRomaji(kana) {
  return kana.trim().split(/\s+/).map((w) => {
    const bare = w.replace(/[。、？！…]+$/u, '');
    const tail = w.slice(bare.length);
    if (PARTICLE[bare]) return PARTICLE[bare] + kanaWord(tail);
    const end = WA_ENDINGS.find((e) => bare.endsWith(e));
    if (end) return `${kanaWord(bare.slice(0, -1))}wa${kanaWord(tail)}`;
    // Punctuation in the middle of a word ("すみません。えいご") splits it.
    return w.split(/(?<=[。、？！])/u).map(kanaWord).join(' ');
  }).join(' ').replace(/ ([.,?!])/g, '$1');
}

export function parseLine(line) {
  const parts = line.split('|').map((s) => s.trim());
  if (parts.length < 3 || parts.slice(0, 3).some((p) => !p)) throw new Error(`bad line: ${line}`);
  const [k, j, e, ...opts] = parts;
  const x = { k, j, e };
  for (const o of opts) {
    const m = o.match(/^([rsn])=(.+)$/s);
    if (!m) throw new Error(`bad option "${o}" in: ${line}`);
    x[m[1]] = m[2].trim();
  }
  if (!/^[\p{Script=Hiragana}ー\s。、？！…]+$/u.test(k)) throw new Error(`kana field has non-hiragana: ${k}`);
  x.r ||= toRomaji(k);
  return x;
}

export function parse(text) {
  const lessons = [];
  const phrases = [];
  const seen = new Set();
  let lesson = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || (line.startsWith('#') && !line.startsWith('##'))) continue;
    const h = line.match(/^##\s+(\d+)\s+(.+)$/);
    if (h) {
      lesson = { l: Number(h[1]), t: h[2] };
      lessons.push(lesson);
      continue;
    }
    if (!lesson) throw new Error(`phrase before first lesson: ${line}`);
    const x = parseLine(line);
    if (seen.has(x.j)) throw new Error(`duplicate phrase: ${x.j}`);
    seen.add(x.j);
    phrases.push({ id: x.j, l: lesson.l, k: x.k, j: x.j, r: x.r, e: x.e, ...(x.s && { s: x.s }), ...(x.n && { n: x.n }) });
  }
  return { lessons, phrases };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const data = parse(fs.readFileSync(SRC, 'utf8'));
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify({ source: 'Pimsleur Japanese 1 Reading Booklet & Culture Notes', ...data })}\n`);
  console.log(`wrote ${path.relative(ROOT, OUT)}: ${data.phrases.length} phrases in ${data.lessons.length} lessons`);
}
