import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAnkiWordAudioClip,
  buildCardFromAnkiRow,
  extractExampleRows,
  extractSoundFilename,
  mergeImportedCards,
  stripImportedDeckLabel,
  stripHtmlToText,
} from "../scripts/lib/anki-apkg.mjs";
import { createChineseCard } from "../src/lib/studyStore.js";

test("stripHtmlToText removes tags and decodes HTML entities", () => {
  const text = stripHtmlToText("<p>Me &amp; you<br>一起。</p>");
  assert.equal(text, "Me & you\n一起。");
});

test("extractExampleRows reads hanzi, pinyin, and translation cells", () => {
  const rows = extractExampleRows(`
    <table>
      <tr>
        <td class='kan'>我哥哥每天上班都迟到。</td>
        <td class='rom'>Wǒ gēge měitiān shàngbān dōu chídào.</td>
        <td class='eng'>My brother is late for work every day.</td>
      </tr>
      <tr>
        <td class='kan'>我。</td>
        <td class='rom'>Wǒ.</td>
        <td class='eng'>Me.</td>
      </tr>
    </table>
  `);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].hanzi, "我哥哥每天上班都迟到。");
  assert.equal(rows[0].pinyin, "Wǒ gēge měitiān shàngbān dōu chídào.");
  assert.equal(rows[0].translation, "My brother is late for work every day.");
});

test("buildCardFromAnkiRow promotes the best example without adding extra dictionary clips", () => {
  const card = buildCardFromAnkiRow({
    noteId: 123,
    rank: 42,
    word: "我",
    meanings: "<ol><li>I</li><li>me</li><li>my</li></ol>",
    pinyin: "<a href='#'>wǒ</a> (<a href='#'>wo3</a>)",
    examples: `
      <table>
        <tr>
          <td class='kan'>我。</td>
          <td class='rom'>Wǒ.</td>
          <td class='eng'>Me.</td>
        </tr>
        <tr>
          <td class='kan'>我哥哥每天上班都迟到。</td>
          <td class='rom'>Wǒ gēge měitiān shàngbān dōu chídào.</td>
          <td class='eng'>My brother is late for work every day.</td>
        </tr>
      </table>
    `,
    tags: "anki imported",
  }, { deckTitle: "Chinese Frequency" });

  assert.equal(card.hanzi, "我");
  assert.equal(card.pinyin, "wǒ");
  assert.equal(card.example, "我哥哥每天上班都迟到。");
  assert.equal(card.exampleTranslation, "My brother is late for work every day.");
  assert.equal(card.notes, "Frequency rank: 42");
  assert.equal(card.clips.length, 0);
  assert.ok(card.tags.includes("frequency-list"));
});

test("buildCardFromAnkiRow attaches imported word audio before example clips", () => {
  const card = buildCardFromAnkiRow({
    noteId: 456,
    rank: 88,
    word: "你",
    meanings: "you",
    pinyin: "nǐ",
    examples: `
      <table>
        <tr>
          <td class='kan'>你好吗？</td>
          <td class='rom'>Nǐ hǎo ma?</td>
          <td class='eng'>How are you?</td>
        </tr>
      </table>
    `,
  }, {
    deckTitle: "Chinese Frequency",
    audioClip: buildAnkiWordAudioClip({
      noteId: 456,
      mediaUrl: "/imported-audio/anki/chinese-frequency/1-googletts.mp3",
      storageKey: "imported-audio/anki/chinese-frequency/1-googletts.mp3",
      filename: "googletts.mp3",
    }),
  });

  assert.equal(card.clips.length, 1);
  assert.equal(card.clips[0].title, "Word audio");
  assert.equal(card.clips[0].mediaKind, "audio");
  assert.equal(card.clips[0].mediaUrl, "/imported-audio/anki/chinese-frequency/1-googletts.mp3");
});

test("mergeImportedCards preserves existing cards and enriches duplicates", () => {
  const existing = {
    items: [
      createChineseCard({
        id: "existing-1",
        hanzi: "我",
        pinyin: "wǒ",
        gloss: "I",
        notes: "Existing note",
        tags: ["custom"],
      }),
    ],
  };

  const imported = [
    createChineseCard({
      id: "anki-1",
      hanzi: "我",
      pinyin: "wǒ",
      gloss: "me",
      notes: "Frequency rank: 42",
      tags: ["frequency-list"],
      clips: [{ title: "Dictionary example", transcript: "我。", translation: "Me." }],
    }),
    createChineseCard({
      id: "anki-2",
      hanzi: "你",
      pinyin: "nǐ",
      gloss: "you",
    }),
  ];

  const merged = mergeImportedCards(existing, imported);

  assert.equal(merged.state.items.length, 2);
  const wo = merged.state.items.find((item) => item.hanzi === "我");
  assert.ok(wo.notes.includes("Existing note"));
  assert.ok(wo.notes.includes("Frequency rank: 42"));
  assert.ok(wo.tags.includes("custom"));
  assert.ok(wo.tags.includes("frequency-list"));
  assert.equal(wo.clips.length, 1);
  assert.equal(merged.mergedExisting, 1);
  assert.equal(merged.addedNew, 1);
});

test("mergeImportedCards does not duplicate audio-only imported clips on reimport", () => {
  const existing = {
    items: [
      createChineseCard({
        id: "existing-1",
        hanzi: "我",
        gloss: "I",
        clips: [
          {
            title: "Word audio",
            mediaKind: "audio",
            mediaUrl: "/imported-audio/anki/chinese-frequency/0-googletts.mp3",
          },
        ],
      }),
    ],
  };

  const imported = [
    createChineseCard({
      id: "anki-1",
      hanzi: "我",
      gloss: "I",
      clips: [
        {
          title: "Word audio",
          mediaKind: "audio",
          mediaUrl: "/imported-audio/anki/chinese-frequency/0-googletts.mp3",
        },
      ],
    }),
  ];

  const merged = mergeImportedCards(existing, imported);
  const wo = merged.state.items.find((item) => item.hanzi === "我");

  assert.equal(wo.clips.length, 1);
  assert.equal(wo.clips[0].title, "Word audio");
});

test("extractSoundFilename reads Anki sound markup", () => {
  assert.equal(extractSoundFilename("[sound:googletts-123.mp3]"), "googletts-123.mp3");
});

test("stripImportedDeckLabel removes noisy deck source lines", () => {
  assert.equal(
    stripImportedDeckLabel("Frequency rank: 163\nImported from 5000_Most_Frequent_Chinese_Words_With_Wiktionary_Entries."),
    "Frequency rank: 163",
  );
});
