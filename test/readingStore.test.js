import test from "node:test";
import assert from "node:assert/strict";

import {
  assessReadingDifficulty,
  createSentenceBankReadings,
  createEmptyReading,
  createReading,
  dueSentenceUnits,
  difficultyTagFromLevel,
  getSentenceStudyStats,
  preserveReadingSentenceData,
  readingTagFromSlug,
  reviewReadingSentence,
  sortReadingSentencesByDifficulty,
  stripDifficultyTags,
  splitChineseTextIntoSentences,
} from "../src/lib/readingStore.js";

test("splitChineseTextIntoSentences breaks text on Chinese punctuation and line breaks", () => {
  const sentences = splitChineseTextIntoSentences("你好。我们去吧！真的吗？\n好。");
  assert.deepEqual(sentences, ["你好。", "我们去吧！", "真的吗？", "好。"]);
});

test("createEmptyReading creates a unique draft id instead of a shared fallback", () => {
  const reading = createEmptyReading();
  assert.match(reading.id, /^reading-/);
  assert.notEqual(reading.id, "reading");
});

test("createReading keeps ids stable and derives the slug from the title when present", () => {
  const reading = createReading({
    id: "reading-123",
    title: "Lesson 3: 朋友",
    body: "你好。再见。",
  });

  assert.equal(reading.id, "reading-123");
  assert.equal(reading.slug, "lesson-3-朋友");
  assert.equal(reading.sentences.length, 2);
});

test("preserveReadingSentenceData keeps translation and audio when text is unchanged", () => {
  const previousReading = createReading({
    id: "reading-1",
    title: "Reader",
    body: "你好。再见。",
    sentences: [
      {
        id: "sentence-1",
        position: 0,
        text: "你好。",
        translation: "Hello.",
        assetId: "asset-1",
        mediaUrl: "/audio/hello.mp3",
      },
      {
        id: "sentence-2",
        position: 1,
        text: "再见。",
        translation: "Goodbye.",
      },
    ],
  });

  const nextReading = preserveReadingSentenceData(previousReading, createReading({
    id: "reading-1",
    title: "Reader",
    body: "你好。\n谢谢。",
  }));

  assert.equal(nextReading.sentences[0].translation, "Hello.");
  assert.equal(nextReading.sentences[0].assetId, "asset-1");
  assert.equal(nextReading.sentences[0].mediaUrl, "/audio/hello.mp3");
  assert.equal(nextReading.sentences[1].text, "谢谢。");
  assert.equal(nextReading.sentences[1].translation, "");
});

test("readingTagFromSlug normalizes reading tags for deck filtering", () => {
  assert.equal(readingTagFromSlug("Lesson 3: 朋友"), "reading:lesson-3-朋友");
});

test("assessReadingDifficulty tags short direct texts as beginner", () => {
  const difficulty = assessReadingDifficulty("你好。谢谢。再见。");

  assert.ok(difficulty);
  assert.equal(difficulty.level, "beginner");
  assert.equal(difficulty.tag, "difficulty:beginner");
});

test("createReading adds an automatic difficulty tag and preserves manual tags", () => {
  const reading = createReading({
    id: "reading-2",
    title: "Weekend Plans",
    body: "今天下班以后我想去超市买一点水果，然后回家做饭。明天早上还要早点出门。",
    tags: ["dialogue", "difficulty:advanced"],
  });

  assert.ok(reading.difficultyLevel);
  assert.ok(reading.tags.includes("dialogue"));
  assert.ok(reading.tags.includes(difficultyTagFromLevel(reading.difficultyLevel)));
  assert.deepEqual(stripDifficultyTags(reading.tags), ["dialogue"]);
  assert.equal(reading.tags.filter((tag) => tag.startsWith("difficulty:")).length, 1);
});

