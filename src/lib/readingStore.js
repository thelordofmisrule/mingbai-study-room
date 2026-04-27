export const DEFAULT_DAILY_REP_LIMIT = 100;

export const READING_DIFFICULTY_LEVELS = [
  { value: "beginner", label: "Beginner", rank: 0 },
  { value: "lower-intermediate", label: "Lower intermediate", rank: 1 },
  { value: "upper-intermediate", label: "Upper intermediate", rank: 2 },
  { value: "advanced", label: "Advanced", rank: 3 },
];

const READING_DIFFICULTY_BY_VALUE = new Map(
  READING_DIFFICULTY_LEVELS.map((entry) => [entry.value, entry]),
);

const SENTENCE_BANK_POSITIONAL_COLUMNS = [
  "sentence",
  "translation",
  "pinyin",
  "tags",
  "topic",
  "note",
];

const SENTENCE_BANK_HEADER_ALIASES = new Map([
  ["sentence", "sentence"],
  ["text", "sentence"],
  ["hanzi", "sentence"],
  ["chinese", "sentence"],
  ["simplified", "sentence"],
  ["translation", "translation"],
  ["english", "translation"],
  ["meaning", "translation"],
  ["gloss", "translation"],
  ["pinyin", "pinyin"],
  ["tags", "tags"],
  ["tag", "tags"],
  ["topic", "topic"],
  ["island", "topic"],
  ["language_island", "topic"],
  ["languageisland", "topic"],
  ["note", "note"],
  ["notes", "note"],
  ["title", "title"],
  ["collection", "title"],
  ["set", "title"],
]);

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix = "reading") {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function slugify(value, fallback = "reading") {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

function normalizeWhitespace(text = "") {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function normalizeTagList(tags = []) {
  if (typeof tags === "string") {
    return normalizeTagList(tags.split(/[,\n;]/u));
  }

  if (!Array.isArray(tags)) return [];

  return [...new Set(
    tags
      .map((tag) => String(tag || "").trim())
      .filter(Boolean),
  )];
}

function normalizeSentenceBankHeader(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^\uFEFF/u, "")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "");
}

function detectSentenceBankDelimiter(rawInput = "", fileName = "") {
  const name = String(fileName || "").trim().toLowerCase();
  if (name.endsWith(".tsv")) return "\t";
  if (name.endsWith(".csv")) return ",";

  const firstLine = String(rawInput || "")
    .replace(/^\uFEFF/u, "")
    .split("\n")
    .find((line) => String(line || "").trim()) || "";
  const commaCount = (firstLine.match(/,/g) || []).length;
  const tabCount = (firstLine.match(/\t/g) || []).length;

  if (!commaCount && !tabCount) return "";
  return tabCount >= commaCount ? "\t" : ",";
}

function parseDelimitedRows(rawInput = "", delimiter = ",") {
  const raw = String(rawInput || "").replace(/^\uFEFF/u, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    const nextChar = raw[index + 1];

    if (inQuotes) {
      if (char === "\"") {
        if (nextChar === "\"") {
          value += "\"";
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        value += char;
      }
      continue;
    }

    if (char === "\"") {
      inQuotes = true;
      continue;
    }

    if (char === delimiter) {
      row.push(value);
      value = "";
      continue;
    }

    if (char === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
      continue;
    }

    value += char;
  }

  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }

  return rows
    .map((entry) => entry.map((cell) => String(cell || "").trim()))
    .filter((entry) => entry.some((cell) => cell));
}

function parseSentenceBankRows(rawInput = "", options = {}) {
  const raw = String(rawInput || "").replace(/^\uFEFF/u, "");
  const delimiter = detectSentenceBankDelimiter(raw, options.fileName);

  if (!delimiter) {
    return raw
      .split("\n")
      .map((line) => String(line || "").trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((sentence) => ({ sentence }));
  }

  const rows = parseDelimitedRows(raw, delimiter);
  if (!rows.length) return [];

  const normalizedHeader = rows[0].map(normalizeSentenceBankHeader);
  const recognizedHeaderCount = normalizedHeader.filter((header) => SENTENCE_BANK_HEADER_ALIASES.has(header)).length;
  const hasHeader = recognizedHeaderCount >= 2 || normalizedHeader.includes("sentence") || normalizedHeader.includes("text");

  const columnMap = new Map();

  if (hasHeader) {
    normalizedHeader.forEach((header, index) => {
      const column = SENTENCE_BANK_HEADER_ALIASES.get(header);
      if (column && !columnMap.has(column)) {
        columnMap.set(column, index);
      }
    });
  } else {
    SENTENCE_BANK_POSITIONAL_COLUMNS.forEach((column, index) => {
      columnMap.set(column, index);
    });
  }

  const dataRows = hasHeader ? rows.slice(1) : rows;
  return dataRows
    .map((row) => ({
      sentence: row[columnMap.get("sentence") ?? 0] || "",
      translation: row[columnMap.get("translation") ?? 1] || "",
      pinyin: row[columnMap.get("pinyin") ?? 2] || "",
      tags: row[columnMap.get("tags") ?? 3] || "",
      topic: row[columnMap.get("topic") ?? 4] || "",
      note: row[columnMap.get("note") ?? 5] || "",
      title: row[columnMap.get("title") ?? 6] || "",
    }))
    .filter((row) => row.sentence);
}

function countHanzi(text = "") {
  return [...String(text || "").matchAll(/\p{Script=Han}/gu)].length;
}

function average(values = []) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function addMinutes(iso, minutes) {
  const next = new Date(iso || Date.now());
  next.setMinutes(next.getMinutes() + minutes);
  return next.toISOString();
}

function addDays(iso, days) {
  const next = new Date(iso || Date.now());
  next.setDate(next.getDate() + days);
  return next.toISOString();
}

function dateKeyMatches(dateLike, todayKey) {
  return !!dateLike && formatLocalDateKey(dateLike) === todayKey;
}

function compareSentenceQueue(left, right) {
  return new Date(left.dueAt || 0).getTime() - new Date(right.dueAt || 0).getTime()
    || new Date(left.lastReviewedAt || 0).getTime() - new Date(right.lastReviewedAt || 0).getTime()
    || new Date(left.createdAt || 0).getTime() - new Date(right.createdAt || 0).getTime()
    || Number(left.readingOrder || 0) - Number(right.readingOrder || 0)
    || Number(left.position || 0) - Number(right.position || 0);
}

export function formatLocalDateKey(dateLike = new Date()) {
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function readingTagFromSlug(slug = "") {
  return `reading:${slugify(slug, "reading")}`;
}

export function topicSlugFromName(topic = "") {
  return slugify(topic, "general");
}

export function normalizeTopicName(topic = "", fallback = "General") {
  return String(topic || "").trim() || fallback;
}

export function difficultyTagFromLevel(level = "") {
  const normalized = String(level || "").trim().toLowerCase();
  return READING_DIFFICULTY_BY_VALUE.has(normalized) ? `difficulty:${normalized}` : "";
}

export function readingDifficultyFromTag(tag = "") {
  const raw = String(tag || "").trim().toLowerCase();
  if (!raw.startsWith("difficulty:")) return "";
  const level = raw.slice("difficulty:".length);
  return READING_DIFFICULTY_BY_VALUE.has(level) ? level : "";
}

export function stripDifficultyTags(tags = []) {
  return Array.isArray(tags)
    ? tags.filter((tag) => !readingDifficultyFromTag(tag))
    : [];
}

export function generatedReadingSentenceAudioAssetId(readingId, sentenceId, provider = "azure") {
  return `${String(provider || "azure")}-reading-sentence-audio-asset-${String(readingId || "")}-${String(sentenceId || "")}`;
}

export function splitChineseTextIntoSentences(text = "") {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return [];

  const segments = [];
  let buffer = "";

  const pushBuffer = () => {
    const next = normalizeWhitespace(buffer);
    if (next) segments.push(next);
    buffer = "";
  };

  for (const char of normalized) {
    buffer += char;
    if ("。！？!?；;…".includes(char)) {
      pushBuffer();
    } else if (char === "\n") {
      pushBuffer();
    }
  }

  pushBuffer();
  return segments;
}

export function assessSentenceDifficulty(text = "") {
  const normalized = normalizeWhitespace(text);
  const hanziCount = countHanzi(normalized);

  if (!hanziCount) {
    return {
      level: "beginner",
      label: READING_DIFFICULTY_BY_VALUE.get("beginner")?.label || "Beginner",
      score: 0,
    };
  }

  const commaCount = [...normalized.matchAll(/[，、,；;：:]/g)].length;
  const clauseCount = 1 + commaCount;
  const uniqueHanzi = new Set([...normalized.matchAll(/\p{Script=Han}/gu)].map((match) => match[0])).size;
  const score = hanziCount + (commaCount * 3) + (uniqueHanzi / 10) + ((clauseCount - 1) * 2);

  let level = "advanced";
  if (score < 10) level = "beginner";
  else if (score < 18) level = "lower-intermediate";
  else if (score < 28) level = "upper-intermediate";

  return {
    level,
    label: READING_DIFFICULTY_BY_VALUE.get(level)?.label || "Advanced",
    score: Number(score.toFixed(1)),
  };
}

export function createReadingSentence(sentence = {}) {
  const createdAt = String(sentence.createdAt || nowIso());
  const difficulty = assessSentenceDifficulty(sentence.text);
  return {
    id: String(sentence.id || makeId("sentence")),
    position: Math.max(0, Number(sentence.position) || 0),
    text: normalizeWhitespace(sentence.text),
    pinyin: normalizeWhitespace(sentence.pinyin),
    translation: normalizeWhitespace(sentence.translation),
    note: normalizeWhitespace(sentence.note),
    tags: normalizeTagList(sentence.tags),
    assetId: String(sentence.assetId || "").trim(),
    mediaKind: String(sentence.mediaKind || "").trim(),
    storageProvider: String(sentence.storageProvider || "").trim(),
    storageKey: String(sentence.storageKey || "").trim(),
    mimeType: String(sentence.mimeType || "").trim(),
    mediaUrl: String(sentence.mediaUrl || "").trim(),
    sourceUrl: String(sentence.sourceUrl || "").trim(),
    sourceTitle: String(sentence.sourceTitle || "").trim(),
    durationMs: Math.max(0, Number(sentence.durationMs) || 0),
    startMs: Math.max(0, Number(sentence.startMs) || 0),
    endMs: Math.max(0, Number(sentence.endMs) || 0),
    ease: Math.max(1.3, Number(sentence.ease) || 2.35),
    intervalDays: Math.max(0, Number(sentence.intervalDays) || 0),
    reps: Math.max(0, Number(sentence.reps) || 0),
    totalReviewCount: Math.max(0, Number(sentence.totalReviewCount) || 0),
    dueAt: String(sentence.dueAt || createdAt),
    firstReviewedAt: sentence.firstReviewedAt ? String(sentence.firstReviewedAt) : "",
    lastReviewedAt: sentence.lastReviewedAt ? String(sentence.lastReviewedAt) : "",
    state: String(sentence.state || "new"),
    difficultyLevel: difficulty.level,
    difficultyLabel: difficulty.label,
    difficultyScore: difficulty.score,
    createdAt,
    updatedAt: String(sentence.updatedAt || createdAt),
  };
}

export function assessReadingDifficulty(readingOrText = {}) {
  const body = typeof readingOrText === "string"
    ? readingOrText
    : String(readingOrText?.body || "");
  const sentences = Array.isArray(readingOrText?.sentences) && readingOrText.sentences.length
    ? readingOrText.sentences.map((sentence) => String(sentence?.text || "").trim()).filter(Boolean)
    : splitChineseTextIntoSentences(body);
  const normalizedBody = normalizeWhitespace(body);
  const hanziChars = [...normalizedBody.matchAll(/\p{Script=Han}/gu)].map((match) => match[0]);
  const totalHanzi = hanziChars.length;

  if (!totalHanzi || !sentences.length) {
    return null;
  }

  const uniqueHanzi = new Set(hanziChars).size;
  const sentenceLengths = sentences.map((sentence) => countHanzi(sentence)).filter((count) => count > 0);
  const sentenceCount = sentenceLengths.length || 1;
  const avgSentenceLength = average(sentenceLengths);
  const commaCount = [...normalizedBody.matchAll(/[，、,；;：:]/g)].length;
  const longSentenceRatio = sentenceLengths.filter((count) => count >= 22).length / sentenceCount;
  const score = avgSentenceLength
    + (uniqueHanzi / 25)
    + ((commaCount / sentenceCount) * 4)
    + (longSentenceRatio * 6);

  let level = "advanced";
  if (score < 10) level = "beginner";
  else if (score < 17) level = "lower-intermediate";
  else if (score < 24) level = "upper-intermediate";

  return {
    level,
    label: READING_DIFFICULTY_BY_VALUE.get(level)?.label || "Advanced",
    tag: difficultyTagFromLevel(level),
    score: Number(score.toFixed(1)),
    stats: {
      totalHanzi,
      uniqueHanzi,
      sentenceCount,
      avgSentenceLength: Number(avgSentenceLength.toFixed(1)),
      commaCount,
      longSentenceRatio: Number(longSentenceRatio.toFixed(2)),
    },
  };
}

export function createReading(reading = {}) {
  const createdAt = String(reading.createdAt || nowIso());
  const title = String(reading.title || "").trim();
  const id = String(reading.id || makeId("reading"));
  const slug = String(reading.slug || slugify(title || id, "reading")).trim();
  const topic = normalizeTopicName(reading.topic, "General");
  const body = String(reading.body || "");
  const baseSentences = Array.isArray(reading.sentences)
    ? reading.sentences
    : splitChineseTextIntoSentences(body).map((text, index) => ({
        id: `${slug}-sentence-${index + 1}`,
        position: index,
        text,
      }));
  const difficulty = assessReadingDifficulty({
    body,
    sentences: baseSentences,
  });
  const manualTags = Array.isArray(reading.tags)
    ? [...new Set(reading.tags.map((tag) => String(tag || "").trim()).filter(Boolean))]
    : [];
  const tags = difficulty?.tag
    ? [...new Set([...stripDifficultyTags(manualTags), difficulty.tag])]
    : stripDifficultyTags(manualTags);

  return {
    id,
    slug,
    title,
    topic,
    topicSlug: topicSlugFromName(topic),
    coverImageUrl: String(reading.coverImageUrl || "").trim(),
    body,
    notes: normalizeWhitespace(reading.notes),
    tags,
    difficultyLevel: difficulty?.level || "",
    difficultyLabel: difficulty?.label || "",
    difficultyScore: difficulty?.score || 0,
    sentences: baseSentences
      .map(createReadingSentence)
      .filter((sentence) => sentence.text)
      .sort((left, right) => left.position - right.position),
    createdAt,
    updatedAt: String(reading.updatedAt || createdAt),
  };
}

export function createEmptyReading() {
  return createReading({
    id: makeId("reading"),
    title: "",
    topic: "General",
    coverImageUrl: "",
    body: "",
    notes: "",
    tags: [],
    sentences: [],
  });
}

export function normalizeReadingLibrary(readings = []) {
  return Array.isArray(readings) ? readings.map(createReading) : [];
}

export function preserveReadingSentenceData(previousReading, nextReading) {
  const previousByText = new Map(
    (previousReading?.sentences || []).map((sentence) => [sentence.text, createReadingSentence(sentence)]),
  );

  return createReading({
    ...nextReading,
    sentences: (nextReading?.sentences || []).map((sentence) => {
      const existing = previousByText.get(sentence.text);
      if (!existing) return sentence;
      return {
        ...sentence,
        pinyin: existing.pinyin || sentence.pinyin,
        translation: existing.translation || sentence.translation,
        note: existing.note || sentence.note,
        tags: existing.tags?.length ? existing.tags : sentence.tags,
        assetId: existing.assetId || sentence.assetId,
        mediaKind: existing.mediaKind || sentence.mediaKind,
        storageProvider: existing.storageProvider || sentence.storageProvider,
        storageKey: existing.storageKey || sentence.storageKey,
        mimeType: existing.mimeType || sentence.mimeType,
        mediaUrl: existing.mediaUrl || sentence.mediaUrl,
        sourceUrl: existing.sourceUrl || sentence.sourceUrl,
        sourceTitle: existing.sourceTitle || sentence.sourceTitle,
        durationMs: existing.durationMs || sentence.durationMs,
        startMs: existing.startMs || sentence.startMs,
        endMs: existing.endMs || sentence.endMs,
        ease: existing.ease || sentence.ease,
        intervalDays: existing.intervalDays || sentence.intervalDays,
        reps: existing.reps || sentence.reps,
        totalReviewCount: existing.totalReviewCount || sentence.totalReviewCount,
        dueAt: existing.dueAt || sentence.dueAt,
        firstReviewedAt: existing.firstReviewedAt || sentence.firstReviewedAt,
        lastReviewedAt: existing.lastReviewedAt || sentence.lastReviewedAt,
        state: existing.state || sentence.state,
        createdAt: existing.createdAt || sentence.createdAt,
      };
    }),
  });
}

export function flattenReadingSentences(readings = []) {
  return normalizeReadingLibrary(readings).flatMap((reading, readingOrder) => (
    reading.sentences.map((sentence) => ({
      ...createReadingSentence(sentence),
      readingId: reading.id,
      readingOrder,
      readingSlug: reading.slug,
      readingTitle: reading.title,
      topic: reading.topic,
      topicSlug: reading.topicSlug,
      tags: [...(sentence.tags || [])],
      coverImageUrl: reading.coverImageUrl,
      readingDifficultyLabel: reading.difficultyLabel,
    }))
  ));
}

export function sortReadingSentencesByDifficulty(sentences = []) {
  return [...(Array.isArray(sentences) ? sentences : [])]
    .map((sentence, index) => ({
      ...createReadingSentence(sentence),
      originalIndex: index,
    }))
    .sort((left, right) => (
      Number(left.difficultyScore || 0) - Number(right.difficultyScore || 0)
      || READING_DIFFICULTY_BY_VALUE.get(left.difficultyLevel || "advanced")?.rank - READING_DIFFICULTY_BY_VALUE.get(right.difficultyLevel || "advanced")?.rank
      || left.originalIndex - right.originalIndex
    ))
    .map(({ originalIndex, ...sentence }, index) => ({
      ...sentence,
      position: index,
    }));
}

export function createSentenceBankReadings(rawInput = "", options = {}) {
  const rows = parseSentenceBankRows(rawInput, options);
  const defaultTopic = normalizeTopicName(options.topic, "General");
  const defaultTags = normalizeTagList(options.tags);
  const baseTitle = String(options.title || "").trim() || "Sentence bank";
  const baseNotes = normalizeWhitespace(options.notes);
  const coverImageUrl = String(options.coverImageUrl || "").trim();
  const groups = new Map();

  rows.forEach((row, lineIndex) => {
    const text = String(row.sentence || "").trim();
    const translation = String(row.translation || "").trim();
    const pinyin = String(row.pinyin || "").trim();
    const rowTags = row.tags;
    const rowTopic = row.topic;
    const rowTitle = String(row.title || "").trim() || baseTitle;
    const note = String(row.note || "").trim();

    if (!text) return;

    const topic = normalizeTopicName(rowTopic || defaultTopic, "General");
    const key = `${slugify(rowTitle, "sentence-bank")}::${topicSlugFromName(topic)}`;
    const group = groups.get(key) || {
      title: rowTitle,
      topic,
      sentences: [],
    };

    group.sentences.push({
      text,
      translation,
      pinyin,
      note,
      tags: normalizeTagList([...defaultTags, ...normalizeTagList(rowTags)]),
      originalIndex: lineIndex,
    });
    groups.set(key, group);
  });

  const orderedGroups = [...groups.values()];

  return orderedGroups.map((group, groupIndex) => {
    const sortedSentences = sortReadingSentencesByDifficulty(
      group.sentences.map(({ originalIndex, ...sentence }) => sentence),
    );
    const hasSiblingWithSameTitle = orderedGroups.filter((entry) => entry.title === group.title).length > 1;
    const title = hasSiblingWithSameTitle ? `${group.title} · ${group.topic}` : group.title;

    return createReading({
      title,
      topic: group.topic,
      coverImageUrl,
      notes: baseNotes,
      body: sortedSentences.map((sentence) => sentence.text).join("\n"),
      tags: normalizeTagList([...defaultTags, `bank:${slugify(baseTitle, "sentence-bank")}`]),
      sentences: sortedSentences.map((sentence, sentenceIndex) => ({
        ...sentence,
        position: sentenceIndex,
      })),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      slug: orderedGroups.length > 1
        ? slugify(`${baseTitle}-${groupIndex + 1}-${group.topic}`, "sentence-bank")
        : slugify(baseTitle, "sentence-bank"),
    });
  });
}

export function dueSentenceUnits(readings = [], currentTime = new Date(), options = {}) {
  const now = new Date(currentTime);
  const todayKey = formatLocalDateKey(now);
  const dailySentenceLimit = Math.max(
    0,
    Number(options.dailySentenceLimit ?? options.dailyReviewLimit ?? DEFAULT_DAILY_REP_LIMIT) || DEFAULT_DAILY_REP_LIMIT,
  );
  const topicSlug = String(options.topicSlug || "").trim().toLowerCase();

  const dueItems = flattenReadingSentences(readings)
    .filter((sentence) => (!topicSlug || sentence.topicSlug === topicSlug))
    .filter((sentence) => new Date(sentence.dueAt || 0) <= now)
    .sort(compareSentenceQueue);

  const activeTodayDue = dueItems.filter((sentence) => dateKeyMatches(sentence.lastReviewedAt, todayKey));
  const untouchedDue = dueItems.filter((sentence) => !dateKeyMatches(sentence.lastReviewedAt, todayKey));
  const queue = [...activeTodayDue, ...untouchedDue].slice(0, dailySentenceLimit);

  return {
    queue,
    stats: {
      actualDue: dueItems.length,
      backlogDue: Math.max(0, dueItems.length - queue.length),
      dailySentenceLimit,
      reviewedTodayInQueue: activeTodayDue.length,
    },
  };
}

export function getSentenceStudyStats(readings = [], currentTime = new Date(), options = {}) {
  const allReadings = normalizeReadingLibrary(readings);
  const queue = dueSentenceUnits(allReadings, currentTime, options);
  const allSentences = flattenReadingSentences(allReadings);
  const topicSet = new Set(allReadings.map((reading) => reading.topicSlug).filter(Boolean));
  const todayKey = formatLocalDateKey(currentTime);

  const reviewedToday = allSentences.filter((sentence) => dateKeyMatches(sentence.lastReviewedAt, todayKey)).length;
  const audioReady = allSentences.filter((sentence) => sentence.mediaUrl).length;
  const mastered = allSentences.filter((sentence) => sentence.state === "mature" || sentence.intervalDays >= 21).length;
  const totalReviewCount = allSentences.reduce((sum, sentence) => sum + Math.max(0, Number(sentence.totalReviewCount) || 0), 0);

  return {
    summary: {
      totalTexts: allReadings.length,
      totalSentences: allSentences.length,
      totalTopics: topicSet.size,
      dueNow: queue.queue.length,
      actualDue: queue.stats.actualDue,
      backlogDue: queue.stats.backlogDue,
      reviewedToday,
      totalReviewCount,
      audioReady,
      mastered,
      dailySentenceLimit: queue.stats.dailySentenceLimit,
    },
    queue: queue.queue,
  };
}

export function reviewReadingSentence(sentence, rating, currentTime = new Date()) {
  const item = createReadingSentence(sentence);
  const now = new Date(currentTime).toISOString();
  const next = {
    ...item,
    firstReviewedAt: item.firstReviewedAt || now,
    lastReviewedAt: now,
    updatedAt: now,
    totalReviewCount: item.totalReviewCount + 1,
  };

  if (rating === "again") {
    next.state = "learning";
    next.reps = 0;
    next.intervalDays = 0;
    next.ease = Math.max(1.3, next.ease - 0.2);
    next.dueAt = addMinutes(now, 10);
    return next;
  }

  if (rating === "easy") {
    const nextInterval = next.intervalDays > 0
      ? Math.max(4, Math.round((next.intervalDays * (next.ease + 0.45)) + 2))
      : 4;
    next.state = nextInterval >= 21 ? "mature" : "learning";
    next.reps += 1;
    next.intervalDays = nextInterval;
    next.ease = Math.min(3.1, next.ease + 0.08);
    next.dueAt = addDays(now, nextInterval);
    return next;
  }

  const nextInterval = next.intervalDays <= 0
    ? 1
    : next.intervalDays === 1
      ? 3
      : Math.max(2, Math.round(next.intervalDays * Math.max(1.7, next.ease)));
  next.state = nextInterval >= 21 ? "mature" : "learning";
  next.reps += 1;
  next.intervalDays = nextInterval;
  next.ease = Math.min(3, next.ease + 0.03);
  next.dueAt = addDays(now, nextInterval);
  return next;
}
