# 港小字卡 — HK Primary Characters SRS

An installable, offline-capable PWA (works on iPhone/iPad via **Add to Home Screen**) for spaced-repetition training of the Hong Kong primary-school character list. It shows **Cantonese (Jyutping)** and **Mandarin (Pinyin)** readings, and can play both aloud.

## The character list

`data/sources/hk-graded-2600-1990.txt` is the **小學分級常用字表**: 2,600 characters graded P1–P6, published in the Curriculum Development Council's 《小學中國語文科（小一至小六課程綱要）》(1990). It is the only official HK list that assigns characters to individual primary years. The transcription comes from [zispace/hanzi-chars](https://github.com/zispace/hanzi-chars).

The current EDB reference, 《香港小學學習字詞表》(2007, [edbchinese.hk/lexlist_ch](https://www.edbchinese.hk/lexlist_ch/)), has 3,171 characters. It groups them only by key stage: KS1 (P1–3) has 2,169 characters and KS2 (P4–6) has 1,002. It doesn't break them down by year.

**How grades were assigned:** the source file has no grade labels. It is ordered grade by grade, and each block is sorted by stroke count. `scripts/build-data.mjs` splits the list wherever the stroke count drops back down. That gives 8 blocks (374, 86, 367, 133, 530, 590, 260, 260), mapped to grades as follows:

| Level | Characters |
|---|---|
| P1 小一 | 460 (374 + 86) |
| P2 小二 | 500 (367 + 133) |
| P3 小三 | 530 |
| P4 小四 | 590 |
| P5 小五 | 260 |
| P6 小六 | 260 |

The P1 and P2 sub-blocks are probably core and supplementary lists. If you have the printed syllabus, check the mapping against it. To change it, edit `BLOCK_GRADE` in the build script.

## Features

- SRS scheduling in the SM-2 family, like Anki: learning steps of 1 min and 10 min, then Again / Hard / Good / Easy with an interval preview on each button, and lapses go to relearning. The study day rolls over at 04:00.
- **Train by level:** switch P1–P6 on or off. New characters come in curriculum order, P1 first. You set the number of new cards per day.
- Three card types: **Read** (see the character, recall the sound and meaning), **Listen** (hear it, recall the character) and **Write** (see the meaning and reading, write the character).
- Cantonese and Mandarin playback through the device's built-in voices (Web Speech API), with optional auto-play when you reveal the answer. On iOS, download the *Sinji (Cantonese, Hong Kong)* voice under Settings → Accessibility → Read & Speak → Voices → Chinese (called Spoken Content before iOS 26) for the best Cantonese.
- Up to 3 common example words per character, each with Jyutping, Pinyin, English and audio. Where Mandarin differs, the example also shows the mainland word (侍應 → 服務員) and, optionally, Taiwan's word or pronunciation (出租車 → 計程車, 垃圾 → lè sè). The Taiwan notes can be turned off in Settings.
- An example sentence for every example word, in three versions of standard written Chinese: **Hong Kong 港**, **mainland 陸** and **Taiwan 台**. A switch above the examples changes all sentences on the card at once (the choice is remembered), and a 陸用詞 / 台用詞 tag marks sentences where that region uses different words, not just different characters (巴士 → 公交车 / 公車, 功課 → 作业). Tap a sentence to hear it: Hong Kong in Cantonese, mainland and Taiwan in Mandarin. You can turn sentences off in Settings.
- Tone-coloured readings, plus the simplified form and stroke count.
- Browse each level as a grid coloured by progress. Search by 字, Jyutping or Pinyin (with or without tones), or English.
- Progress is stored on the device in `localStorage`. You can export and import JSON backups through the share sheet on iOS. Works offline once loaded (service worker).

## Run locally

```sh

npx http-server public -p 8080 -c-1   # then open http://localhost:8080
```

## Install on iPhone

You need to host `public/` over **HTTPS**. The workflow `.github/workflows/pages.yml` deploys it to GitHub Pages on every push to `main`. Turn this on once under repo **Settings → Pages → Source: GitHub Actions**. The site is then at **https://bthecorgi.github.io/hk-chinese-srs/**. Any other static host works too (Netlify, Cloudflare Pages, Vercel).

Open the URL in Safari, tap **Share → Add to Home Screen**, and launch it from the home screen icon.

## Rebuilding the data

```sh
npm install          # data packages: Unihan (mojidata), CC-CEDICT, SUBTLEX-CH, to-jyutping
npm run build:data   # writes public/data/chars.json (downloads the LSHK table into data/cache/)
npm run build:sentences  # writes public/data/sentences.json from data/sentences/
npm run build:icons  # optional; needs Playwright + a CJK font
npm test             # scheduler + build helper tests
```

After changing any file in `public/`, bump `VERSION` in `public/sw.js` so installed apps pick up the update.

Each record in `chars.json` has these fields:

- `c`: the character
- `g`: grade, 1–6
- `s`: stroke count
- `j`: Jyutping readings, most common first
- `p`: Pinyin readings
- `d`: English gloss
- `e`: example words, each `[word, jyutping, pinyin, english]`, plus an optional `{ cn: [word, pinyin], tw: [word, pinyin] }` where mainland or Taiwan Mandarin differs
- `sc`: simplified form
- `v`: variant form listed in the source

Example sentences are hand-written in `data/sentences/*.txt`, one example word per line:

```
word|Hong Kong sentence|English[|mainland sentence[|Taiwan sentence]]
```

Write the Hong Kong sentence in standard written Chinese (not colloquial Cantonese) with Hong Kong vocabulary. Only add a mainland or Taiwan sentence where the wording differs and the build's swap table (`SWAPS` in `scripts/build-sentences.mjs`: 巴士, 單車, 課室, 溫習, 功課…) doesn't already cover it. Everything else is converted with [OpenCC](https://github.com/nk2028/opencc-js), which also handles character-form differences (裏/里/裡, 着/著, 甚麼/什么/什麼). The build fails if a sentence is missing its word or uses colloquial Cantonese characters, and warns about example words that have no sentence yet (for example after `build:data` picks new words). `sentences.json` maps each word to `[hk, english, cn, tw, diff]`. The example word is marked with `⟦⟧`, `tw` is `null` when it is identical to `hk`, and `diff` is 1 when the mainland wording differs and 2 when Taiwan's does.

## Data sources & licences

- Character list: 香港課程發展議會 (1990), via zispace/hanzi-chars.
- Cantonese readings: [LSHK 粵拼表](https://github.com/lshk-org/jyutping-table) (CC BY 4.0) and [to-jyutping](https://github.com/CanCLID/to-jyutping), which picks the main reading and handles words in context.
- Mandarin readings, English glosses, stroke counts and simplified forms: Unicode [Unihan](https://www.unicode.org/charts/unihan.html) (Unicode licence), via `@mandel59/mojidata`.
- Example words: [CC-CEDICT](https://cc-cedict.org/) (CC BY-SA 4.0), ranked by [SUBTLEX-CH](https://www.ugent.be/pp/experimentele-psychologie/en/research/documents/subtlexch) word frequency.
- Example sentences: written for this app; mainland and Taiwan forms converted with OpenCC (Apache 2.0) via `opencc-js`.
- Example word corrections: `data/example-overrides.json` is a hand-checked list applied at build time. `fix` corrects the Pinyin, Jyutping or English of a word (CC-CEDICT often lists one written word under several readings, e.g. 結果 jiē guǒ "to bear fruit" vs jié guǒ "result", and the build can't tell which is meant). `exclude` drops words that mean something different in Cantonese and Mandarin (窩心, 薄餅), Hong Kong-only or dialect words that Mandarin doesn't use (侍應, 警署, 阿爸), and words not suitable for primary pupils. The next-ranked word replaces anything excluded. `regional` gives the mainland (`cn`) and Taiwan (`tw`) Mandarin forms for words that differ, such as Hong Kong words (侍應, 恤衫, 地盤) and mainland/Taiwan pairs (軟件/軟體, 地鐵/捷運). Taiwan pronunciations come from CC-CEDICT's "Taiwan pr." notes on words, plus the hand-checked `taiwanChars` table (期 qí, 危 wéi, 髮 fǎ, …) for words it doesn't annotate.

Readings come from automatic sources, so check any doubtful polyphonic characters (e.g. 長, 行, 重) against a dictionary.