test("dueSentenceUnits builds a daily queue from due sentences across texts", () => {
  const now = "2026-04-25T09:00:00.000Z";
  const texts = [
    createReading({
      id: "text-1",
      title: "Restaurant",
      topic: "Ordering at a restaurant",
      sentences: [
        { id: "s-1", position: 0, text: "我要一碗面。", dueAt: now },
        { id: "s-2", position: 1, text: "谢谢。", dueAt: "2026-04-26T09:00:00.000Z" },
      ],
    }),
    createReading({
      id: "text-2",
      title: "Barber",
      topic: "Going to the barber",
      sentences: [
        { id: "s-3", position: 0, text: "我想剪头发。", dueAt: now },
      ],
    }),
  ];

  const queue = dueSentenceUnits(texts, now, { dailySentenceLimit: 10 }).queue;

  assert.deepEqual(queue.map((sentence) => sentence.id), ["s-1", "s-3"]);
  assert.equal(queue[0].readingTitle, "Restaurant");
  assert.equal(queue[1].topic, "Going to the barber");
});

test("reviewReadingSentence advances a sentence repetition", () => {
  const reviewed = reviewReadingSentence(
    createReading({
      id: "text-3",
      title: "Small Talk",
      sentences: [
        { id: "s-4", position: 0, text: "今天天气很好。", dueAt: "2026-04-25T09:00:00.000Z" },
      ],
    }).sentences[0],
    "good",
    "2026-04-25T09:00:00.000Z",
  );

  assert.equal(reviewed.reps, 1);
  assert.equal(reviewed.totalReviewCount, 1);
  assert.equal(reviewed.state, "learning");
  assert.equal(reviewed.firstReviewedAt, "2026-04-25T09:00:00.000Z");
  assert.equal(reviewed.dueAt, "2026-04-26T09:00:00.000Z");
});

test("getSentenceStudyStats includes lifetime review totals", () => {
  const stats = getSentenceStudyStats([
    createReading({
      id: "text-stats-1",
      title: "Ordering",
      sentences: [
        { id: "s-1", text: "你好。", totalReviewCount: 4 },
        { id: "s-2", text: "我要一碗面。", totalReviewCount: 7 },
      ],
    }),
  ]);

  assert.equal(stats.summary.totalReviewCount, 11);
});

test("sortReadingSentencesByDifficulty puts shorter simpler sentences first", () => {
  const sorted = sortReadingSentencesByDifficulty([
    { id: "s-2", text: "如果你明天下午有时间的话，我们可以一起去看看那个新开的展览。" },
    { id: "s-1", text: "你好。" },
    { id: "s-3", text: "我要一杯茶。" },
  ]);

  assert.deepEqual(sorted.map((sentence) => sentence.id), ["s-1", "s-3", "s-2"]);
  assert.equal(sorted[0].position, 0);
  assert.equal(sorted[2].difficultyLevel, "advanced");
});

test("createSentenceBankReadings groups rows by topic and keeps sentence tags", () => {
  const readings = createSentenceBankReadings(
    [
      "你好。\tHello.\tni hao\tbasics, greeting\tgreetings",
      "我要一碗面。\tI'd like noodles.\t\tfood, ordering\trestaurant",
      "谢谢。\tThanks.\t\ttone\tgreetings",
    ].join("\n"),
    {
      title: "Starter bank",
      topic: "General",
      tags: ["seed"],
    },
  );

  assert.equal(readings.length, 2);
  const greetingSentence = readings[0].sentences.find((sentence) => sentence.tags.includes("greeting"));
  assert.equal(!!greetingSentence, true);
  assert.equal(greetingSentence.tags.includes("seed"), true);
  assert.equal(readings[1].topic, "restaurant");
});

test("createSentenceBankReadings parses CSV headers and quoted fields", () => {
  const readings = createSentenceBankReadings(
    [
      "sentence,pinyin,translation,tags,topic,note",
      "\"你好。\",\"nǐ hǎo\",\"Hello\",\"greeting, basics\",\"greetings\",\"opener\"",
      "\"我要一碗面。\",\"wǒ yào yì wǎn miàn\",\"I'd like a bowl of noodles, please.\",\"ordering, food\",\"restaurant\",\"common request\"",
    ].join("\n"),
    {
      title: "LLM Batch",
      tags: ["seed"],
    },
  );

  assert.equal(readings.length, 2);
  const restaurantReading = readings.find((reading) => reading.topic === "restaurant");
  assert.equal(!!restaurantReading, true);
  assert.equal(restaurantReading.sentences[0].translation, "I'd like a bowl of noodles, please.");
  assert.equal(restaurantReading.sentences[0].tags.includes("ordering"), true);
  assert.equal(restaurantReading.sentences[0].note, "common request");
});
