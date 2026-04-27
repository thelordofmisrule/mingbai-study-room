import test from "node:test";
import assert from "node:assert/strict";
import {
  buildReadingVariants,
  buildReadingVariantsFromDictionaryEntries,
  DEFAULT_DAILY_NEW_LIMIT,
  DEFAULT_DAILY_REVIEW_LIMIT,
  createChineseCard,
  createStudyClip,
  dueStudyCards,
  formatLocalDateKey,
  getStudyStats,
  importStudyStateFromJson,
  normalizePreferences,
  reviewStudyCard,
  serializeReadingVariants,
  summarizeStudyCards,
} from "../src/lib/studyStore.js";

test("reviewStudyCard schedules Again reviews ten minutes later", () => {
  const baseCard = createChineseCard({
    id: "hanzi-1",
    hanzi: "明白",
    gloss: "understand",
    dueAt: "2026-04-07T10:00:00.000Z",
    createdAt: "2026-04-01T10:00:00.000Z",
  });

  const reviewed = reviewStudyCard(baseCard, "again", "2026-04-07T10:00:00.000Z");

  assert.equal(reviewed.state, "learning");
  assert.equal(reviewed.reps, 0);
  assert.equal(reviewed.intervalDays, 0);
  assert.equal(reviewed.dueAt, "2026-04-07T10:10:00.000Z");
  assert.equal(reviewed.firstReviewedAt, "2026-04-07T10:00:00.000Z");
});

test("summarizeStudyCards counts reviewedToday using local calendar dates", () => {
  const now = new Date(2026, 3, 7, 11, 0, 0);
  const reviewedToday = new Date(2026, 3, 7, 0, 30, 0).toISOString();
  const reviewedYesterday = new Date(2026, 3, 6, 23, 30, 0).toISOString();

  const summary = summarizeStudyCards([
    createChineseCard({
      id: "card-1",
      hanzi: "明白",
      gloss: "understand",
      lastReviewedAt: reviewedToday,
      dueAt: now.toISOString(),
    }),
    createChineseCard({
      id: "card-2",
      hanzi: "结果",
      gloss: "result",
      lastReviewedAt: reviewedYesterday,
      dueAt: now.toISOString(),
    }),
  ], now);

  assert.equal(summary.reviewedToday, 1);
});

test("dueStudyCards caps untouched cards by daily review and new limits", () => {
  const now = "2026-04-08T09:00:00.000Z";
  const items = [];

  for (let index = 0; index < DEFAULT_DAILY_REVIEW_LIMIT + 5; index += 1) {
    items.push(createChineseCard({
      id: `review-${index}`,
      hanzi: `复习${index}`,
      gloss: "review card",
      state: "learning",
      reps: 3,
      intervalDays: 4,
      dueAt: now,
      firstReviewedAt: "2026-04-01T09:00:00.000Z",
    }));
  }

  for (let index = 0; index < DEFAULT_DAILY_NEW_LIMIT + 5; index += 1) {
    items.push(createChineseCard({
      id: `new-${index}`,
      hanzi: `生词${index}`,
      gloss: "new card",
      state: "new",
      dueAt: now,
    }));
  }

  const queue = dueStudyCards(items, now);

  assert.equal(queue.length, DEFAULT_DAILY_REVIEW_LIMIT + DEFAULT_DAILY_NEW_LIMIT);
  assert.ok(queue.every((item, index) => (
    index < DEFAULT_DAILY_REVIEW_LIMIT
      ? item.id.startsWith("review-")
      : item.id.startsWith("new-")
  )));
});

test("dueStudyCards expands the new queue when the daily new limit increases", () => {
  const now = "2026-04-08T09:00:00.000Z";
  const items = [];

  for (let index = 0; index < 24; index += 1) {
    items.push(createChineseCard({
      id: `new-${index}`,
      hanzi: `生词${index}`,
      gloss: "new card",
      state: "new",
      dueAt: now,
    }));
  }

  const limitedQueue = dueStudyCards(items, now, { dailyNewLimit: 20, dailyReviewLimit: 0 });
  const expandedQueue = dueStudyCards(items, now, { dailyNewLimit: 22, dailyReviewLimit: 0 });

  assert.equal(limitedQueue.length, 20);
  assert.equal(expandedQueue.length, 22);
  assert.deepEqual(
    expandedQueue.slice(0, 20).map((item) => item.id),
    limitedQueue.map((item) => item.id),
  );
});

