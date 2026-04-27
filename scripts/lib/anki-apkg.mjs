import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  createChineseCard,
  createStudyClip,
  createSeededState,
  normalizeState,
} from "../../src/lib/studyStore.js";

const FIELD_ARRAY_SQL = "'[' || replace(json_quote(flds), '\\u001f', '\",\"') || ']'";
const BLOCK_BREAK_TAGS = /<(?:\/?(?:p|div|li|ol|ul|tr|table|dd|dt|dl|br|h[1-6])[^>]*)>/gi;
const TAG_PATTERN = /<[^>]+>/g;
const SOUND_PATTERN = /\[sound:([^\]]+)\]/i;
const AUDIO_FILENAME_PATTERN = /\.(mp3|m4a|aac|wav|oga|opus|flac)$/i;
const ENTITY_MAP = new Map([
  ["amp", "&"],
  ["apos", "'"],
  ["gt", ">"],
  ["lt", "<"],
  ["nbsp", " "],
  ["quot", "\""],
]);

function runCommand(command, args, { captureStdout = true, text = true } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: captureStdout ? ["ignore", "pipe", "pipe"] : "inherit",
    });

    const stdoutChunks = [];
    const stderrChunks = [];

    if (captureStdout) {
      child.stdout.on("data", (chunk) => {
        stdoutChunks.push(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderrChunks.push(chunk);
      });
    }

    child.on("error", reject);
    child.on("close", (code) => {
      const stdout = Buffer.concat(stdoutChunks);
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      if (code === 0) {
        resolve(text ? stdout.toString("utf8") : stdout);
      } else {
        reject(new Error(`${command} exited with code ${code}.${stderr ? ` ${stderr.trim()}` : ""}`));
      }
    });
  });
}

