import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { toRomaji, parseLine, parse } from './build-ja.mjs';
import { orderNew } from '../public/ja/queue.js';

test('romaji: basic words, long vowels and contractions', () => {
  assert.equal(toRomaji('ありがとう'), 'arigatō');
  assert.equal(toRomaji('どうぞ よろしく。'), 'dōzo yoroshiku.');
  assert.equal(toRomaji('せんせい'), 'sensei');
  assert.equal(toRomaji('ゆうびんきょく'), 'yūbinkyoku');
  assert.equal(toRomaji('しゃかいしゅぎ'), 'shakaishugi');
  assert.equal(toRomaji('ちゃいろ'), 'chairo');
  assert.equal(toRomaji('じゃあ また'), 'jaa mata');
  assert.equal(toRomaji('おおきい'), 'ōkii');
  assert.equal(toRomaji('つめたい'), 'tsumetai');
  assert.equal(toRomaji('ふゆ'), 'fuyu');
  assert.equal(toRomaji('ひゃく'), 'hyaku');
  assert.equal(toRomaji('ひょうしき'), 'hyōshiki');
  assert.equal(toRomaji('りょかん'), 'ryokan');
});

test('romaji: small tsu doubles the next consonant', () => {
  assert.equal(toRomaji('きって'), 'kitte');
  assert.equal(toRomaji('ちょっと'), 'chotto');
  assert.equal(toRomaji('いっぽん'), 'ippon');
  assert.equal(toRomaji('みゅうじっく'), 'myūjikku');
});

test("romaji: ん before a vowel gets an apostrophe", () => {
  assert.equal(toRomaji('きんえん'), "kin'en");
  assert.equal(toRomaji('こんにゃく'), 'konnyaku');
});

test('romaji: particles は へ を as their own word', () => {
  assert.equal(toRomaji('わたし は にほんじん です。'), 'watashi wa nihonjin desu.');
  assert.equal(toRomaji('かまくら へ いきません か。'), 'kamakura e ikimasen ka.');
  assert.equal(toRomaji('ほん を かいます。'), 'hon o kaimasu.');
  assert.equal(toRomaji('あさって は？'), 'asatte wa?');
  assert.equal(toRomaji('はい'), 'hai');
  assert.equal(toRomaji('こんにちは。'), 'konnichiwa.');
});

test('romaji: punctuation', () => {
  assert.equal(toRomaji('すみません。えいご が わかります か。'), 'sumimasen. eigo ga wakarimasu ka.');
  assert.equal(toRomaji('いいえ、わかりません。'), 'iie, wakarimasen.');
  assert.equal(toRomaji('むかし むかし…'), 'mukashi mukashi…');
});

test('parseLine reads options and rejects kanji in the kana field', () => {
  const x = parseLine('にち | 日 | day; sun | s=にち | n=note here');
  assert.deepEqual(x, { k: 'にち', j: '日', e: 'day; sun', s: 'にち', n: 'note here', r: 'nichi' });
  assert.throws(() => parseLine('日 | 日 | day'));
  assert.throws(() => parseLine('にち | 日'));
});

test('the phrase list builds, ids are unique, every lesson has phrases', () => {
  const { lessons, phrases } = parse(fs.readFileSync(new URL('../data/japanese/pimsleur-ja1.txt', import.meta.url), 'utf8'));
  assert.equal(lessons.length, 21);
  assert.equal(new Set(phrases.map((p) => p.id)).size, phrases.length);
  for (const l of lessons) assert.ok(phrases.some((p) => p.l === l.l), `lesson ${l.l} empty`);
  const built = JSON.parse(fs.readFileSync(new URL('../public/ja/data/phrases.json', import.meta.url), 'utf8'));
  assert.deepEqual(built.phrases, phrases, 'public/ja/data/phrases.json is stale: run npm run build:ja');
});

// ---- new-card ordering ----

const P = [{ id: 'a', l: 1 }, { id: 'b', l: 1 }, { id: 'c', l: 2 }];

test('new cards: first direction in phrase order, reverse only after the first has graduated', () => {
  const cards = {};
  assert.deepEqual(orderNew(P, ['r', 'p'], [1, 2], cards), ['a|r', 'b|r', 'c|r']);
  cards['a|r'] = { state: 'learning' };
  assert.deepEqual(orderNew(P, ['r', 'p'], [1, 2], cards), ['b|r', 'c|r']);
  cards['a|r'] = { state: 'review' };
  assert.deepEqual(orderNew(P, ['r', 'p'], [1, 2], cards), ['a|p', 'b|r', 'c|r']);
});

test('new cards: only selected lessons, and a single direction works on its own', () => {
  assert.deepEqual(orderNew(P, ['p'], [2], {}), ['c|p']);
  assert.deepEqual(orderNew(P, ['r', 'p', 'l'], [1], { 'a|r': { state: 'review' } }), ['a|p', 'a|l', 'b|r']);
});