test("dueStudyCards keeps same-day relearning cards visible after limits are reached", () => {
  const now = "2026-04-08T09:00:00.000Z";
  const reviewedToday = "2026-04-08T08:40:00.000Z";
  const items = [
    createChineseCard({
      id: "repeat-today",
      hanzi: "明白",
      gloss: "understand",
      state: "learning",
      reps: 0,
      dueAt: now,
      firstReviewedAt: reviewedToday,
      lastReviewedAt: reviewedToday,
    }),
  ];

  for (let index = 0; index < DEFAULT_DAILY_NEW_LIMIT; index += 1) {
    items.push(createChineseCard({
      id: `new-reviewed-${index}`,
      hanzi: `今日新词${index}`,
      gloss: "new today",
      state: "learning",
      reps: 1,
      dueAt: "2026-04-09T09:00:00.000Z",
      firstReviewedAt: reviewedToday,
      lastReviewedAt: reviewedToday,
    }));
  }

  for (let index = 0; index < DEFAULT_DAILY_REVIEW_LIMIT; index += 1) {
    items.push(createChineseCard({
      id: `reviewed-${index}`,
      hanzi: `旧词${index}`,
      gloss: "reviewed today",
      state: "learning",
      reps: 2,
      intervalDays: 3,
      dueAt: "2026-04-09T09:00:00.000Z",
      firstReviewedAt: "2026-04-01T09:00:00.000Z",
      lastReviewedAt: reviewedToday,
    }));
  }

  const queue = dueStudyCards(items, now);
  const summary = summarizeStudyCards(items, now);

  assert.deepEqual(queue.map((item) => item.id), ["repeat-today"]);
  assert.equal(summary.due, 1);
  assert.equal(summary.backlogDue, 0);
  assert.equal(summary.newSlotsRemaining, 0);
  assert.equal(summary.reviewSlotsRemaining, 0);
});

test("importStudyStateFromJson accepts raw card arrays", () => {
  const imported = importStudyStateFromJson(JSON.stringify([
    {
      hanzi: "难受",
      gloss: "to feel awful",
      pinyin: "nánshòu",
      tags: ["feeling"],
      clips: [{ title: "Drama line" }],
    },
  ]));

  assert.equal(imported.items.length, 1);
  assert.equal(imported.items[0].hanzi, "难受");
  assert.equal(imported.items[0].clips.length, 1);
  assert.equal(formatLocalDateKey(imported.items[0].createdAt).length, 10);
});

test("createStudyClip normalizes media asset metadata for audio clips", () => {
  const clip = createStudyClip({
    id: "clip-1",
    assetId: "asset-1",
    quote: "你明白吗？",
    quotePinyin: "Nǐ míngbai ma?",
    sourceLabel: "Crime drama",
    mediaUrl: "https://cdn.example.com/clips/mingbai.mp3",
    startSeconds: 12,
    durationMs: 1800,
  });

  assert.equal(clip.id, "clip-1");
  assert.equal(clip.assetId, "asset-1");
  assert.equal(clip.transcript, "你明白吗？");
  assert.equal(clip.transcriptPinyin, "Nǐ míngbai ma?");
  assert.equal(clip.sourceTitle, "Crime drama");
  assert.equal(clip.mediaKind, "audio");
  assert.equal(clip.startMs, 12000);
  assert.equal(clip.endMs, 13800);
});

test("buildReadingVariants preserves paired pinyin and gloss lines", () => {
  const card = createChineseCard({
    hanzi: "得",
    pinyin: "dé\nde\nděi",
    gloss: "to obtain\nstructural particle after a verb\nmust; have to",
  });

  assert.deepEqual(buildReadingVariants(card), [
    { pinyin: "dé", gloss: "to obtain" },
    { pinyin: "de", gloss: "structural particle after a verb" },
    { pinyin: "děi", gloss: "must; have to" },
  ]);
});

