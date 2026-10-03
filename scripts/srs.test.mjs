import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newCard, schedule, previewIntervals, dayStart, dayKey,
  AGAIN, HARD, GOOD, EASY, MIN, DAY, LEARN_STEPS, MIN_EASE,
} from '../public/srs.js';
import { numberedToMarked, splitBlocks } from './build-data.mjs';

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
