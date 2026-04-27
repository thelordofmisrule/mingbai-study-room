const SEEDED_ITEMS = [
  {
    hanzi: "结果",
    pinyin: "jiéguǒ",
    gloss: "result; in the end",
    notes: "Useful both as a noun and as a discourse marker when someone is telling a story.",
    example: "我本来想早点回家，结果又加班到十一点。",
    examplePinyin: "Wǒ běnlái xiǎng zǎodiǎn huí jiā, jiéguǒ yòu jiābān dào shíyī diǎn.",
    exampleTranslation: "I meant to get home early, but I ended up working overtime until eleven.",
    clips: [
      {
        title: "Office drama clip",
        transcript: "结果老板突然说，今晚谁都别走。",
        transcriptPinyin: "Jiéguǒ lǎobǎn tūrán shuō, jīnwǎn shéi dōu bié zǒu.",
        sourceTitle: "Workplace series",
        note: "Narrative pivot: the speaker sets up one expectation and then reverses it with 结果.",
      },
      {
        title: "Rom-com argument",
        transcript: "我等了你半天，结果你根本没来。",
        transcriptPinyin: "Wǒ děng le nǐ bàntiān, jiéguǒ nǐ gēnběn méi lái.",
        sourceTitle: "Romantic comedy",
        note: "Often carries disappointment or frustration.",
      },
    ],
  },
  {
    hanzi: "明白",
    pinyin: "míngbai",
    gloss: "to understand; clear",
    notes: "Very high-frequency and more colloquial than 理解 in many situations.",
    example: "你先别急，我明白你的意思。",
    examplePinyin: "Nǐ xiān bié jí, wǒ míngbai nǐ de yìsi.",
    exampleTranslation: "Don't rush; I understand what you mean.",
    clips: [
      {
        title: "Police interrogation",
        transcript: "你明白我现在在问什么吗？",
        transcriptPinyin: "Nǐ míngbai wǒ xiànzài zài wèn shénme ma?",
        sourceTitle: "Crime drama",
        note: "Used to check understanding or establish seriousness.",
      },
    ],
  },
  {
    hanzi: "难受",
    pinyin: "nánshòu",
    gloss: "to feel awful; uncomfortable; distressed",
    notes: "Can be physical or emotional. A good word to learn through tone and context.",
    example: "听到这个消息以后，她心里特别难受。",
    examplePinyin: "Tīng dào zhège xiāoxi yǐhòu, tā xīnlǐ tèbié nánshòu.",
    exampleTranslation: "After hearing the news, she felt terrible.",
    clips: [
      {
        title: "Hospital scene",
        transcript: "我有点难受，想先躺一会儿。",
        transcriptPinyin: "Wǒ yǒudiǎn nánshòu, xiǎng xiān tǎng yíhuìr.",
        sourceTitle: "Family drama",
        note: "Physical discomfort reading.",
      },
      {
        title: "Breakup aftermath",
        transcript: "你这样说，我真的很难受。",
        transcriptPinyin: "Nǐ zhèyàng shuō, wǒ zhēnde hěn nánshòu.",
        sourceTitle: "Urban drama",
        note: "Emotional hurt reading.",
      },
    ],
  },
];