function decodeHtmlEntities(text) {
  return String(text || "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    const lower = String(entity || "").toLowerCase();
    if (ENTITY_MAP.has(lower)) {
      return ENTITY_MAP.get(lower);
    }

    if (lower.startsWith("#x")) {
      const codePoint = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    if (lower.startsWith("#")) {
      const codePoint = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    return match;
  });
}

function normalizeWhitespace(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function slugify(value, fallback = "anki-import") {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

function safeMediaFilename(filename = "", entryKey = "media") {
  const ext = path.extname(String(filename || "")).toLowerCase();
  const base = path.basename(String(filename || ""), ext)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const safeBase = base || "audio";
  return `${entryKey}-${safeBase}${ext || ".bin"}`;
}

function mimeTypeForAudioFilename(filename = "") {
  const ext = path.extname(String(filename || "")).toLowerCase();
  if (ext === ".m4a") return "audio/mp4";
  if (ext === ".aac") return "audio/aac";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".oga" || ext === ".opus") return "audio/ogg";
  if (ext === ".flac") return "audio/flac";
  return "audio/mpeg";
}

export function stripHtmlToText(html = "", { preserveNewlines = true } = {}) {
  const withBreaks = String(html || "")
    .replace(BLOCK_BREAK_TAGS, "\n")
    .replace(TAG_PATTERN, "");
  const decoded = decodeHtmlEntities(withBreaks);
  return preserveNewlines
    ? normalizeWhitespace(decoded)
    : normalizeWhitespace(decoded).replace(/\n+/g, " ");
}

export function extractSoundFilename(markup = "") {
  return String(markup || "").match(SOUND_PATTERN)?.[1] || "";
}

export function buildAnkiWordAudioClip({ noteId, deckTitle, mediaUrl, storageKey, filename }) {
  return createStudyClip({
    id: `anki-audio-${noteId}`,
    assetId: `anki-audio-${noteId}`,
    title: "Word audio",
    mediaKind: "audio",
    mimeType: mimeTypeForAudioFilename(filename),
    mediaUrl,
    storageProvider: "local",
    storageKey,
    sourceTitle: "",
    note: "",
  });
}

export function summarizeGloss(text = "", maxLength = 220) {
  const normalized = normalizeWhitespace(String(text || "").replace(/\n+/g, " "));
  if (normalized.length <= maxLength) return normalized;

  const truncated = normalized.slice(0, maxLength);
  const breakIndex = Math.max(
    truncated.lastIndexOf("; "),
    truncated.lastIndexOf(". "),
    truncated.lastIndexOf(", "),
    truncated.lastIndexOf(" "),
  );

  return `${truncated.slice(0, breakIndex > 80 ? breakIndex : maxLength).trim()}...`;
}

function cleanPinyinText(text = "") {
  return normalizeWhitespace(String(text || "").replace(/\([^)]*\)/g, "").replace(/\s*,\s*/g, ", "));
}

function htmlCellValue(rowHtml, className) {
  const pattern = new RegExp(`<td[^>]*class=['"][^'"]*\\b${className}\\b[^'"]*['"][^>]*>([\\s\\S]*?)<\\/td>`, "i");
  return rowHtml.match(pattern)?.[1] || "";
}

function sentenceCore(text = "") {
  return normalizeWhitespace(String(text || "").replace(/[。！？!?；;，,、]/g, ""));
}

export function extractExampleRows(examplesHtml = "") {
  const rows = [];
  const rawRows = String(examplesHtml || "").match(/<tr[\s\S]*?<\/tr>/gi) || [];

  for (const rowHtml of rawRows) {
    const hanzi = stripHtmlToText(htmlCellValue(rowHtml, "kan"), { preserveNewlines: false });
    const pinyin = cleanPinyinText(stripHtmlToText(htmlCellValue(rowHtml, "rom"), { preserveNewlines: false }));
    const translation = stripHtmlToText(htmlCellValue(rowHtml, "eng"));

    if (!hanzi && !translation) continue;

    rows.push({
      hanzi,
      pinyin,
      translation: normalizeWhitespace(translation.replace(/\n+/g, " / ")),
    });
  }

  return rows;
}

function rankBucket(rank) {
  if (rank > 0 && rank <= 1000) return "top-1000";
  if (rank > 0 && rank <= 3000) return "top-3000";
  return "top-5000";
}

function choosePrimaryExample(rows, hanzi) {
  if (!rows.length) return { primary: null, extras: [] };

  const scored = rows
    .map((row, index) => {
      const core = sentenceCore(row.hanzi);
      const isBareWord = core === hanzi || core.length <= Math.max(1, hanzi.length);
      const score = (isBareWord ? 0 : 1000) + core.length - index;
      return { row, index, score };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index);

  const primary = scored[0]?.row || null;
  const extras = rows.filter((row) => row !== primary);
  return { primary, extras };
}

function parseAnkiTags(rawTags = "") {
  return [...new Set(
    String(rawTags || "")
      .split(/\s+/)
      .map((tag) => tag.trim())
      .filter(Boolean),
  )];
}

function buildImportedNotes({ deckTitle, rank }) {
  return normalizeWhitespace(rank ? `Frequency rank: ${rank}` : "");
}

export function stripImportedDeckLabel(text = "") {
  const lines = String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^Imported from .+\.$/i.test(line));
  return normalizeWhitespace(lines.join("\n\n"));
}

export function buildCardFromAnkiRow(row, { deckTitle = "Anki deck", audioClip = null } = {}) {
  const hanzi = normalizeWhitespace(String(row.word || ""));
  const plainMeaning = stripHtmlToText(row.meanings);
  const pinyin = cleanPinyinText(stripHtmlToText(row.pinyin, { preserveNewlines: false }));
  const examples = extractExampleRows(row.examples);
  const { primary } = choosePrimaryExample(examples, hanzi);
  const rank = Number(row.rank) || 0;
  const audioClips = audioClip ? [audioClip] : [];

  return createChineseCard({
    id: `anki-${row.noteId}`,
    hanzi,
    pinyin,
    gloss: summarizeGloss(plainMeaning),
    notes: buildImportedNotes({ deckTitle, rank }),
    example: primary?.hanzi || "",
    examplePinyin: primary?.pinyin || "",
    exampleTranslation: primary?.translation || "",
    tags: [
      "anki-import",
      "frequency-list",
      rankBucket(rank),
      ...parseAnkiTags(row.tags),
    ],
    clips: audioClips,
    state: "new",
    dueAt: new Date().toISOString(),
  });
}

export function mergeImportedCards(baseState, importedCards) {
  const normalizedBase = normalizeState(baseState || createSeededState());
  const importedByHanzi = new Map(importedCards.map((card) => [card.hanzi, card]));
  const mergedItems = [];
  let mergedExisting = 0;

  for (const existing of normalizedBase.items) {
    const imported = importedByHanzi.get(existing.hanzi);
    if (!imported) {
      mergedItems.push(existing);
      continue;
    }

    importedByHanzi.delete(existing.hanzi);
    mergedExisting += 1;

    const existingNotes = stripImportedDeckLabel(existing.notes);
    const importedNotes = stripImportedDeckLabel(imported.notes);
    const mergedNotes = [existingNotes, importedNotes]
      .filter(Boolean)
      .filter((note, index, values) => values.indexOf(note) === index)
      .join("\n\n");

    const mergedClips = [...existing.clips];
    for (const clip of imported.clips) {
      const duplicate = mergedClips.some((existingClip) => (
        (
          existingClip.transcript === clip.transcript
          && existingClip.translation === clip.translation
          && (existingClip.transcript || existingClip.translation)
        )
        || (
          !existingClip.transcript
          && !existingClip.translation
          && !clip.transcript
          && !clip.translation
          && (
            (existingClip.mediaUrl && existingClip.mediaUrl === clip.mediaUrl)
            || existingClip.title === clip.title
          )
        )
      ));
      if (!duplicate) {
        mergedClips.push(clip);
      }
    }

    mergedItems.push(createChineseCard({
      ...existing,
      pinyin: existing.pinyin || imported.pinyin,
      gloss: existing.gloss || imported.gloss,
      notes: mergedNotes,
      example: existing.example || imported.example,
      examplePinyin: existing.examplePinyin || imported.examplePinyin,
      exampleTranslation: existing.exampleTranslation || imported.exampleTranslation,
      tags: [...new Set([...(existing.tags || []), ...(imported.tags || [])])],
      clips: mergedClips,
    }));
  }

  for (const imported of importedByHanzi.values()) {
    mergedItems.push(imported);
  }

  return {
    state: normalizeState({
      ...normalizedBase,
      items: mergedItems,
      updatedAt: new Date().toISOString(),
    }),
    mergedExisting,
    addedNew: importedByHanzi.size,
  };
}

function fieldExpression(ord, alias) {
  if (ord === undefined || ord === null) {
    return `'' as "${alias}"`;
  }
  return `json_extract(${FIELD_ARRAY_SQL}, '$[${ord}]') as "${alias}"`;
}

async function queryJson(dbPath, sql) {
  const raw = await runCommand("sqlite3", ["-json", dbPath, sql]);
  return JSON.parse(raw || "[]");
}

export async function loadApkgModels(collectionPath) {
  const rows = await queryJson(collectionPath, "select models from col;");
  return JSON.parse(rows[0]?.models || "{}");
}

export function chooseAnkiModel(models, { modelId = "", modelName = "" } = {}) {
  if (modelId && models[modelId]) {
    return models[modelId];
  }

  const allModels = Object.values(models);
  if (modelName) {
    const exact = allModels.find((model) => String(model.name).toLowerCase() === String(modelName).toLowerCase());
    if (exact) return exact;
  }

  return allModels.find((model) => {
    const fieldNames = new Set((model.flds || []).map((field) => String(field.name || "").toLowerCase()));
    return fieldNames.has("word") && fieldNames.has("meanings") && fieldNames.has("pinyin");
  }) || null;
}

export async function loadAnkiNotes(collectionPath, model) {
  const fieldOrdByName = Object.fromEntries((model.flds || []).map((field) => [field.name, field.ord]));
  const selectSql = [
    'select id as "noteId", tags,',
    fieldExpression(fieldOrdByName["Frequency Rank of Word"], "rank"),
    ",",
    fieldExpression(fieldOrdByName.Word, "word"),
    ",",
    fieldExpression(fieldOrdByName.Meanings, "meanings"),
    ",",
    fieldExpression(fieldOrdByName.Pinyin, "pinyin"),
    ",",
    fieldExpression(fieldOrdByName["Example Sentences"], "examples"),
    ",",
    fieldExpression(fieldOrdByName["Audio of Word"], "audio"),
    `from notes where mid=${Number(model.id)};`,
  ].join(" ");

  return queryJson(collectionPath, selectSql);
}

export async function prepareApkgImport(apkgPath) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mingbai-anki-"));
  const collectionPath = path.join(tempDir, "collection.anki2");
  const mediaPath = path.join(tempDir, "media.json");

  try {
    const collectionBuffer = await runCommand("unzip", ["-p", apkgPath, "collection.anki2"], { text: false });
    await fs.writeFile(collectionPath, collectionBuffer);

    try {
      const mediaRaw = await runCommand("unzip", ["-p", apkgPath, "media"]);
      await fs.writeFile(mediaPath, mediaRaw);
    } catch {
      await fs.writeFile(mediaPath, "{}\n");
    }

    await runCommand("unzip", ["-qq", "-o", apkgPath, "-d", tempDir], { captureStdout: false });

    const mediaMap = JSON.parse(await fs.readFile(mediaPath, "utf8"));

    return {
      cleanup: () => fs.rm(tempDir, { recursive: true, force: true }),
      collectionPath,
      mediaMap,
      mediaEntryByFilename: new Map(Object.entries(mediaMap).map(([entryKey, filename]) => [String(filename), String(entryKey)])),
      mediaRootDir: tempDir,
      tempDir,
    };
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

export async function materializeAnkiAudio({
  prepared,
  apkgPath,
  rows,
  deckTitle,
  outputRootDir = path.resolve("public/imported-audio/anki"),
}) {
  const deckSlug = slugify(deckTitle || path.basename(apkgPath || "", ".apkg"), "anki-import");
  const deckDir = path.join(outputRootDir, deckSlug);
  await fs.mkdir(deckDir, { recursive: true });

  const attachmentsByNoteId = new Map();

  for (const row of rows) {
    const filename = extractSoundFilename(row.audio);
    if (!filename || !AUDIO_FILENAME_PATTERN.test(filename)) continue;

    const entryKey = prepared.mediaEntryByFilename.get(filename);
    if (!entryKey) continue;

    const sourcePath = path.join(prepared.mediaRootDir, entryKey);
    const targetFilename = safeMediaFilename(filename, entryKey);
    const targetPath = path.join(deckDir, targetFilename);

    try {
      await fs.copyFile(sourcePath, targetPath);
    } catch {
      continue;
    }

    const storageKey = path.posix.join("imported-audio", "anki", deckSlug, targetFilename);
    attachmentsByNoteId.set(String(row.noteId), {
      filename,
      mediaUrl: `/${storageKey}`,
      storageKey,
    });
  }

  return attachmentsByNoteId;
}
