import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newCard, schedule, previewIntervals, dayStart, dayKey,
  AGAIN, HARD, GOOD, EASY, MIN, DAY, LEARN_STEPS, MIN_EASE,
} from '../public/srs.js';
import fs from 'node:fs';
import {
  numberedToMarked, splitBlocks, applyFix, addRegional, taiwanReadingOf, splitTaiwanPr,
} from './build-data.mjs';
import { createRequire } from 'node:module';
import { parseLine, makeConverters, mark, applySwaps } from './build-sentences.mjs';

const NOW = new Date(2026, 9, 3, 15, 0, 0).getTime(); // 3 Oct 2026, 15:00 local
const fixed = () => 0.5; // no fuzz

test('new card walks the learning steps then graduates', () => {
  let c = schedule(newCard(), GOOD, NOW, fixed);
  assert.equal(c.state, 'learning');
  assert.equal(c.due, NOW + LEARN_STEPS[1]);
  c = schedule(c, GOOD, c.due, fixed);
  assert.equal(c.state, 'review');
  assert.equal(c.ivl, 1);
  assert.equal(dayKey(c.due), '2026-10-04');
});

test('again resets to the first step', () => {
  let c = schedule(newCard(), GOOD, NOW, fixed);
  c = schedule(c, AGAIN, NOW, fixed);
  assert.equal(c.step, 0);
  assert.equal(c.due, NOW + MIN);
});

test('easy on a new card graduates straight to 4 days', () => {
  const c = schedule(newCard(), EASY, NOW, fixed);
  assert.equal(c.state, 'review');
  assert.equal(c.ivl, 4);
});

test('review intervals grow with ease and lapses shrink them', () => {
  let c = { ...newCard(), state: 'review', ivl: 10, ease: 2.5, due: NOW };
  const good = schedule(c, GOOD, NOW, fixed);
  assert.equal(good.ivl, 25);
  const hard = schedule(c, HARD, NOW, fixed);
  assert.equal(hard.ivl, 12);
  assert.ok(hard.ease < c.ease);
  const lapse = schedule(c, AGAIN, NOW, fixed);
  assert.equal(lapse.state, 'relearning');
  assert.equal(lapse.ivl, 5);
  assert.equal(lapse.lapses, 1);
  const back = schedule(lapse, GOOD, lapse.due, fixed);
  assert.equal(back.state, 'review');
  assert.equal(back.ivl, 5);
});

test('ease never drops below the floor', () => {
  let c = { ...newCard(), state: 'review', ivl: 3, ease: MIN_EASE, due: NOW };
  c = schedule(c, AGAIN, NOW, fixed);
  assert.equal(c.ease, MIN_EASE);
});

test('study day rolls over at 04:00', () => {
  const lateNight = new Date(2026, 9, 4, 2, 0).getTime();
  assert.equal(dayKey(lateNight), '2026-10-03');
  assert.equal(dayStart(lateNight), new Date(2026, 9, 3, 4, 0).getTime());
});

test('preview labels', () => {
  const p = previewIntervals(newCard(), NOW);
  assert.deepEqual(p, { 1: '1m', 2: '6m', 3: '10m', 4: '4d' });
  const r = previewIntervals({ ...newCard(), state: 'review', ivl: 10, due: NOW }, NOW);
  assert.equal(r[3], '25d');
  assert.ok(DAY > 0);
});

test('pinyin tone numbers become marks', () => {
  assert.equal(numberedToMarked('zhang3 da4'), 'zhǎng dà');
  assert.equal(numberedToMarked('lu:4 se4'), 'lǜ sè');
  assert.equal(numberedToMarked('xiu1 xi5'), 'xiū xi');
  assert.equal(numberedToMarked('gou3'), 'gǒu');
  assert.equal(numberedToMarked('gui4'), 'guì');
});

test('grade blocks split on stroke-count resets', () => {
  const strokes = { 一: 1, 人: 2, 大: 3, 乙: 1, 千: 3, 書: 10, 丈: 3 };
  const blocks = splitBlocks([...'一人大書乙千書丈'], (c) => strokes[c]);
  assert.deepEqual(blocks.map((b) => b.join('')), ['一人大書', '乙千書', '丈']);
});

test('example fixes override only the fields they set', () => {
  const ex = ['結果', 'git3 gwo2', 'jiē guǒ', 'to bear fruit'];
  assert.deepEqual(applyFix(ex, { p: 'jié guǒ', en: 'result' }), ['結果', 'git3 gwo2', 'jié guǒ', 'result']);
  assert.deepEqual(applyFix(ex, { j: 'git3 gwo2' }), ex);
  assert.equal(applyFix(ex, undefined), ex);
});