const AUDIO_EXTENSIONS = /\.(mp3|m4a|aac|wav|oga|opus|flac)(\?|#|$)/i;
const VIDEO_EXTENSIONS = /\.(mp4|webm|m4v|mov)(\?|#|$)/i;
export const DEFAULT_DAILY_NEW_LIMIT = 20;
export const DEFAULT_DAILY_REVIEW_LIMIT = 100;
export const AUDIO_MODE_OPTIONS = [
  { value: "off", label: "Off", note: "Hide audio in study mode" },
  { value: "manual", label: "Manual", note: "Show a play button only" },
  { value: "autoplay", label: "Autoplay", note: "Play audio when you reveal" },
  { value: "flow", label: "Flow", note: "Play audio twice and advance automatically" },
];
export const AUDIO_SPEED_OPTIONS = [
  { value: "1", label: "1x", note: "Normal speed" },
  { value: "0.75", label: "0.75x", note: "A little slower" },
  { value: "0.5", label: "0.5x", note: "Half speed" },
];
export const TEXT_SIZE_OPTIONS = [
  { value: "sm", label: "S", note: "Smaller" },
  { value: "md", label: "M", note: "Medium" },
  { value: "lg", label: "L", note: "Larger" },
  { value: "xl", label: "XL", note: "Largest" },
];

export function splitGlossSections(raw = "") {
  const normalized = String(raw || "").trim();
  if (!normalized) return [];

  const hasExplicitLines = /\n/.test(normalized);
  const parts = normalized
    .split(hasExplicitLines ? /\n+/g : /[;；•]+/g)
    .map((part) => part.trim())
    .filter(Boolean);
  return [...new Set(parts)];
}

export function splitPinyinSections(raw = "") {
  const normalized = String(raw || "").trim();
  if (!normalized) return [];

  return [...new Set(
    normalized
      .split(/\n+/g)
      .map((part) => part.trim())
      .filter(Boolean),
  )];
}

export function buildReadingVariants(card = {}) {
  const pinyinParts = splitPinyinSections(card?.pinyin || "");
  const glossParts = splitGlossSections(card?.gloss || "");
  const variantCount = Math.max(pinyinParts.length, glossParts.length);

  if (!variantCount) return [];

  const variants = [];
  for (let index = 0; index < variantCount; index += 1) {
    const pinyin = pinyinParts.length <= 1
      ? (pinyinParts[0] || "")
      : (pinyinParts[index] || pinyinParts[pinyinParts.length - 1] || "");
    const gloss = glossParts[index] || "";
    if (!pinyin && !gloss) continue;
    const key = `${pinyin}|||${gloss}`;
    if (variants.some((entry) => `${entry.pinyin}|||${entry.gloss}` === key)) continue;
    variants.push({ pinyin, gloss });
  }

  return variants;
}

export function serializeReadingVariants(variants = []) {
  const normalized = [];

  for (const entry of variants) {
    const pinyin = String(entry?.pinyin || "").trim();
    const gloss = String(entry?.gloss || "").trim();
    if (!pinyin && !gloss) continue;
    const key = `${pinyin}|||${gloss}`;
    if (normalized.some((item) => `${item.pinyin}|||${item.gloss}` === key)) continue;
    normalized.push({ pinyin, gloss });
  }

  return {
    pinyin: normalized.map((entry) => entry.pinyin).join("\n").trim(),
    gloss: normalized.map((entry) => entry.gloss).join("\n").trim(),
  };
}

export function buildReadingVariantsFromDictionaryEntries(entries = [], { entryLimit = 4, variantLimit = 6 } = {}) {
  const sources = entries
    .slice(0, Math.max(1, entryLimit))
    .map((entry) => {
      const pinyin = String(entry?.pinyin || "").trim();
      const glosses = splitGlossSections(entry?.gloss || "");
      const sourceGlosses = glosses.length
        ? glosses
        : [String(entry?.gloss || "").trim()].filter(Boolean);
      return {
        pinyin,
        glosses: sourceGlosses,
      };
    })
    .filter((entry) => entry.pinyin || entry.glosses.length);

  const variants = [];
  const seen = new Set();
  const maxGlossDepth = Math.max(0, ...sources.map((entry) => entry.glosses.length));

  for (let glossIndex = 0; glossIndex < maxGlossDepth; glossIndex += 1) {
    let addedInPass = false;

    for (const entry of sources) {
      const gloss = String(entry.glosses[glossIndex] || "").trim();
      if (!gloss) continue;

      const key = `${entry.pinyin}|||${gloss}`;
      if (seen.has(key)) continue;

      seen.add(key);
      variants.push({ pinyin: entry.pinyin, gloss });
      addedInPass = true;

      if (variants.length >= variantLimit) {
        return variants;
      }
    }

    if (!addedInPass) break;
  }

  return variants;
}

export function generatedHeadwordAudioUsageId(cardId, provider = "azure") {
  return `${String(provider || "azure")}-headword-audio-${String(cardId || "")}`;
}

export function generatedHeadwordAudioAssetId(cardId, provider = "azure") {
  return `${String(provider || "azure")}-headword-audio-asset-${String(cardId || "")}`;
}

export function generatedExampleAudioUsageId(cardId, provider = "azure") {
  return `${String(provider || "azure")}-example-audio-${String(cardId || "")}`;
}

export function generatedExampleAudioAssetId(cardId, provider = "azure") {
  return `${String(provider || "azure")}-example-audio-asset-${String(cardId || "")}`;
}

function makeId(prefix = "card") {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso() {
  return new Date().toISOString();
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

function toNonNegativeInteger(value, fallback = 0) {
  const next = Number(value);
  if (!Number.isFinite(next) || next < 0) return fallback;
  return Math.round(next);
}

function normalizeStudyLimit(value, fallback, max = 999) {
  const next = Number(value);
  if (!Number.isFinite(next) || next < 0) return fallback;
  return Math.min(max, Math.round(next));
}

function startOfLocalDay(dateLike = new Date()) {
  const date = new Date(dateLike);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addLocalDays(dateLike = new Date(), days = 0) {
  const date = startOfLocalDay(dateLike);
  date.setDate(date.getDate() + Number(days || 0));
  return date;
}

function average(values = []) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function inferMediaKind(url = "", mimeType = "") {
  const safeUrl = String(url || "").trim();
  const safeMimeType = String(mimeType || "").trim().toLowerCase();

  if (safeMimeType.startsWith("audio/")) return "audio";
  if (safeMimeType.startsWith("video/")) return "video";
  if (AUDIO_EXTENSIONS.test(safeUrl)) return "audio";
  if (VIDEO_EXTENSIONS.test(safeUrl)) return "video";
  return safeUrl ? "external" : "";
}

function normalizeMediaKind(mediaKind = "", mediaUrl = "", mimeType = "") {
  const nextKind = String(mediaKind || "").trim().toLowerCase();
  if (["audio", "video", "external"].includes(nextKind)) {
    return nextKind;
  }
  return inferMediaKind(mediaUrl, mimeType);
}

export function createStudyClip(clip = {}) {
  const transcript = String(clip.transcript ?? clip.quote ?? "").trim();
  const transcriptPinyin = String(clip.transcriptPinyin ?? clip.quotePinyin ?? "").trim();
  const translation = String(clip.translation || "").trim();
  const sourceTitle = String(clip.sourceTitle ?? clip.sourceLabel ?? "").trim();
  const mediaUrl = String(clip.mediaUrl || "").trim();
  const sourceUrl = String(clip.sourceUrl || "").trim();
  const mimeType = String(clip.mimeType || "").trim();
  const startMs = clip.startMs !== undefined
    ? toNonNegativeInteger(clip.startMs)
    : toNonNegativeInteger(Number(clip.startSeconds || 0) * 1000);
  const explicitEndMs = clip.endMs !== undefined ? toNonNegativeInteger(clip.endMs) : 0;
  const durationMs = clip.durationMs !== undefined
    ? toNonNegativeInteger(clip.durationMs)
    : explicitEndMs > startMs
      ? explicitEndMs - startMs
      : 0;
  const endMs = explicitEndMs || (durationMs > 0 ? startMs + durationMs : 0);
  const mediaKind = normalizeMediaKind(clip.mediaKind, mediaUrl, mimeType);

  return {
    id: String(clip.id || makeId("clip")),
    assetId: String(clip.assetId || clip.mediaAssetId || makeId("asset")),
    title: String(clip.title || "").trim(),
    transcript,
    transcriptPinyin,
    translation,
    note: String(clip.note || "").trim(),
    sourceTitle,
    mediaKind,
    storageProvider: String(clip.storageProvider || "").trim(),
    storageKey: String(clip.storageKey || "").trim(),
    mimeType,
    mediaUrl,
    sourceUrl,
    durationMs,
    startMs,
    endMs,
    quote: transcript,
    quotePinyin: transcriptPinyin,
    sourceLabel: sourceTitle,
    startSeconds: Math.floor(startMs / 1000),
    endSeconds: endMs > 0 ? Math.floor(endMs / 1000) : 0,
  };
}

export function normalizePreferences(preferences = {}) {
  const pinyinMode = String(preferences?.pinyinMode || "reveal");
  const theme = String(preferences?.theme || "day");
  const audioMode = String(preferences?.audioMode || "autoplay");
  const audioSpeed = String(preferences?.audioSpeed || "1");
  const pinyinSize = String(preferences?.pinyinSize || "lg");
  const exampleSize = String(preferences?.exampleSize || "md");
  const translationSize = String(preferences?.translationSize || "md");
  const dailyNewLimit = normalizeStudyLimit(preferences?.dailyNewLimit, DEFAULT_DAILY_NEW_LIMIT, 500);
  const dailyReviewLimit = normalizeStudyLimit(preferences?.dailyReviewLimit, DEFAULT_DAILY_REVIEW_LIMIT, 999);
  const lastReadingId = String(preferences?.lastReadingId || "").trim();
  return {
    pinyinMode: ["hidden", "reveal", "always"].includes(pinyinMode) ? pinyinMode : "reveal",
    theme: ["day", "night"].includes(theme) ? theme : "day",
    audioMode: ["off", "manual", "autoplay", "flow"].includes(audioMode) ? audioMode : "autoplay",
    audioSpeed: ["1", "0.75", "0.5"].includes(audioSpeed) ? audioSpeed : "1",
    pinyinSize: ["sm", "md", "lg", "xl"].includes(pinyinSize) ? pinyinSize : "lg",
    exampleSize: ["sm", "md", "lg", "xl"].includes(exampleSize) ? exampleSize : "md",
    translationSize: ["sm", "md", "lg", "xl"].includes(translationSize) ? translationSize : "md",
    dailyNewLimit,
    dailyReviewLimit,
    lastReadingId,
  };
}

export function createChineseCard(card = {}) {
  const createdAt = String(card.createdAt || nowIso());
  // pinyin/gloss strings are the canonical serialized form. Derive readings
  // from them whenever they have content, so edits to pinyin/gloss (including
  // reordering meanings via the editor) aren't overridden by a stale readings
  // array. Only fall back to an explicit readings array when both pinyin and
  // gloss are empty.
  const variantsFromStrings = buildReadingVariants(card);
  const readingVariants = variantsFromStrings.length
    ? variantsFromStrings
    : (Array.isArray(card.readings) ? card.readings : []);
  const serializedReadings = serializeReadingVariants(readingVariants);
  return {
    id: String(card.id || makeId("hanzi")),
    hanzi: String(card.hanzi || "").trim(),
    pinyin: serializedReadings.pinyin || String(card.pinyin || "").trim(),
    gloss: serializedReadings.gloss || String(card.gloss || "").trim(),
    readings: readingVariants,
    notes: String(card.notes || "").trim(),
    example: String(card.example || "").trim(),
    examplePinyin: String(card.examplePinyin || "").trim(),
    exampleTranslation: String(card.exampleTranslation || "").trim(),
    tags: Array.isArray(card.tags)
      ? [...new Set(card.tags.map((tag) => String(tag || "").trim()).filter(Boolean))]
      : [],
    clips: Array.isArray(card.clips) ? card.clips.map(createStudyClip) : [],
    ease: Math.max(1.3, Number(card.ease) || 2.35),
    intervalDays: Math.max(0, Number(card.intervalDays) || 0),
    reps: Math.max(0, Number(card.reps) || 0),
    dueAt: String(card.dueAt || createdAt),
    firstReviewedAt: card.firstReviewedAt ? String(card.firstReviewedAt) : "",
    lastReviewedAt: card.lastReviewedAt ? String(card.lastReviewedAt) : "",
    state: String(card.state || "new"),
    createdAt,
    updatedAt: String(card.updatedAt || createdAt),
  };
}

export function createEmptyChineseCard() {
  return createChineseCard({
    hanzi: "",
    pinyin: "",
    gloss: "",
    notes: "",
    example: "",
    examplePinyin: "",
    exampleTranslation: "",
    tags: [],
    clips: [createStudyClip({})],
    dueAt: nowIso(),
    state: "new",
  });
}

export function createSeededState() {
  return {
    items: SEEDED_ITEMS.map((item) => createChineseCard(item)),
    preferences: normalizePreferences(),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

export function normalizeState(raw) {
  if (!raw || typeof raw !== "object") return createSeededState();
  const items = Array.isArray(raw.items) ? raw.items.map(createChineseCard) : [];
  return {
    items,
    preferences: normalizePreferences(raw.preferences),
    createdAt: String(raw.createdAt || nowIso()),
    updatedAt: String(raw.updatedAt || nowIso()),
  };
}

export function importStudyStateFromJson(rawText) {
  const raw = JSON.parse(rawText);
  if (Array.isArray(raw)) {
    return normalizeState({ items: raw });
  }
  return normalizeState(raw);
}

export function upsertStudyCard(state, card) {
  const nextCard = createChineseCard({
    ...card,
    updatedAt: nowIso(),
  });
  const items = [...(state?.items || [])];
  const index = items.findIndex((item) => item.id === nextCard.id);
  if (index >= 0) items[index] = nextCard;
  else items.unshift(nextCard);
  return {
    ...(state || {}),
    items,
    updatedAt: nowIso(),
  };
}

export function deleteStudyCard(state, cardId) {
  return {
    ...(state || {}),
    items: (state?.items || []).filter((item) => item.id !== cardId),
    updatedAt: nowIso(),
  };
}

function compareDueCards(left, right) {
  return new Date(left.dueAt || 0).getTime() - new Date(right.dueAt || 0).getTime()
    || new Date(left.createdAt || 0).getTime() - new Date(right.createdAt || 0).getTime()
    || String(left.hanzi || "").localeCompare(String(right.hanzi || ""));
}

function dateKeyMatches(dateLike, todayKey) {
  return !!dateLike && formatLocalDateKey(dateLike) === todayKey;
}

function buildStudyQueue(items, currentTime = new Date(), options = {}) {
  const now = new Date(currentTime);
  const todayKey = formatLocalDateKey(now);
  const dailyNewLimit = Math.max(0, Number(options.dailyNewLimit) || DEFAULT_DAILY_NEW_LIMIT);
  const dailyReviewLimit = Math.max(0, Number(options.dailyReviewLimit) || DEFAULT_DAILY_REVIEW_LIMIT);
  const allItems = Array.isArray(items) ? items.map(createChineseCard) : [];

  const dueItems = allItems
    .filter((item) => new Date(item.dueAt || 0) <= now)
    .sort(compareDueCards);

  const activeTodayDue = [];
  const reviewDue = [];
  const freshNewDue = [];

  for (const item of dueItems) {
    const reviewedToday = dateKeyMatches(item.lastReviewedAt, todayKey);
    const untouchedNew = item.state === "new" && !item.firstReviewedAt;

    if (reviewedToday) {
      activeTodayDue.push(item);
    } else if (untouchedNew) {
      freshNewDue.push(item);
    } else {
      reviewDue.push(item);
    }
  }

  const newStudiedToday = allItems.filter((item) => dateKeyMatches(item.firstReviewedAt, todayKey)).length;
  const reviewStudiedToday = allItems.filter((item) => (
    dateKeyMatches(item.lastReviewedAt, todayKey)
    && !!item.firstReviewedAt
    && !dateKeyMatches(item.firstReviewedAt, todayKey)
  )).length;

  const newSlotsRemaining = Math.max(0, dailyNewLimit - newStudiedToday);
  const reviewSlotsRemaining = Math.max(0, dailyReviewLimit - reviewStudiedToday);
  const queuedReviews = reviewDue.slice(0, reviewSlotsRemaining);
  const queuedNew = freshNewDue.slice(0, newSlotsRemaining);
  const queue = [...activeTodayDue, ...queuedReviews, ...queuedNew];

  return {
    queue,
    stats: {
      actualDue: dueItems.length,
      activeTodayDue: activeTodayDue.length,
      backlogDue: Math.max(0, dueItems.length - queue.length),
      dailyNewLimit,
      dailyReviewLimit,
      freshNewDue: freshNewDue.length,
      newSlotsRemaining,
      newStudiedToday,
      queuedNew: queuedNew.length,
      queuedReviews: queuedReviews.length,
      reviewDue: reviewDue.length,
      reviewSlotsRemaining,
      reviewStudiedToday,
    },
  };
}

export function dueStudyCards(items, currentTime = new Date(), options = {}) {
  return buildStudyQueue(items, currentTime, options).queue;
}

export function formatLocalDateKey(dateLike = new Date()) {
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function summarizeStudyCards(items, currentTime = new Date(), options = {}) {
  const now = new Date(currentTime);
  const todayKey = formatLocalDateKey(now);
  const queue = buildStudyQueue(items, currentTime, options);
  const summary = {
    total: 0,
    due: queue.queue.length,
    new: 0,
    learning: 0,
    mature: 0,
    reviewedToday: 0,
    actualDue: queue.stats.actualDue,
    activeTodayDue: queue.stats.activeTodayDue,
    backlogDue: queue.stats.backlogDue,
    dailyNewLimit: queue.stats.dailyNewLimit,
    dailyReviewLimit: queue.stats.dailyReviewLimit,
    freshNewDue: queue.stats.freshNewDue,
    newSlotsRemaining: queue.stats.newSlotsRemaining,
    newStudiedToday: queue.stats.newStudiedToday,
    queuedNew: queue.stats.queuedNew,
    queuedReviews: queue.stats.queuedReviews,
    reviewDue: queue.stats.reviewDue,
    reviewSlotsRemaining: queue.stats.reviewSlotsRemaining,
    reviewStudiedToday: queue.stats.reviewStudiedToday,
  };

  for (const item of items || []) {
    summary.total += 1;
    if ((item.state || "new") === "new") summary.new += 1;
    else if ((item.state || "") === "mature") summary.mature += 1;
    else summary.learning += 1;
    if (formatLocalDateKey(item.lastReviewedAt) === todayKey) summary.reviewedToday += 1;
  }

  return summary;
}

export function getStudyStats(items, currentTime = new Date(), options = {}) {
  const now = new Date(currentTime);
  const todayStart = startOfLocalDay(now);
  const tomorrowStart = addLocalDays(todayStart, 1);
  const nextWeekStart = addLocalDays(todayStart, 8);
  const nextMonthStart = addLocalDays(todayStart, 31);
  const allItems = Array.isArray(items) ? items.map(createChineseCard) : [];
  const summary = summarizeStudyCards(allItems, now, options);

  const reviewCountsByDate = new Map();
  const learnedCountsByDate = new Map();
  const forecastCountsByDate = new Map();

  const intervalBreakdown = [
    { key: "new", label: "New", count: 0 },
    { key: "1d", label: "1d", count: 0 },
    { key: "2-7d", label: "2-7d", count: 0 },
    { key: "8-30d", label: "8-30d", count: 0 },
    { key: "31d+", label: "31d+", count: 0 },
  ];

  let dueOverdue = 0;
  let dueToday = 0;
  let dueNext7 = 0;
  let dueNext30 = 0;
  let cardsWithAudio = 0;
  let cardsWithContext = 0;
  let cardsWithTags = 0;

  for (const item of allItems) {
    const dueAt = new Date(item.dueAt || 0);
    if (dueAt < todayStart) dueOverdue += 1;
    else if (dueAt < tomorrowStart) dueToday += 1;
    else if (dueAt < nextWeekStart) dueNext7 += 1;
    else if (dueAt < nextMonthStart) dueNext30 += 1;

    const reviewKey = formatLocalDateKey(item.lastReviewedAt);
    if (reviewKey) {
      reviewCountsByDate.set(reviewKey, (reviewCountsByDate.get(reviewKey) || 0) + 1);
    }

    const learnedKey = formatLocalDateKey(item.firstReviewedAt);
    if (learnedKey) {
      learnedCountsByDate.set(learnedKey, (learnedCountsByDate.get(learnedKey) || 0) + 1);
    }

    const forecastKey = dueAt < tomorrowStart
      ? formatLocalDateKey(todayStart)
      : formatLocalDateKey(dueAt);
    const withinForecastWindow = dueAt < addLocalDays(todayStart, 14);
    if (forecastKey && withinForecastWindow) {
      forecastCountsByDate.set(forecastKey, (forecastCountsByDate.get(forecastKey) || 0) + 1);
    }

    if (item.clips.some((clip) => clip.mediaKind === "audio" && clip.mediaUrl)) cardsWithAudio += 1;
    if (item.example || item.clips.some((clip) => clip.transcript || clip.translation)) cardsWithContext += 1;
    if (item.tags.length > 0) cardsWithTags += 1;

    if ((item.state || "new") === "new" && !item.firstReviewedAt) intervalBreakdown[0].count += 1;
    else if (item.intervalDays <= 1) intervalBreakdown[1].count += 1;
    else if (item.intervalDays <= 7) intervalBreakdown[2].count += 1;
    else if (item.intervalDays <= 30) intervalBreakdown[3].count += 1;
    else intervalBreakdown[4].count += 1;
  }

  const forecast = Array.from({ length: 14 }, (_, index) => {
    const date = addLocalDays(todayStart, index);
    const dateKey = formatLocalDateKey(date);
    return {
      dateKey,
      count: forecastCountsByDate.get(dateKey) || 0,
    };
  });

  const recentActivity = Array.from({ length: 14 }, (_, index) => {
    const date = addLocalDays(todayStart, index - 13);
    const dateKey = formatLocalDateKey(date);
    return {
      dateKey,
      reviewed: reviewCountsByDate.get(dateKey) || 0,
      learned: learnedCountsByDate.get(dateKey) || 0,
    };
  });

  const studiedCards = allItems.filter((item) => item.firstReviewedAt || item.lastReviewedAt || item.intervalDays > 0);

  return {
    summary,
    overview: {
      totalCards: summary.total,
      newCards: summary.new,
      learningCards: summary.learning,
      matureCards: summary.mature,
      reviewedToday: summary.reviewedToday,
      dueInQueue: summary.due,
      actualDue: summary.actualDue,
      backlogDue: summary.backlogDue,
      cardsWithAudio,
      cardsWithContext,
      cardsWithTags,
      averageEase: average(studiedCards.map((item) => item.ease)),
      averageIntervalDays: average(studiedCards.filter((item) => item.intervalDays > 0).map((item) => item.intervalDays)),
    },
    dueBuckets: [
      { key: "overdue", label: "Overdue", count: dueOverdue },
      { key: "today", label: "Today", count: dueToday },
      { key: "next7", label: "Next 7d", count: dueNext7 },
      { key: "next30", label: "Next 30d", count: dueNext30 },
    ],
    intervalBreakdown,
    forecast,
    recentActivity,
    notes: {
      activity: "Recent activity reflects each card's latest review date and first-study date. Full review history is not tracked yet.",
    },
  };
}

export function reviewStudyCard(card, rating, currentTime = new Date()) {
  const item = createChineseCard(card);
  const now = new Date(currentTime).toISOString();
  const next = {
    ...item,
    firstReviewedAt: item.firstReviewedAt || now,
    lastReviewedAt: now,
    updatedAt: now,
  };

  if (rating === "again") {
    next.state = "learning";
    next.reps = 0;
    next.intervalDays = 0;
    next.ease = Math.max(1.3, next.ease - 0.2);
    next.dueAt = addMinutes(now, 10);
    return next;
  }

  if (rating === "hard") {
    const nextInterval = next.intervalDays > 0 ? Math.max(1, Math.round(next.intervalDays * 1.2)) : 1;
    next.state = nextInterval >= 21 ? "mature" : "learning";
    next.reps += 1;
    next.intervalDays = nextInterval;
    next.ease = Math.max(1.3, next.ease - 0.08);
    next.dueAt = addDays(now, nextInterval);
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
