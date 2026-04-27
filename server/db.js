import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { buildSentencePinyin, lookupDictionaryEntries } from "./dictionary.js";
import {
  buildReadingVariantsFromDictionaryEntries,
  createChineseCard,
  createSeededState,
  createStudyClip,
  generatedExampleAudioAssetId,
  generatedExampleAudioUsageId,
  generatedHeadwordAudioAssetId,
  generatedHeadwordAudioUsageId,
  normalizePreferences,
  normalizeState,
  reviewStudyCard,
  serializeReadingVariants,
} from "../src/lib/studyStore.js";
import {
  createReading,
  createReadingSentence,
  generatedReadingSentenceAudioAssetId,
  normalizeReadingLibrary,
  readingTagFromSlug,
  reviewReadingSentence as reviewSentenceUnit,
} from "../src/lib/readingStore.js";

export const DEFAULT_USER_SLUG = "demo";

const DATA_DIR = path.join(process.cwd(), "data");
const DATABASE_PATH = process.env.STUDY_DB_PATH || path.join(DATA_DIR, "mingbai-study-room.sqlite");

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DATABASE_PATH);

db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_preferences (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    pinyin_mode TEXT NOT NULL,
    theme TEXT NOT NULL,
    audio_mode TEXT NOT NULL DEFAULT 'autoplay',
    audio_speed TEXT NOT NULL DEFAULT '1',
    pinyin_size TEXT NOT NULL DEFAULT 'lg',
    example_size TEXT NOT NULL DEFAULT 'md',
    translation_size TEXT NOT NULL DEFAULT 'md',
    daily_new_limit INTEGER NOT NULL DEFAULT 20,
    daily_review_limit INTEGER NOT NULL DEFAULT 100,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS study_cards (
    row_id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    card_id TEXT NOT NULL,
    hanzi TEXT NOT NULL,
    pinyin TEXT NOT NULL,
    gloss TEXT NOT NULL,
    notes TEXT NOT NULL,
    example TEXT NOT NULL,
    example_pinyin TEXT NOT NULL,
    example_translation TEXT NOT NULL,
    ease REAL NOT NULL,
    interval_days INTEGER NOT NULL,
    reps INTEGER NOT NULL,
    due_at TEXT NOT NULL,
    first_reviewed_at TEXT NOT NULL,
    last_reviewed_at TEXT NOT NULL,
    state TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(user_id, card_id)
  );

  CREATE TABLE IF NOT EXISTS study_card_tags (
    card_row_id INTEGER NOT NULL REFERENCES study_cards(row_id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    PRIMARY KEY (card_row_id, tag)
  );

  CREATE TABLE IF NOT EXISTS media_assets (
    row_id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    asset_id TEXT NOT NULL,
    media_kind TEXT NOT NULL,
    storage_provider TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    media_url TEXT NOT NULL,
    source_url TEXT NOT NULL,
    source_title TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    start_ms INTEGER NOT NULL,
    end_ms INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(user_id, asset_id)
  );

  CREATE TABLE IF NOT EXISTS study_card_clip_usages (
    row_id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_row_id INTEGER NOT NULL REFERENCES study_cards(row_id) ON DELETE CASCADE,
    usage_id TEXT NOT NULL,
    media_row_id INTEGER NOT NULL REFERENCES media_assets(row_id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    title TEXT NOT NULL,
    transcript TEXT NOT NULL,
    transcript_pinyin TEXT NOT NULL,
    translation TEXT NOT NULL,
    note TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(card_row_id, usage_id)
  );

  CREATE TABLE IF NOT EXISTS reading_texts (
    row_id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reading_id TEXT NOT NULL,
    slug TEXT NOT NULL,
    title TEXT NOT NULL,
    topic TEXT NOT NULL DEFAULT 'General',
    cover_image_url TEXT NOT NULL,
    body TEXT NOT NULL,
    notes TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(user_id, reading_id),
    UNIQUE(user_id, slug)
  );

  CREATE TABLE IF NOT EXISTS reading_text_tags (
    reading_row_id INTEGER NOT NULL REFERENCES reading_texts(row_id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    PRIMARY KEY (reading_row_id, tag)
  );

  CREATE TABLE IF NOT EXISTS reading_sentences (
    row_id INTEGER PRIMARY KEY AUTOINCREMENT,
    reading_row_id INTEGER NOT NULL REFERENCES reading_texts(row_id) ON DELETE CASCADE,
    sentence_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    text TEXT NOT NULL,
    pinyin TEXT NOT NULL DEFAULT '',
    translation TEXT NOT NULL,
    note TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '[]',
    media_row_id INTEGER REFERENCES media_assets(row_id) ON DELETE SET NULL,
    ease REAL NOT NULL DEFAULT 2.35,
    interval_days INTEGER NOT NULL DEFAULT 0,
    reps INTEGER NOT NULL DEFAULT 0,
    total_review_count INTEGER NOT NULL DEFAULT 0,
    due_at TEXT NOT NULL DEFAULT '',
    first_reviewed_at TEXT NOT NULL DEFAULT '',
    last_reviewed_at TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT 'new',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(reading_row_id, sentence_id)
  );

  CREATE INDEX IF NOT EXISTS idx_study_cards_user_id ON study_cards(user_id);
  CREATE INDEX IF NOT EXISTS idx_media_assets_user_id ON media_assets(user_id);
  CREATE INDEX IF NOT EXISTS idx_study_card_clip_usages_card_row_id ON study_card_clip_usages(card_row_id);
  CREATE INDEX IF NOT EXISTS idx_study_card_clip_usages_media_row_id ON study_card_clip_usages(media_row_id);
  CREATE INDEX IF NOT EXISTS idx_reading_texts_user_id ON reading_texts(user_id);
  CREATE INDEX IF NOT EXISTS idx_reading_sentences_reading_row_id ON reading_sentences(reading_row_id);
`);

function tableColumns(tableName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => String(column.name || ""));
}

function ensureColumn(tableName, columnName, definition) {
  if (tableColumns(tableName).includes(columnName)) return;
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

ensureColumn("study_cards", "first_reviewed_at", "TEXT NOT NULL DEFAULT ''");
ensureColumn("user_preferences", "audio_mode", "TEXT NOT NULL DEFAULT 'autoplay'");
ensureColumn("user_preferences", "audio_speed", "TEXT NOT NULL DEFAULT '1'");
ensureColumn("user_preferences", "pinyin_size", "TEXT NOT NULL DEFAULT 'lg'");
ensureColumn("user_preferences", "example_size", "TEXT NOT NULL DEFAULT 'md'");
ensureColumn("user_preferences", "translation_size", "TEXT NOT NULL DEFAULT 'md'");
ensureColumn("user_preferences", "daily_new_limit", "INTEGER NOT NULL DEFAULT 20");
ensureColumn("user_preferences", "daily_review_limit", "INTEGER NOT NULL DEFAULT 100");
ensureColumn("reading_texts", "topic", "TEXT NOT NULL DEFAULT 'General'");
ensureColumn("reading_sentences", "pinyin", "TEXT NOT NULL DEFAULT ''");
ensureColumn("reading_sentences", "tags", "TEXT NOT NULL DEFAULT '[]'");
ensureColumn("reading_sentences", "ease", "REAL NOT NULL DEFAULT 2.35");
ensureColumn("reading_sentences", "interval_days", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("reading_sentences", "reps", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("reading_sentences", "total_review_count", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("reading_sentences", "due_at", "TEXT NOT NULL DEFAULT ''");
ensureColumn("reading_sentences", "first_reviewed_at", "TEXT NOT NULL DEFAULT ''");
ensureColumn("reading_sentences", "last_reviewed_at", "TEXT NOT NULL DEFAULT ''");
ensureColumn("reading_sentences", "state", "TEXT NOT NULL DEFAULT 'new'");
ensureColumn("user_preferences", "last_reading_id", "TEXT NOT NULL DEFAULT ''");

db.exec(`
  UPDATE reading_sentences
  SET total_review_count = reps
  WHERE total_review_count = 0 AND reps > 0
`);

const selectTableByName = db.prepare(`
  SELECT name
  FROM sqlite_master
  WHERE type = 'table' AND name = ?
`);

const selectUserBySlug = db.prepare(`
  SELECT id, slug, display_name, created_at, updated_at
  FROM users
  WHERE slug = ?
`);

const selectUserById = db.prepare(`
  SELECT id, slug, display_name, created_at, updated_at
  FROM users
  WHERE id = ?
`);

const insertUser = db.prepare(`
  INSERT INTO users (slug, display_name, created_at, updated_at)
  VALUES (?, ?, ?, ?)
`);

const touchUserStatement = db.prepare(`
  UPDATE users
  SET updated_at = ?
  WHERE id = ?
`);

const selectPreferencesByUserId = db.prepare(`
  SELECT
    pinyin_mode,
    theme,
    audio_mode,
    audio_speed,
    pinyin_size,
    example_size,
    translation_size,
    daily_new_limit,
    daily_review_limit,
    last_reading_id,
    updated_at
  FROM user_preferences
  WHERE user_id = ?
`);

const upsertPreferencesStatement = db.prepare(`
  INSERT INTO user_preferences (
    user_id,
    pinyin_mode,
    theme,
    audio_mode,
    audio_speed,
    pinyin_size,
    example_size,
    translation_size,
    daily_new_limit,
    daily_review_limit,
    last_reading_id,
    updated_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(user_id) DO UPDATE SET
    pinyin_mode = excluded.pinyin_mode,
    theme = excluded.theme,
    audio_mode = excluded.audio_mode,
    audio_speed = excluded.audio_speed,
    pinyin_size = excluded.pinyin_size,
    example_size = excluded.example_size,
    translation_size = excluded.translation_size,
    daily_new_limit = excluded.daily_new_limit,
    daily_review_limit = excluded.daily_review_limit,
    last_reading_id = excluded.last_reading_id,
    updated_at = excluded.updated_at
`);

const selectCardsByUserId = db.prepare(`
  SELECT
    row_id,
    card_id,
    hanzi,
    pinyin,
    gloss,
    notes,
    example,
    example_pinyin,
    example_translation,
    ease,
    interval_days,
    reps,
    due_at,
    first_reviewed_at,
    last_reviewed_at,
    state,
    created_at,
    updated_at
  FROM study_cards
  WHERE user_id = ?
  ORDER BY datetime(due_at) ASC, datetime(created_at) ASC, hanzi COLLATE NOCASE ASC
`);

const selectCardRowForUser = db.prepare(`
  SELECT row_id, card_id, created_at, updated_at
  FROM study_cards
  WHERE user_id = ? AND card_id = ?
`);

const insertCardStatement = db.prepare(`
  INSERT INTO study_cards (
    user_id,
    card_id,
    hanzi,
    pinyin,
    gloss,
    notes,
    example,
    example_pinyin,
    example_translation,
    ease,
    interval_days,
    reps,
    due_at,
    first_reviewed_at,
    last_reviewed_at,
    state,
    created_at,
    updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const updateCardStatement = db.prepare(`
  UPDATE study_cards
  SET
    hanzi = ?,
    pinyin = ?,
    gloss = ?,
    notes = ?,
    example = ?,
    example_pinyin = ?,
    example_translation = ?,
    ease = ?,
    interval_days = ?,
    reps = ?,
    due_at = ?,
    first_reviewed_at = ?,
    last_reviewed_at = ?,
    state = ?,
    updated_at = ?
  WHERE user_id = ? AND card_id = ?
`);

const updateCardDefinitionsStatement = db.prepare(`
  UPDATE study_cards
  SET
    pinyin = ?,
    gloss = ?,
    updated_at = ?
  WHERE user_id = ? AND card_id = ?
`);

const deleteCardsForUserStatement = db.prepare(`
  DELETE FROM study_cards
  WHERE user_id = ?
`);

const deleteCardStatement = db.prepare(`
  DELETE FROM study_cards
  WHERE user_id = ? AND card_id = ?
`);

const selectTagsByUserId = db.prepare(`
  SELECT study_card_tags.card_row_id, study_card_tags.tag
  FROM study_card_tags
  JOIN study_cards ON study_cards.row_id = study_card_tags.card_row_id
  WHERE study_cards.user_id = ?
  ORDER BY study_card_tags.card_row_id ASC, study_card_tags.tag COLLATE NOCASE ASC
`);

const deleteTagsForCardStatement = db.prepare(`
  DELETE FROM study_card_tags
  WHERE card_row_id = ?
`);

const insertTagStatement = db.prepare(`
  INSERT INTO study_card_tags (card_row_id, tag)
  VALUES (?, ?)
`);

const selectMediaAssetByUserAndAssetId = db.prepare(`
  SELECT row_id, asset_id, created_at
  FROM media_assets
  WHERE user_id = ? AND asset_id = ?
`);

const insertMediaAssetStatement = db.prepare(`
  INSERT INTO media_assets (
    user_id,
    asset_id,
    media_kind,
    storage_provider,
    storage_key,
    mime_type,
    media_url,
    source_url,
    source_title,
    duration_ms,
    start_ms,
    end_ms,
    created_at,
    updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const updateMediaAssetStatement = db.prepare(`
  UPDATE media_assets
  SET
    media_kind = ?,
    storage_provider = ?,
    storage_key = ?,
    mime_type = ?,
    media_url = ?,
    source_url = ?,
    source_title = ?,
    duration_ms = ?,
    start_ms = ?,
    end_ms = ?,
    updated_at = ?
  WHERE user_id = ? AND asset_id = ?
`);

const deleteOrphanedMediaAssetsForUserStatement = db.prepare(`
  DELETE FROM media_assets
  WHERE user_id = ?
    AND NOT EXISTS (
      SELECT 1
      FROM study_card_clip_usages
      WHERE study_card_clip_usages.media_row_id = media_assets.row_id
    )
`);

const selectClipUsagesByUserId = db.prepare(`
  SELECT
    study_card_clip_usages.card_row_id,
    study_card_clip_usages.usage_id,
    study_card_clip_usages.position,
    study_card_clip_usages.title,
    study_card_clip_usages.transcript,
    study_card_clip_usages.transcript_pinyin,
    study_card_clip_usages.translation,
    study_card_clip_usages.note,
    media_assets.asset_id,
    media_assets.media_kind,
    media_assets.storage_provider,
    media_assets.storage_key,
    media_assets.mime_type,
    media_assets.media_url,
    media_assets.source_url,
    media_assets.source_title,
    media_assets.duration_ms,
    media_assets.start_ms,
    media_assets.end_ms
  FROM study_card_clip_usages
  JOIN study_cards ON study_cards.row_id = study_card_clip_usages.card_row_id
  JOIN media_assets ON media_assets.row_id = study_card_clip_usages.media_row_id
  WHERE study_cards.user_id = ?
  ORDER BY study_card_clip_usages.card_row_id ASC, study_card_clip_usages.position ASC
`);

const deleteClipUsagesForCardStatement = db.prepare(`
  DELETE FROM study_card_clip_usages
  WHERE card_row_id = ?
`);

const insertClipUsageStatement = db.prepare(`
  INSERT INTO study_card_clip_usages (
    card_row_id,
    usage_id,
    media_row_id,
    position,
    title,
    transcript,
    transcript_pinyin,
    translation,
    note,
    created_at,
    updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const selectClipUsageByCardAndUsageId = db.prepare(`
  SELECT row_id
  FROM study_card_clip_usages
  WHERE card_row_id = ? AND usage_id = ?
`);

const selectReadingsByUserId = db.prepare(`
  SELECT
    row_id,
    reading_id,
    slug,
    title,
    topic,
    cover_image_url,
    body,
    notes,
    created_at,
    updated_at
  FROM reading_texts
  WHERE user_id = ?
  ORDER BY datetime(updated_at) DESC, title COLLATE NOCASE ASC
`);

const selectReadingByUserAndId = db.prepare(`
  SELECT
    row_id,
    reading_id,
    slug,
    title,
    topic,
    cover_image_url,
    body,
    notes,
    created_at,
    updated_at
  FROM reading_texts
  WHERE user_id = ? AND reading_id = ?
`);

const insertReadingStatement = db.prepare(`
  INSERT INTO reading_texts (
    user_id,
    reading_id,
    slug,
    title,
    topic,
    cover_image_url,
    body,
    notes,
    created_at,
    updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const updateReadingStatement = db.prepare(`
  UPDATE reading_texts
  SET
    slug = ?,
    title = ?,
    topic = ?,
    cover_image_url = ?,
    body = ?,
    notes = ?,
    updated_at = ?
  WHERE user_id = ? AND reading_id = ?
`);

const deleteReadingStatement = db.prepare(`
  DELETE FROM reading_texts
  WHERE user_id = ? AND reading_id = ?
`);

const deleteReadingsForUserStatement = db.prepare(`
  DELETE FROM reading_texts
  WHERE user_id = ?
`);

const selectReadingTagsByUserId = db.prepare(`
  SELECT
    reading_text_tags.reading_row_id,
    reading_text_tags.tag
  FROM reading_text_tags
  JOIN reading_texts ON reading_texts.row_id = reading_text_tags.reading_row_id
  WHERE reading_texts.user_id = ?
  ORDER BY reading_text_tags.reading_row_id ASC, reading_text_tags.tag COLLATE NOCASE ASC
`);

const deleteReadingTagsForReadingStatement = db.prepare(`
  DELETE FROM reading_text_tags
  WHERE reading_row_id = ?
`);

const insertReadingTagStatement = db.prepare(`
  INSERT INTO reading_text_tags (reading_row_id, tag)
  VALUES (?, ?)
`);

const selectReadingSentencesByUserId = db.prepare(`
  SELECT
    reading_sentences.row_id,
    reading_sentences.reading_row_id,
    reading_sentences.sentence_id,
    reading_sentences.position,
    reading_sentences.text,
    reading_sentences.pinyin,
    reading_sentences.translation,
    reading_sentences.note,
    reading_sentences.tags,
    reading_sentences.ease,
    reading_sentences.interval_days,
    reading_sentences.reps,
    reading_sentences.total_review_count,
    reading_sentences.due_at,
    reading_sentences.first_reviewed_at,
    reading_sentences.last_reviewed_at,
    reading_sentences.state,
    media_assets.asset_id,
    media_assets.media_kind,
    media_assets.storage_provider,
    media_assets.storage_key,
    media_assets.mime_type,
    media_assets.media_url,
    media_assets.source_url,
    media_assets.source_title,
    media_assets.duration_ms,
    media_assets.start_ms,
    media_assets.end_ms,
    reading_sentences.created_at,
    reading_sentences.updated_at
  FROM reading_sentences
  JOIN reading_texts ON reading_texts.row_id = reading_sentences.reading_row_id
  LEFT JOIN media_assets ON media_assets.row_id = reading_sentences.media_row_id
  WHERE reading_texts.user_id = ?
  ORDER BY reading_sentences.reading_row_id ASC, reading_sentences.position ASC
`);

const selectReadingSentenceByIds = db.prepare(`
  SELECT
    reading_sentences.row_id,
    reading_sentences.reading_row_id,
    reading_sentences.sentence_id,
    reading_sentences.position,
    reading_sentences.text,
    reading_sentences.pinyin,
    reading_sentences.translation,
    reading_sentences.note,
    reading_sentences.tags,
    reading_sentences.ease,
    reading_sentences.interval_days,
    reading_sentences.reps,
    reading_sentences.total_review_count,
    reading_sentences.due_at,
    reading_sentences.first_reviewed_at,
    reading_sentences.last_reviewed_at,
    reading_sentences.state,
    media_assets.asset_id,
    media_assets.media_kind,
    media_assets.storage_provider,
    media_assets.storage_key,
    media_assets.mime_type,
    media_assets.media_url,
    media_assets.source_url,
    media_assets.source_title,
    media_assets.duration_ms,
    media_assets.start_ms,
    media_assets.end_ms,
    reading_sentences.created_at,
    reading_sentences.updated_at
  FROM reading_sentences
  JOIN reading_texts ON reading_texts.row_id = reading_sentences.reading_row_id
  LEFT JOIN media_assets ON media_assets.row_id = reading_sentences.media_row_id
  WHERE reading_texts.user_id = ? AND reading_texts.reading_id = ? AND reading_sentences.sentence_id = ?
`);

const deleteReadingSentencesForReadingStatement = db.prepare(`
  DELETE FROM reading_sentences
  WHERE reading_row_id = ?
`);

const insertReadingSentenceStatement = db.prepare(`
  INSERT INTO reading_sentences (
    reading_row_id,
    sentence_id,
    position,
    text,
    pinyin,
    translation,
    note,
    tags,
    media_row_id,
    ease,
    interval_days,
    reps,
    total_review_count,
    due_at,
    first_reviewed_at,
    last_reviewed_at,
    state,
    created_at,
    updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const updateReadingSentenceMediaStatement = db.prepare(`
  UPDATE reading_sentences
  SET
    media_row_id = ?,
    updated_at = ?
  WHERE row_id = ?
`);

const updateReadingSentenceReviewStatement = db.prepare(`
  UPDATE reading_sentences
  SET
    pinyin = ?,
    translation = ?,
    note = ?,
    ease = ?,
    interval_days = ?,
    reps = ?,
    total_review_count = ?,
    due_at = ?,
    first_reviewed_at = ?,
    last_reviewed_at = ?,
    state = ?,
    updated_at = ?
  WHERE row_id = ?
`);

function nowIso() {
  return new Date().toISOString();
}

function parseJsonArray(rawValue) {
  try {
    const parsed = JSON.parse(String(rawValue || "[]"));
    return Array.isArray(parsed)
      ? parsed.map((value) => String(value || "").trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function buildReadingSourceUrl(readingId = "", sentenceId = "") {
  return `reading://${encodeURIComponent(String(readingId || ""))}/${encodeURIComponent(String(sentenceId || ""))}`;
}

function withTransaction(work) {
  db.exec("BEGIN");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function tableExists(tableName) {
  return !!selectTableByName.get(tableName);
}

function normalizeUserSlug(userSlug = DEFAULT_USER_SLUG) {
  const raw = String(userSlug || DEFAULT_USER_SLUG)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return raw || DEFAULT_USER_SLUG;
}

function displayNameFromSlug(slug) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ") || "Study User";
}

function touchUser(userId, timestamp = nowIso()) {
  touchUserStatement.run(timestamp, userId);
}

async function populateSentencePinyinForReading(reading) {
  const sentences = [];

  for (const sentence of reading.sentences || []) {
    if (String(sentence.pinyin || "").trim()) {
      sentences.push(sentence);
      continue;
    }

    let nextPinyin = "";
    try {
      nextPinyin = await buildSentencePinyin(sentence.text);
    } catch {
      nextPinyin = "";
    }

    sentences.push({
      ...sentence,
      pinyin: nextPinyin,
    });
  }

  return createReading({
    ...reading,
    sentences,
  });
}

function cleanupOrphanedMediaAssetsForUser(userId) {
  deleteOrphanedMediaAssetsForUserStatement.run(userId);
}

function upsertMediaAssetForUser(userId, clip, timestamps = {}) {
  const nextClip = createStudyClip(clip);
  const existingAsset = selectMediaAssetByUserAndAssetId.get(userId, nextClip.assetId);
  const createdAt = String(timestamps.createdAt || existingAsset?.created_at || nowIso());
  const updatedAt = String(timestamps.updatedAt || nowIso());

  if (existingAsset) {
    updateMediaAssetStatement.run(
      nextClip.mediaKind,
      nextClip.storageProvider,
      nextClip.storageKey,
      nextClip.mimeType,
      nextClip.mediaUrl,
      nextClip.sourceUrl,
      nextClip.sourceTitle,
      nextClip.durationMs,
      nextClip.startMs,
      nextClip.endMs,
      updatedAt,
      userId,
      nextClip.assetId,
    );
    return Number(existingAsset.row_id);
  }

  const result = insertMediaAssetStatement.run(
    userId,
    nextClip.assetId,
    nextClip.mediaKind,
    nextClip.storageProvider,
    nextClip.storageKey,
    nextClip.mimeType,
    nextClip.mediaUrl,
    nextClip.sourceUrl,
    nextClip.sourceTitle,
    nextClip.durationMs,
    nextClip.startMs,
    nextClip.endMs,
    createdAt,
    updatedAt,
  );
  return Number(result.lastInsertRowid);
}

function replaceCardRelations(userId, cardRowId, card, { pruneOrphans = true } = {}) {
  deleteTagsForCardStatement.run(cardRowId);
  for (const tag of card.tags) {
    insertTagStatement.run(cardRowId, tag);
  }

  deleteClipUsagesForCardStatement.run(cardRowId);
  const createdAt = String(card.createdAt || nowIso());
  const updatedAt = String(card.updatedAt || createdAt);

  card.clips.forEach((clip, position) => {
    const nextClip = createStudyClip(clip);
    const mediaRowId = upsertMediaAssetForUser(userId, nextClip, {
      createdAt,
      updatedAt,
    });

    insertClipUsageStatement.run(
      cardRowId,
      nextClip.id,
      mediaRowId,
      position,
      nextClip.title,
      nextClip.transcript,
      nextClip.transcriptPinyin,
      nextClip.translation,
      nextClip.note,
      createdAt,
      updatedAt,
    );
  });

  if (pruneOrphans) {
    cleanupOrphanedMediaAssetsForUser(userId);
  }
}

function replaceReadingRelations(userId, readingRowId, reading, { pruneOrphans = true } = {}) {
  deleteReadingTagsForReadingStatement.run(readingRowId);
  for (const tag of reading.tags) {
    insertReadingTagStatement.run(readingRowId, tag);
  }

  deleteReadingSentencesForReadingStatement.run(readingRowId);
  const createdAt = String(reading.createdAt || nowIso());
  const updatedAt = String(reading.updatedAt || createdAt);

  reading.sentences.forEach((sentence, position) => {
    const nextSentence = createReadingSentence({ ...sentence, position });
    let mediaRowId = null;

    if (nextSentence.assetId || nextSentence.mediaUrl) {
      mediaRowId = upsertMediaAssetForUser(userId, {
        id: nextSentence.id,
        assetId: nextSentence.assetId || generatedReadingSentenceAudioAssetId(reading.id, nextSentence.id),
        title: "Reading sentence audio",
        mediaKind: nextSentence.mediaKind || "audio",
        storageProvider: nextSentence.storageProvider,
        storageKey: nextSentence.storageKey,
        mimeType: nextSentence.mimeType,
        mediaUrl: nextSentence.mediaUrl,
        sourceUrl: nextSentence.sourceUrl,
        sourceTitle: nextSentence.sourceTitle || reading.title,
        durationMs: nextSentence.durationMs,
        startMs: nextSentence.startMs,
        endMs: nextSentence.endMs,
      }, {
        createdAt,
        updatedAt,
      });
    }

    insertReadingSentenceStatement.run(
      readingRowId,
      nextSentence.id,
      nextSentence.position,
      nextSentence.text,
      nextSentence.pinyin,
      nextSentence.translation,
      nextSentence.note,
      JSON.stringify(nextSentence.tags || []),
      mediaRowId,
      nextSentence.ease,
      nextSentence.intervalDays,
      nextSentence.reps,
      nextSentence.totalReviewCount,
      nextSentence.dueAt || nextSentence.createdAt || createdAt,
      nextSentence.firstReviewedAt || "",
      nextSentence.lastReviewedAt || "",
      nextSentence.state,
      nextSentence.createdAt || createdAt,
      updatedAt,
    );
  });

  if (pruneOrphans) {
    cleanupOrphanedMediaAssetsForUser(userId);
  }
}

function insertCardForUser(userId, card, options = {}) {
  const nextCard = createChineseCard(card);
  const result = insertCardStatement.run(
    userId,
    nextCard.id,
    nextCard.hanzi,
    nextCard.pinyin,
    nextCard.gloss,
    nextCard.notes,
    nextCard.example,
    nextCard.examplePinyin,
    nextCard.exampleTranslation,
    nextCard.ease,
    nextCard.intervalDays,
    nextCard.reps,
    nextCard.dueAt,
    nextCard.firstReviewedAt,
    nextCard.lastReviewedAt,
    nextCard.state,
    nextCard.createdAt,
    nextCard.updatedAt,
  );
  const cardRowId = Number(result.lastInsertRowid);
  replaceCardRelations(userId, cardRowId, nextCard, options);
  return cardRowId;
}

function migrateLegacyClipTableIfNeeded() {
  if (!tableExists("study_card_clips")) return;

  const legacyCount = Number(db.prepare("SELECT COUNT(*) AS count FROM study_card_clips").get().count || 0);
  if (!legacyCount) return;

  const legacyRows = db.prepare(`
    SELECT
      study_card_clips.row_id AS legacy_row_id,
      study_card_clips.card_row_id,
      study_card_clips.clip_id,
      study_card_clips.position,
      study_card_clips.title,
      study_card_clips.quote,
      study_card_clips.quote_pinyin,
      study_card_clips.source_label,
      study_card_clips.note,
      study_card_clips.media_url,
      study_card_clips.source_url,
      study_card_clips.start_seconds,
      study_cards.user_id,
      study_cards.created_at AS card_created_at,
      study_cards.updated_at AS card_updated_at
    FROM study_card_clips
    JOIN study_cards ON study_cards.row_id = study_card_clips.card_row_id
    ORDER BY study_card_clips.card_row_id ASC, study_card_clips.position ASC
  `).all();

  withTransaction(() => {
    for (const row of legacyRows) {
      const createdAt = String(row.card_created_at || nowIso());
      const updatedAt = String(row.card_updated_at || createdAt);
      const clip = createStudyClip({
        id: row.clip_id || `clip-legacy-${row.legacy_row_id}`,
        assetId: `asset-legacy-${row.legacy_row_id}`,
        title: row.title,
        transcript: row.quote,
        transcriptPinyin: row.quote_pinyin,
        sourceTitle: row.source_label,
        note: row.note,
        mediaUrl: row.media_url,
        sourceUrl: row.source_url,
        startMs: Number(row.start_seconds || 0) * 1000,
      });

      if (selectClipUsageByCardAndUsageId.get(row.card_row_id, clip.id)) {
        continue;
      }

      const mediaRowId = upsertMediaAssetForUser(row.user_id, clip, {
        createdAt,
        updatedAt,
      });

      insertClipUsageStatement.run(
        row.card_row_id,
        clip.id,
        mediaRowId,
        row.position,
        clip.title,
        clip.transcript,
        clip.transcriptPinyin,
        clip.translation,
        clip.note,
        createdAt,
        updatedAt,
      );
    }
  });
}

migrateLegacyClipTableIfNeeded();

function ensureUser(userSlug = DEFAULT_USER_SLUG) {
  const slug = normalizeUserSlug(userSlug);
  const existingUser = selectUserBySlug.get(slug);
  if (existingUser) return existingUser;

  withTransaction(() => {
    const seededState = createSeededState();
    const timestamp = nowIso();
    const result = insertUser.run(slug, displayNameFromSlug(slug), timestamp, timestamp);
    const userId = Number(result.lastInsertRowid);

    upsertPreferencesStatement.run(
      userId,
      seededState.preferences.pinyinMode,
      seededState.preferences.theme,
      seededState.preferences.audioMode,
      seededState.preferences.audioSpeed,
      seededState.preferences.pinyinSize,
      seededState.preferences.exampleSize,
      seededState.preferences.translationSize,
      seededState.preferences.dailyNewLimit,
      seededState.preferences.dailyReviewLimit,
      seededState.preferences.lastReadingId || "",
      timestamp,
    );

    for (const card of seededState.items) {
      insertCardForUser(userId, card, { pruneOrphans: false });
    }

    touchUser(userId, timestamp);
  });

  return selectUserBySlug.get(slug);
}

function hydrateStateForUser(userId) {
  const user = selectUserById.get(userId);

  if (!user) {
    throw httpError(404, "User not found.");
  }

  const preferenceRow = selectPreferencesByUserId.get(userId);
  const cardRows = selectCardsByUserId.all(userId);
  const tagRows = selectTagsByUserId.all(userId);
  const clipUsageRows = selectClipUsagesByUserId.all(userId);

  const cardsByRowId = new Map(
    cardRows.map((row) => [
      row.row_id,
      createChineseCard({
        id: row.card_id,
        hanzi: row.hanzi,
        pinyin: row.pinyin,
        gloss: row.gloss,
        notes: row.notes,
        example: row.example,
        examplePinyin: row.example_pinyin,
        exampleTranslation: row.example_translation,
        tags: [],
        clips: [],
        ease: row.ease,
        intervalDays: row.interval_days,
        reps: row.reps,
        dueAt: row.due_at,
        firstReviewedAt: row.first_reviewed_at,
        lastReviewedAt: row.last_reviewed_at,
        state: row.state,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }),
    ]),
  );

  for (const row of tagRows) {
    const card = cardsByRowId.get(row.card_row_id);
    if (card) {
      card.tags.push(row.tag);
    }
  }

  for (const row of clipUsageRows) {
    const card = cardsByRowId.get(row.card_row_id);
    if (card) {
      card.clips.push(createStudyClip({
        id: row.usage_id,
        assetId: row.asset_id,
        title: row.title,
        transcript: row.transcript,
        transcriptPinyin: row.transcript_pinyin,
        translation: row.translation,
        note: row.note,
        mediaKind: row.media_kind,
        storageProvider: row.storage_provider,
        storageKey: row.storage_key,
        mimeType: row.mime_type,
        mediaUrl: row.media_url,
        sourceUrl: row.source_url,
        sourceTitle: row.source_title,
        durationMs: row.duration_ms,
        startMs: row.start_ms,
        endMs: row.end_ms,
      }));
    }
  }

  return normalizeState({
    items: Array.from(cardsByRowId.values()),
    preferences: normalizePreferences({
      pinyinMode: preferenceRow?.pinyin_mode,
      theme: preferenceRow?.theme,
      audioMode: preferenceRow?.audio_mode,
      audioSpeed: preferenceRow?.audio_speed,
      pinyinSize: preferenceRow?.pinyin_size,
      exampleSize: preferenceRow?.example_size,
      translationSize: preferenceRow?.translation_size,
      dailyNewLimit: preferenceRow?.daily_new_limit,
      dailyReviewLimit: preferenceRow?.daily_review_limit,
      lastReadingId: preferenceRow?.last_reading_id,
    }),
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  });
}

function hydrateReadingLibraryForUser(userId) {
  const readingRows = selectReadingsByUserId.all(userId);
  const tagRows = selectReadingTagsByUserId.all(userId);
  const sentenceRows = selectReadingSentencesByUserId.all(userId);

  const readingsByRowId = new Map(
    readingRows.map((row) => [
      row.row_id,
      createReading({
        id: row.reading_id,
        slug: row.slug,
        title: row.title,
        topic: row.topic,
        coverImageUrl: row.cover_image_url,
        body: row.body,
        notes: row.notes,
        tags: [],
        sentences: [],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }),
    ]),
  );

  for (const row of tagRows) {
    const reading = readingsByRowId.get(row.reading_row_id);
    if (reading) {
      reading.tags.push(row.tag);
    }
  }

  for (const row of sentenceRows) {
    const reading = readingsByRowId.get(row.reading_row_id);
    if (reading) {
      reading.sentences.push(createReadingSentence({
        id: row.sentence_id,
        position: row.position,
        text: row.text,
        pinyin: row.pinyin,
        translation: row.translation,
        note: row.note,
        tags: parseJsonArray(row.tags),
        ease: row.ease,
        intervalDays: row.interval_days,
        reps: row.reps,
        totalReviewCount: row.total_review_count,
        dueAt: row.due_at || row.created_at,
        firstReviewedAt: row.first_reviewed_at || "",
        lastReviewedAt: row.last_reviewed_at || "",
        state: row.state || "new",
        assetId: row.asset_id || "",
        mediaKind: row.media_kind || "",
        storageProvider: row.storage_provider || "",
        storageKey: row.storage_key || "",
        mimeType: row.mime_type || "",
        mediaUrl: row.media_url || "",
        sourceUrl: row.source_url || "",
        sourceTitle: row.source_title || "",
        durationMs: row.duration_ms || 0,
        startMs: row.start_ms || 0,
        endMs: row.end_ms || 0,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    }
  }

  return normalizeReadingLibrary(Array.from(readingsByRowId.values()));
}

export function getStudyState(userSlug = DEFAULT_USER_SLUG) {
  const user = ensureUser(userSlug);
  return hydrateStateForUser(user.id);
}

export function getReadingLibrary(userSlug = DEFAULT_USER_SLUG) {
  const user = ensureUser(userSlug);
  return hydrateReadingLibraryForUser(user.id);
}

export function replaceStudyState(userSlug = DEFAULT_USER_SLUG, state) {
  const user = ensureUser(userSlug);
  const nextState = normalizeState(state);

  withTransaction(() => {
    deleteCardsForUserStatement.run(user.id);
    for (const card of nextState.items) {
      insertCardForUser(user.id, card, { pruneOrphans: false });
    }

    cleanupOrphanedMediaAssetsForUser(user.id);

    const timestamp = nowIso();
    upsertPreferencesStatement.run(
      user.id,
      nextState.preferences.pinyinMode,
      nextState.preferences.theme,
      nextState.preferences.audioMode,
      nextState.preferences.audioSpeed,
      nextState.preferences.pinyinSize,
      nextState.preferences.exampleSize,
      nextState.preferences.translationSize,
      nextState.preferences.dailyNewLimit,
      nextState.preferences.dailyReviewLimit,
      nextState.preferences.lastReadingId || "",
      timestamp,
    );
    touchUser(user.id, timestamp);
  });

  return hydrateStateForUser(user.id);
}

export async function upsertReading(userSlug = DEFAULT_USER_SLUG, reading) {
  const user = ensureUser(userSlug);
  const timestamp = nowIso();
  const existing = selectReadingByUserAndId.get(user.id, String(reading?.id || ""));
  const nextReading = await populateSentencePinyinForReading(createReading({
    ...reading,
    createdAt: existing?.created_at || reading?.createdAt || timestamp,
    updatedAt: timestamp,
  }));

  withTransaction(() => {
    let readingRowId = existing?.row_id ? Number(existing.row_id) : null;

    if (readingRowId) {
      updateReadingStatement.run(
        nextReading.slug,
        nextReading.title,
        nextReading.topic,
        nextReading.coverImageUrl,
        nextReading.body,
        nextReading.notes,
        nextReading.updatedAt,
        user.id,
        nextReading.id,
      );
      replaceReadingRelations(user.id, readingRowId, nextReading);
    } else {
      const result = insertReadingStatement.run(
        user.id,
        nextReading.id,
        nextReading.slug,
        nextReading.title,
        nextReading.topic,
        nextReading.coverImageUrl,
        nextReading.body,
        nextReading.notes,
        nextReading.createdAt,
        nextReading.updatedAt,
      );
      readingRowId = Number(result.lastInsertRowid);
      replaceReadingRelations(user.id, readingRowId, nextReading, { pruneOrphans: false });
    }

    touchUser(user.id, timestamp);
  });

  return hydrateReadingLibraryForUser(user.id);
}

export function deleteReading(userSlug = DEFAULT_USER_SLUG, readingId) {
  const user = ensureUser(userSlug);
  const existing = selectReadingByUserAndId.get(user.id, String(readingId || ""));
  if (!existing) {
    throw httpError(404, "Reading not found.");
  }

  withTransaction(() => {
    deleteReadingStatement.run(user.id, String(readingId));
    cleanupOrphanedMediaAssetsForUser(user.id);
    touchUser(user.id, nowIso());
  });

  return hydrateReadingLibraryForUser(user.id);
}

export function clearReadingLibrary(userSlug = DEFAULT_USER_SLUG) {
  const user = ensureUser(userSlug);

  withTransaction(() => {
    deleteReadingsForUserStatement.run(user.id);
    cleanupOrphanedMediaAssetsForUser(user.id);
    touchUser(user.id, nowIso());
  });

  return hydrateReadingLibraryForUser(user.id);
}

export function updateStudyPreferences(userSlug = DEFAULT_USER_SLUG, preferencePatch = {}) {
  const user = ensureUser(userSlug);
  const currentState = hydrateStateForUser(user.id);
  const nextPreferences = normalizePreferences({
    ...currentState.preferences,
    ...preferencePatch,
  });
  const timestamp = nowIso();

  withTransaction(() => {
    upsertPreferencesStatement.run(
      user.id,
      nextPreferences.pinyinMode,
      nextPreferences.theme,
      nextPreferences.audioMode,
      nextPreferences.audioSpeed,
      nextPreferences.pinyinSize,
      nextPreferences.exampleSize,
      nextPreferences.translationSize,
      nextPreferences.dailyNewLimit,
      nextPreferences.dailyReviewLimit,
      nextPreferences.lastReadingId || "",
      timestamp,
    );
    touchUser(user.id, timestamp);
  });

  return hydrateStateForUser(user.id);
}

export async function replaceCardDefinitionsFromDictionary(userSlug = DEFAULT_USER_SLUG, cardId, options = {}) {
  const user = ensureUser(userSlug);
  const currentState = hydrateStateForUser(user.id);
  const currentCard = currentState.items.find((item) => item.id === String(cardId || ""));
  if (!currentCard) {
    throw httpError(404, "Card not found.");
  }

  const entries = await lookupDictionaryEntries(currentCard.hanzi, { limit: 4 });
  const nextReadings = buildReadingVariantsFromDictionaryEntries(entries);
  if (!nextReadings.length) {
    throw httpError(404, `No CC-CEDICT entry found for ${currentCard.hanzi}.`);
  }

  const serializedReadings = serializeReadingVariants(nextReadings);
  const nextPinyin = String(serializedReadings.pinyin || currentCard.pinyin || "");
  const nextGloss = String(serializedReadings.gloss || currentCard.gloss || "");
  const changed = nextPinyin !== currentCard.pinyin || nextGloss !== currentCard.gloss;

  if (changed) {
    const timestamp = nowIso();
    withTransaction(() => {
      updateCardDefinitionsStatement.run(nextPinyin, nextGloss, timestamp, user.id, currentCard.id);
      touchUser(user.id, timestamp);
    });
  }

  return {
    studyState: hydrateStateForUser(user.id),
    updatedCount: changed ? 1 : 0,
    matchedCount: 1,
    missingCount: 0,
    unchangedCount: changed ? 0 : 1,
  };
}

export async function replaceTaggedCardDefinitionsFromDictionary(
  userSlug = DEFAULT_USER_SLUG,
  { tag = "anki-import" } = {},
) {
  const user = ensureUser(userSlug);
  const currentState = hydrateStateForUser(user.id);
  const needleTag = String(tag || "").trim();
  const targetCards = currentState.items.filter((item) => needleTag ? item.tags.includes(needleTag) : true);

  let updatedCount = 0;
  let matchedCount = 0;
  let missingCount = 0;
  let unchangedCount = 0;
  const replacements = [];
  const timestamp = nowIso();

  for (const card of targetCards) {
    const entries = await lookupDictionaryEntries(card.hanzi, { limit: 4 });
    const nextReadings = buildReadingVariantsFromDictionaryEntries(entries);
    if (!nextReadings.length) {
      missingCount += 1;
      continue;
    }

    matchedCount += 1;
    const serializedReadings = serializeReadingVariants(nextReadings);
    const nextPinyin = String(serializedReadings.pinyin || card.pinyin || "");
    const nextGloss = String(serializedReadings.gloss || card.gloss || "");

    if (nextPinyin === card.pinyin && nextGloss === card.gloss) {
      unchangedCount += 1;
      continue;
    }

    replacements.push({ cardId: card.id, pinyin: nextPinyin, gloss: nextGloss });
    updatedCount += 1;
  }

  if (updatedCount > 0) {
    withTransaction(() => {
      for (const replacement of replacements) {
        updateCardDefinitionsStatement.run(replacement.pinyin, replacement.gloss, timestamp, user.id, replacement.cardId);
      }
      touchUser(user.id, timestamp);
    });
  }

  return {
    studyState: hydrateStateForUser(user.id),
    updatedCount,
    matchedCount,
    missingCount,
    unchangedCount,
    scannedCount: targetCards.length,
    tag: needleTag,
  };
}

export function upsertStudyCard(userSlug = DEFAULT_USER_SLUG, card) {
  const user = ensureUser(userSlug);
  const existing = selectCardRowForUser.get(user.id, String(card?.id || ""));
  const timestamp = nowIso();
  const nextCard = createChineseCard({
    ...card,
    createdAt: existing?.created_at || card?.createdAt || timestamp,
    updatedAt: timestamp,
  });

  withTransaction(() => {
    let cardRowId = existing?.row_id ? Number(existing.row_id) : null;

    if (cardRowId) {
      updateCardStatement.run(
        nextCard.hanzi,
        nextCard.pinyin,
        nextCard.gloss,
        nextCard.notes,
        nextCard.example,
        nextCard.examplePinyin,
        nextCard.exampleTranslation,
        nextCard.ease,
        nextCard.intervalDays,
        nextCard.reps,
        nextCard.dueAt,
        nextCard.firstReviewedAt,
        nextCard.lastReviewedAt,
        nextCard.state,
        nextCard.updatedAt,
        user.id,
        nextCard.id,
      );
      replaceCardRelations(user.id, cardRowId, nextCard);
    } else {
      cardRowId = insertCardForUser(user.id, nextCard);
    }

    touchUser(user.id, timestamp);
  });

  return hydrateStateForUser(user.id);
}

export function deleteStudyCard(userSlug = DEFAULT_USER_SLUG, cardId) {
  const user = ensureUser(userSlug);
  const existing = selectCardRowForUser.get(user.id, String(cardId || ""));
  if (!existing) {
    throw httpError(404, "Card not found.");
  }

  withTransaction(() => {
    deleteCardStatement.run(user.id, String(cardId));
    cleanupOrphanedMediaAssetsForUser(user.id);
    touchUser(user.id, nowIso());
  });

  return hydrateStateForUser(user.id);
}

export function reviewCard(userSlug = DEFAULT_USER_SLUG, cardId, rating) {
  const user = ensureUser(userSlug);
  const currentState = hydrateStateForUser(user.id);
  const currentCard = currentState.items.find((item) => item.id === String(cardId));
  if (!currentCard) {
    throw httpError(404, "Card not found.");
  }

  return upsertStudyCard(user.slug, reviewStudyCard(currentCard, rating));
}

export function attachGeneratedHeadwordAudio(userSlug = DEFAULT_USER_SLUG, cardId, audio = {}) {
  const user = ensureUser(userSlug);
  const currentState = hydrateStateForUser(user.id);
  const currentCard = currentState.items.find((item) => item.id === String(cardId));
  if (!currentCard) {
    throw httpError(404, "Card not found.");
  }

  const provider = String(audio.provider || "azure");
  const usageId = generatedHeadwordAudioUsageId(currentCard.id, provider);
  const assetId = generatedHeadwordAudioAssetId(currentCard.id, provider);
  const nextClip = createStudyClip({
    id: usageId,
    assetId,
    title: audio.title || "Headword audio",
    mediaKind: audio.mediaKind || "audio",
    storageProvider: audio.storageProvider || "local",
    storageKey: audio.storageKey || "",
    mimeType: audio.mimeType || "audio/mpeg",
    mediaUrl: audio.mediaUrl || "",
    sourceUrl: audio.sourceUrl || "",
    sourceTitle: audio.sourceTitle || "Azure TTS",
    note: audio.note || "Cached headword audio generated by Azure Speech.",
    durationMs: audio.durationMs || 0,
    startMs: audio.startMs || 0,
    endMs: audio.endMs || 0,
  });

  const remainingClips = currentCard.clips.filter((clip) => (
    clip.id !== usageId && clip.assetId !== assetId
  ));

  return upsertStudyCard(user.slug, {
    ...currentCard,
    clips: [nextClip, ...remainingClips],
  });
}

export function attachGeneratedExampleAudio(userSlug = DEFAULT_USER_SLUG, cardId, audio = {}) {
  const user = ensureUser(userSlug);
  const currentState = hydrateStateForUser(user.id);
  const currentCard = currentState.items.find((item) => item.id === String(cardId));
  if (!currentCard) {
    throw httpError(404, "Card not found.");
  }

  const provider = String(audio.provider || "azure");
  const usageId = generatedExampleAudioUsageId(currentCard.id, provider);
  const assetId = generatedExampleAudioAssetId(currentCard.id, provider);
  const nextClip = createStudyClip({
    id: usageId,
    assetId,
    title: audio.title || "Example audio",
    mediaKind: audio.mediaKind || "audio",
    storageProvider: audio.storageProvider || "local",
    storageKey: audio.storageKey || "",
    mimeType: audio.mimeType || "audio/mpeg",
    mediaUrl: audio.mediaUrl || "",
    sourceUrl: audio.sourceUrl || "",
    sourceTitle: audio.sourceTitle || "Azure TTS",
    note: audio.note || "Cached example sentence audio generated by Azure Speech.",
    durationMs: audio.durationMs || 0,
    startMs: audio.startMs || 0,
    endMs: audio.endMs || 0,
  });

  const remainingClips = currentCard.clips.filter((clip) => (
    clip.id !== usageId && clip.assetId !== assetId
  ));

  const headwordUsageId = generatedHeadwordAudioUsageId(currentCard.id, provider);
  const headwordClips = remainingClips.filter((clip) => clip.id === headwordUsageId);
  const otherClips = remainingClips.filter((clip) => clip.id !== headwordUsageId);

  return upsertStudyCard(user.slug, {
    ...currentCard,
    clips: [...headwordClips, nextClip, ...otherClips],
  });
}

export function attachGeneratedReadingSentenceAudio(userSlug = DEFAULT_USER_SLUG, readingId, sentenceId, audio = {}) {
  const user = ensureUser(userSlug);
  const sentenceRow = selectReadingSentenceByIds.get(user.id, String(readingId), String(sentenceId));
  if (!sentenceRow) {
    throw httpError(404, "Reading sentence not found.");
  }

  const readingRow = selectReadingByUserAndId.get(user.id, String(readingId));
  if (!readingRow) {
    throw httpError(404, "Reading not found.");
  }

  const provider = String(audio.provider || "azure");
  const assetId = generatedReadingSentenceAudioAssetId(readingId, sentenceId, provider);
  const mediaRowId = upsertMediaAssetForUser(user.id, {
    id: sentenceId,
    assetId,
    title: audio.title || "Reading sentence audio",
    mediaKind: audio.mediaKind || "audio",
    storageProvider: audio.storageProvider || "local",
    storageKey: audio.storageKey || "",
    mimeType: audio.mimeType || "audio/mpeg",
    mediaUrl: audio.mediaUrl || "",
    sourceUrl: audio.sourceUrl || "",
    sourceTitle: audio.sourceTitle || readingRow.title,
    note: audio.note || "Cached reading sentence audio generated by Azure Speech.",
    durationMs: audio.durationMs || 0,
    startMs: audio.startMs || 0,
    endMs: audio.endMs || 0,
  }, {
    createdAt: sentenceRow.created_at || nowIso(),
    updatedAt: nowIso(),
  });

  updateReadingSentenceMediaStatement.run(mediaRowId, nowIso(), sentenceRow.row_id);
  touchUser(user.id, nowIso());
  return hydrateReadingLibraryForUser(user.id);
}

export function reviewReadingSentence(userSlug = DEFAULT_USER_SLUG, readingId, sentenceId, rating) {
  const user = ensureUser(userSlug);
  const sentenceRow = selectReadingSentenceByIds.get(user.id, String(readingId), String(sentenceId));
  if (!sentenceRow) {
    throw httpError(404, "Reading sentence not found.");
  }

  const nextSentence = reviewSentenceUnit({
    id: sentenceRow.sentence_id,
    position: sentenceRow.position,
    text: sentenceRow.text,
    pinyin: sentenceRow.pinyin,
    translation: sentenceRow.translation,
    note: sentenceRow.note,
    tags: parseJsonArray(sentenceRow.tags),
    assetId: sentenceRow.asset_id || "",
    mediaKind: sentenceRow.media_kind || "",
    storageProvider: sentenceRow.storage_provider || "",
    storageKey: sentenceRow.storage_key || "",
    mimeType: sentenceRow.mime_type || "",
    mediaUrl: sentenceRow.media_url || "",
    sourceUrl: sentenceRow.source_url || "",
    sourceTitle: sentenceRow.source_title || "",
    durationMs: sentenceRow.duration_ms || 0,
    startMs: sentenceRow.start_ms || 0,
    endMs: sentenceRow.end_ms || 0,
    ease: sentenceRow.ease,
    intervalDays: sentenceRow.interval_days,
    reps: sentenceRow.reps,
    totalReviewCount: sentenceRow.total_review_count,
    dueAt: sentenceRow.due_at || nowIso(),
    firstReviewedAt: sentenceRow.first_reviewed_at || "",
    lastReviewedAt: sentenceRow.last_reviewed_at || "",
    state: sentenceRow.state || "new",
    createdAt: sentenceRow.created_at || nowIso(),
    updatedAt: sentenceRow.updated_at || nowIso(),
  }, rating);
  const timestamp = nowIso();

  withTransaction(() => {
    updateReadingSentenceReviewStatement.run(
      nextSentence.pinyin,
      nextSentence.translation,
      nextSentence.note,
      nextSentence.ease,
      nextSentence.intervalDays,
      nextSentence.reps,
      nextSentence.totalReviewCount,
      nextSentence.dueAt,
      nextSentence.firstReviewedAt || "",
      nextSentence.lastReviewedAt || "",
      nextSentence.state,
      timestamp,
      sentenceRow.row_id,
    );
    touchUser(user.id, timestamp);
  });

  return hydrateReadingLibraryForUser(user.id);
}

export function addReadingSentenceToDeck(userSlug = DEFAULT_USER_SLUG, readingId, sentenceId, payload = {}) {
  const user = ensureUser(userSlug);
  const reading = hydrateReadingLibraryForUser(user.id).find((entry) => entry.id === String(readingId));
  if (!reading) {
    throw httpError(404, "Reading not found.");
  }

  const sentence = reading.sentences.find((entry) => entry.id === String(sentenceId));
  if (!sentence) {
    throw httpError(404, "Reading sentence not found.");
  }

  const hanzi = String(payload.hanzi || "").trim();
  if (!hanzi) {
    throw httpError(400, "A target word is required.");
  }

  const currentState = hydrateStateForUser(user.id);
  const existingCard = currentState.items.find((item) => item.hanzi === hanzi);
  const readingTag = readingTagFromSlug(reading.slug);
  const sentenceClip = createStudyClip({
    id: `${reading.id}-${sentence.id}-clip`,
    assetId: sentence.assetId || "",
    title: reading.title,
    transcript: sentence.text,
    translation: sentence.translation,
    note: sentence.note,
    sourceTitle: reading.title,
    sourceUrl: buildReadingSourceUrl(reading.id, sentence.id),
    mediaKind: sentence.mediaKind,
    storageProvider: sentence.storageProvider,
    storageKey: sentence.storageKey,
    mimeType: sentence.mimeType,
    mediaUrl: sentence.mediaUrl,
    sourceUrl: sentence.sourceUrl,
    durationMs: sentence.durationMs,
    startMs: sentence.startMs,
    endMs: sentence.endMs,
  });
  const existingClips = existingCard?.clips || [];
  const hasSentenceClipAlready = existingClips.some((clip) => clip.id === sentenceClip.id);
  const nextClips = hasSentenceClipAlready
    ? existingClips.map((clip) => (clip.id === sentenceClip.id ? sentenceClip : clip))
    : [...existingClips, sentenceClip];

  const nextCard = existingCard
    ? createChineseCard({
        ...existingCard,
        example: existingCard.example || sentence.text,
        exampleTranslation: existingCard.exampleTranslation || sentence.translation,
        tags: [...new Set([...(existingCard.tags || []), readingTag, "from-reading"])],
        clips: nextClips,
      })
    : createChineseCard({
        hanzi,
        pinyin: payload.pinyin || "",
        gloss: payload.gloss || "",
        notes: `Added from reading: ${reading.title}`,
        example: sentence.text,
        exampleTranslation: sentence.translation,
        tags: [readingTag, "from-reading"],
        clips: [sentenceClip],
        state: "new",
        dueAt: nowIso(),
      });

  return upsertStudyCard(user.slug, nextCard);
}

export function getDatabasePath() {
  return DATABASE_PATH;
}