test('example overrides file is consistent', () => {
  const o = JSON.parse(fs.readFileSync(new URL('../data/example-overrides.json', import.meta.url), 'utf8'));
  for (const [w, fix] of Object.entries(o.fix)) {
    assert.ok(!(w in o.exclude), `${w} is both fixed and excluded`);
    assert.ok(Object.keys(fix).every((k) => ['p', 'j', 'en'].includes(k)), `${w}: unknown field`);
    if (fix.p) assert.equal(fix.p.split(' ').length, [...w].length, `${w}: one Pinyin syllable per character`);
    if (fix.j) assert.equal(fix.j.split(' ').length, [...w].length, `${w}: one Jyutping syllable per character`);
  }
  for (const [w, r] of Object.entries(o.regional)) {
    assert.ok(!(w in o.exclude), `${w} has regional notes but is excluded`);
    for (const k of ['cn', 'tw']) {
      if (!r[k]) continue;
      const [aw, py] = r[k];
      assert.equal(py.split(' ').length, [...aw].length, `${w}.${k}: one Pinyin syllable per character`);
    }
  }
  for (const [c, [from, to]] of Object.entries(o.taiwanChars)) {
    assert.ok(from !== to && !from.includes(' ') && !to.includes(' '), `${c}: bad Taiwan reading`);
  }
});

test('regional notes: hand-checked entries win, Taiwan readings fill in', () => {
  const ex = ['侍應', 'si6 jing3', 'shì yìng', 'waiter'];
  const r = { cn: ['服務員', 'fú wù yuán'], tw: ['服務生', 'fú wù shēng'] };
  assert.deepEqual(addRegional(ex, r, null), [...ex, r]);
  const lj = ['垃圾', 'laap6 saap3', 'lā jī', 'trash'];
  assert.deepEqual(addRegional(lj, undefined, 'lè sè'), [...lj, { tw: ['垃圾', 'lè sè'] }]);
  assert.deepEqual(addRegional(lj, { tw: null }, 'lè sè'), lj);
  assert.equal(addRegional(lj, undefined, 'lā jī'), lj);
});

test('Taiwan readings come from the word note, else the character table', () => {
  const notes = new Map([['垃圾|lā jī', 'lè sè']]);
  const chars = { 期: ['qī', 'qí'] };
  assert.equal(taiwanReadingOf('垃圾', 'lā jī', notes, chars), 'lè sè');
  assert.equal(taiwanReadingOf('星期', 'xīng qī', notes, chars), 'xīng qí');
  assert.equal(taiwanReadingOf('期待', 'qí dài', notes, chars), null);
  assert.equal(taiwanReadingOf('今天', 'jīn tiān', notes, chars), null);
});

test('CC-CEDICT Taiwan pronunciation notes are split out of glosses', () => {
  assert.deepEqual(splitTaiwanPr('Taiwan pr. [le4 se4]'), { gloss: '', tw: 'le4 se4' });
  assert.deepEqual(splitTaiwanPr('mint (plant); Taiwan pr. [bo4he2]'), { gloss: 'mint (plant)', tw: 'bo4 he2' });
  assert.deepEqual(splitTaiwanPr('snail'), { gloss: 'snail', tw: null });
});

test('sentence lines parse with optional mainland and Taiwan versions', () => {
  assert.deepEqual(parseLine('一個|我有一個妹妹。|I have a sister.'),
    { w: '一個', hk: '我有一個妹妹。', en: 'I have a sister.', cn: null, tw: null });
  assert.deepEqual(parseLine('酒店|住酒店。|Stay at a hotel.||住飯店。').tw, '住飯店。');
});

test('Hong Kong sentences convert to mainland and Taiwan forms', () => {
  const conv = makeConverters(createRequire(import.meta.url)('opencc-js'));
  assert.equal(conv.cn('你叫甚麼名字？'), '你叫什么名字？');
  assert.equal(conv.tw('你叫甚麼名字？'), '你叫什麼名字？');
  assert.equal(conv.cn('小狗跟着牠的主人，接著跑了。'), '小狗跟着它的主人，接着跑了。');
  assert.equal(conv.cn('他是著名的作家。'), '他是著名的作家。');
  assert.equal(conv.tw('孩子們在公園裏玩着。'), '孩子們在公園裡玩著。');
});

test('regional word swaps skip the example word itself', () => {
  assert.equal(applySwaps('我坐巴士做功課。', '我', 1), '我坐公交車做作業。');
  assert.equal(applySwaps('我坐巴士做功課。', '我', 2), '我坐公車做功課。');
  assert.equal(applySwaps('我做完功課。', '功課', 1), '我做完功課。');
  assert.equal(applySwaps('古代的士兵', '古代', 1), '古代的士兵');
});

test('the example word is marked once in its sentence', () => {
  assert.equal(mark('一起去，一起玩', ['一起']), '⟦一起⟧去，一起玩');
  assert.equal(mark('沒有這個詞', ['一起']), '沒有這個詞');
});