test("buildReadingVariantsFromDictionaryEntries interleaves entries so alternate readings stay visible", () => {
  const variants = buildReadingVariantsFromDictionaryEntries([
    {
      pinyin: "dé",
      gloss: "to obtain\nto get\nto gain",
    },
    {
      pinyin: "de",
      gloss: "structural particle: used after a verb",
    },
    {
      pinyin: "děi",
      gloss: "must\nhave to",
    },
  ]);

  assert.deepEqual(variants.slice(0, 4), [
    { pinyin: "dé", gloss: "to obtain" },
    { pinyin: "de", gloss: "structural particle: used after a verb" },
    { pinyin: "děi", gloss: "must" },
    { pinyin: "dé", gloss: "to get" },
  ]);

  assert.deepEqual(
    serializeReadingVariants(variants.slice(0, 3)),
    {
      pinyin: "dé\nde\nděi",
      gloss: "to obtain\nstructural particle: used after a verb\nmust",
    },
  );
});

test("normalizePreferences preserves new study audio and text size settings", () => {
  const preferences = normalizePreferences({
    pinyinMode: "always",
    theme: "night",
    audioMode: "manual",
    audioSpeed: "0.5",
    pinyinSize: "xl",
    exampleSize: "lg",
    translationSize: "sm",
    dailyNewLimit: 35,
    dailyReviewLimit: 180,
  });

  assert.deepEqual(preferences, {
    pinyinMode: "always",
    theme: "night",
    audioMode: "manual",
    audioSpeed: "0.5",
    pinyinSize: "xl",
    exampleSize: "lg",
    translationSize: "sm",
    dailyNewLimit: 35,
    dailyReviewLimit: 180,
    lastReadingId: "",
  });
});

test("normalizePreferences accepts flow mode for passive sentence study", () => {
  const preferences = normalizePreferences({
    audioMode: "flow",
  });

  assert.equal(preferences.audioMode, "flow");
});

test("getStudyStats summarizes due buckets and recent activity", () => {
  const now = new Date(2026, 3, 8, 17, 0, 0);
  const items = [
    createChineseCard({
      id: "overdue",
      hanzi: "过",
      gloss: "pass",
      dueAt: new Date(2026, 3, 7, 8, 0, 0).toISOString(),
      lastReviewedAt: new Date(2026, 3, 7, 10, 0, 0).toISOString(),
      firstReviewedAt: new Date(2026, 3, 7, 10, 0, 0).toISOString(),
      intervalDays: 1,
    }),
    createChineseCard({
      id: "today",
      hanzi: "今",
      gloss: "today",
      dueAt: new Date(2026, 3, 8, 18, 0, 0).toISOString(),
      lastReviewedAt: new Date(2026, 3, 8, 8, 30, 0).toISOString(),
      firstReviewedAt: new Date(2026, 3, 8, 8, 30, 0).toISOString(),
      intervalDays: 1,
    }),
    createChineseCard({
      id: "week",
      hanzi: "周",
      gloss: "week",
      dueAt: new Date(2026, 3, 12, 18, 0, 0).toISOString(),
      intervalDays: 5,
    }),
    createChineseCard({
      id: "month",
      hanzi: "月",
      gloss: "month",
      dueAt: new Date(2026, 3, 20, 18, 0, 0).toISOString(),
      intervalDays: 20,
      clips: [{ title: "Word audio", mediaKind: "audio", mediaUrl: "/audio/month.mp3" }],
    }),
  ];

  const stats = getStudyStats(items, now, { dailyNewLimit: 20, dailyReviewLimit: 100 });

  assert.equal(stats.overview.totalCards, 4);
  assert.equal(stats.overview.cardsWithAudio, 1);
  assert.equal(stats.dueBuckets.find((bucket) => bucket.key === "overdue")?.count, 1);
  assert.equal(stats.dueBuckets.find((bucket) => bucket.key === "today")?.count, 1);
  assert.equal(stats.dueBuckets.find((bucket) => bucket.key === "next7")?.count, 1);
  assert.equal(stats.dueBuckets.find((bucket) => bucket.key === "next30")?.count, 1);
  assert.equal(stats.recentActivity.find((day) => day.dateKey === "2026-04-08")?.reviewed, 1);
  assert.equal(stats.recentActivity.find((day) => day.dateKey === "2026-04-07")?.learned, 1);
});
