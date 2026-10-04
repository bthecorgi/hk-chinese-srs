// Builds public/data/sentences.json from the hand-written example sentences.
//
// Source: data/sentences/*.txt, one example word per line:
//   word|Hong Kong sentence|English[|mainland sentence[|Taiwan sentence]]
//
// The Hong Kong sentence is standard written Chinese as used in Hong Kong, in
// traditional characters with Hong Kong vocabulary. The mainland and Taiwan
// sentences are only written out where the wording differs (巴士 → 公交车 / 公車);
// otherwise they are converted from the Hong Kong one with OpenCC, which also
// handles character-form differences (裏 → 里 / 裡, 着 → 着 / 著). A mainland
// sentence may be written in traditional or simplified characters.
//
// Output: { word: [hk, english, cn, tw, diff] }, where tw is null when it is
// identical to hk, and diff is a bitmask: 1 = mainland wording differs, 2 = Taiwan
// wording differs. The example word is wrapped in ⟦⟧ in each sentence.
//
// Usage: npm run build:sentences   (run after build:data)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'data', 'sentences');
const OUT = path.join(ROOT, 'public', 'data', 'sentences.json');

// Cantonese colloquial characters that don't belong in standard written Chinese.
const COLLOQUIAL = /[嘅咗佢嘢冇啲喺睇唔哋嚟噉咁乜嘥攞揸]/;

export function parseLine(line) {
  const [w, hk, en, cn, tw] = line.split('|').map((s) => s.trim());
  return { w, hk, en, cn: cn || null, tw: tw || null };
}

export function makeConverters(OpenCC) {
  const toHK = OpenCC.Converter({ from: 't', to: 'hk' });
  const hk2cn = OpenCC.Converter({ from: 'hk', to: 'cn' });
  const hk2tw = OpenCC.Converter({ from: 'hk', to: 'tw' });
  // OpenCC keeps the Hong Kong 甚麼, but the mainland and Taiwan write 什么 / 什麼.
  return {
    hk: (s) => toHK(s),
    cn: (s) => hk2cn(s).replace(/甚么/g, '什么'),
    tw: (s) => hk2tw(s).replace(/甚麼/g, '什麼'),
  };
}

// Wraps the first occurrence of the example word in ⟦⟧ so the app can highlight it.
export function mark(text, words) {
  const w = words.find((x) => text.includes(x));
  return w ? text.replace(w, `⟦${w}⟧`) : text;
}

function main() {
  const OpenCC = require('opencc-js');
  const conv = makeConverters(OpenCC);
  const cn2twp = OpenCC.Converter({ from: 'cn', to: 'twp' });
  const cn2tw = OpenCC.Converter({ from: 'cn', to: 'tw' });

  const chars = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'chars.json'), 'utf8')).chars;
  const examples = new Map();
  for (const x of chars) for (const e of x.e) examples.set(e[0], e[4] || {});

  const errors = [];
  const notes = [];
  const out = {};
  const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.txt')).sort();
  for (const file of files) {
    const lines = fs.readFileSync(path.join(SRC, file), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!line.trim() || line.startsWith('#')) return;
      const at = `${file}:${i + 1}`;
      const s = parseLine(line);
      if (!s.w || !s.hk || !s.en) { errors.push(`${at}: needs word|sentence|English`); return; }
      if (out[s.w]) { errors.push(`${at}: duplicate sentence for ${s.w}`); return; }
      if (!examples.has(s.w)) notes.push(`${at}: ${s.w} is not an example word any more`);
      const alt = examples.get(s.w) || {};

      const hk = conv.hk(s.hk);
      const cn = conv.cn(s.cn ?? s.hk);
      const tw = conv.tw(s.tw ?? s.hk);
      if (!hk.includes(conv.hk(s.w))) errors.push(`${at}: Hong Kong sentence doesn't contain ${s.w}`);
      const cnWord = conv.cn(alt.cn?.[0] ?? s.w);
      if (!cn.includes(cnWord) && !cn.includes(conv.cn(s.w))) errors.push(`${at}: mainland sentence doesn't contain ${cnWord}`);
      const twWord = conv.tw(alt.tw?.[0] ?? alt.cn?.[0] ?? s.w);
      if (!tw.includes(twWord) && !tw.includes(conv.tw(s.w))) errors.push(`${at}: Taiwan sentence doesn't contain ${twWord}`);
      for (const [label, text] of [['Hong Kong', s.hk], ['mainland', s.cn], ['Taiwan', s.tw]]) {
        if (text && COLLOQUIAL.test(text)) errors.push(`${at}: ${label} sentence has colloquial Cantonese: ${text}`);
      }
      if (alt.cn && !s.cn) notes.push(`${at}: ${s.w} is ${alt.cn[0]} on the mainland, but no mainland sentence is given`);
      // OpenCC's Taiwan phrase table knows some vocabulary differences (软件 → 軟體).
      if (!s.tw && cn2twp(cn) !== cn2tw(cn)) notes.push(`${at}: Taiwan may say ${cn2twp(cn)}`);

      const diff = (s.cn && cn !== conv.cn(s.hk) ? 1 : 0) | (s.tw && tw !== conv.tw(s.hk) ? 2 : 0);
      const twOut = tw === hk ? null : tw;
      out[s.w] = [mark(hk, [conv.hk(s.w)]), s.en, mark(cn, [cnWord, conv.cn(s.w)]),
        twOut && mark(twOut, [twWord, conv.tw(s.w)]), diff];
    });
  }

  const missing = [...examples.keys()].filter((w) => !out[w]);
  for (const n of notes) console.log(`note: ${n}`);
  if (missing.length) console.warn(`${missing.length} example words have no sentence yet, e.g. ${missing.slice(0, 20).join(' ')}`);
  if (errors.length) {
    for (const e of errors) console.error(e);
    process.exitCode = 1;
    return;
  }
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`wrote ${Object.keys(out).length} sentences to ${path.relative(ROOT, OUT)}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
