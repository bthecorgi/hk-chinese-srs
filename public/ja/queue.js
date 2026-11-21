// Which new cards to introduce next. Pure, so it can be tested in Node.
//
// Every phrase has one card per direction: `${id}|r` (read Japanese, recall English),
// `${id}|p` (see English, produce Japanese) and `${id}|l` (listen, recall English).
// The first enabled direction is introduced in lesson order. The other directions of a
// phrase only become available once its first card has graduated, so you never meet a
// phrase's reverse card minutes after first seeing it. Those come first, being older.

export const DIRS = ['r', 'p', 'l'];
export const key = (id, dir) => `${id}|${dir}`;
export const splitKey = (k) => { const i = k.lastIndexOf('|'); return [k.slice(0, i), k.slice(i + 1)]; };

const isNew = (card) => !card || card.state === 'new';

export function orderNew(phrases, dirs, lessons, cards) {
  const on = DIRS.filter((d) => dirs.includes(d));
  if (!on.length) return [];
  const [first, ...rest] = on;
  const lessonSet = new Set(lessons);
  const later = [];
  const fresh = [];
  for (const p of phrases) {
    if (!lessonSet.has(p.l)) continue;
    const primary = cards[key(p.id, first)];
    if (isNew(primary)) { fresh.push(key(p.id, first)); continue; }
    if (primary.state !== 'review') continue;
    for (const d of rest) if (isNew(cards[key(p.id, d)])) later.push(key(p.id, d));
  }
  return [...later, ...fresh];
}
