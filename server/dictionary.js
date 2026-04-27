import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_CEDICT_PATH = process.env.CC_CEDICT_PATH || path.join(process.cwd(), "data", "dictionaries", "cc-cedict", "cedict_ts.u8");

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeToneSyllable(syllable = "") {
  const raw = String(syllable || "").trim().toLowerCase();
  if (!raw) return "";

  const match = raw.match(/^([a-züv:]+)([1-5])$/u);
  if (!match) {
    return raw.replace(/u:|v/gu, "ü");
  }

  const [, lettersRaw, toneRaw] = match;
  const tone = Number(toneRaw || 5);
  let letters = lettersRaw.replace(/u:|v/gu, "ü");

  if (tone === 5 || tone === 0) {
    return letters;
  }

  const accentMap = {
    a: ["a", "ā", "á", "ǎ", "à"],
    e: ["e", "ē", "é", "ě", "è"],
    i: ["i", "ī", "í", "ǐ", "ì"],
    o: ["o", "ō", "ó", "ǒ", "ò"],
    u: ["u", "ū", "ú", "ǔ", "ù"],
    ü: ["ü", "ǖ", "ǘ", "ǚ", "ǜ"],
  };

  const priority = letters.includes("a")
    ? "a"
    : letters.includes("e")
      ? "e"
      : letters.includes("ou")
        ? "o"
        : [...letters].reverse().find((char) => Object.hasOwn(accentMap, char));

  if (!priority || !accentMap[priority]) {
    return letters;
  }

  const accent = accentMap[priority][tone] || priority;
  let replaced = false;
  return [...letters].map((char) => {
    if (char === priority && !replaced) {
      replaced = true;
      return accent;
    }
    return char;
  }).join("");
}

export function numberedPinyinToToneMarks(pinyin = "") {
  return String(pinyin || "")
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .map(normalizeToneSyllable)
    .join(" ");
}

function normalizeDefinitionForDisplay(definition = "") {
  return String(definition || "")
    .replace(/\[[^\]]+\]/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([+(),.:;])/g, "$1")
    .trim();
}

function classifyDefinition(definition = "") {
  const lower = String(definition || "").trim().toLowerCase();
  if (!lower) return "other";
  if (
    lower.includes("used to put the object before the verb")
    || lower.startsWith("(used to ")
    || lower.includes("structural particle")
    || lower.startsWith("particle:")
    || lower.startsWith("particle ")
    || lower.includes("used after a verb")
  ) return "grammar";
  if (lower.startsWith("classifier")) return "classifier";
  if (
    lower.includes("press charges")
    || lower.includes("file a complaint")
    || lower.includes("lawsuit")
    || lower.includes("prosecution")
    || lower.includes("indictment")
  ) return "legal";
  if (lower.startsWith("variant of ") || lower.startsWith("old variant of ") || lower.startsWith("surname ")) return "reference";
  return "lexical";
}

function displayDefinitionScore(definition = "") {
  const raw = String(definition || "").trim();
  const lower = raw.toLowerCase();
  const kind = classifyDefinition(lower);
  const parts = raw
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const scoredParts = (parts.length ? parts : [raw]).map((part) => {
    const normalized = part.toLowerCase();
    const words = normalized
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/u)
      .filter(Boolean);

    let score = 0;
    if (words.length <= 2) score += 3;
    else if (words.length <= 4) score += 2;
    else if (words.length <= 7) score += 1;

    if (normalized.startsWith("to ")) score += 1;
    if (normalized.startsWith("(used to ")) score += 2;
    return score;
  });

  let score = 0;
  if (kind === "grammar") score += 8;
  if (kind === "lexical") score += 6;
  if (kind === "classifier") score += 2;
  if (kind === "legal") score -= 4;
  if (kind === "reference") score -= 8;

  score += Math.max(...scoredParts);
  if (parts.length > 1) score += Math.min(3, parts.length);
  if (lower.includes("hold a baby in position")) score -= 3;
  return score;
}

export function buildDisplayGloss(definitions = [], limit = 3) {
  const candidates = definitions
    .map(normalizeDefinitionForDisplay)
    .filter(Boolean)
    .map((text, index) => ({
      text,
      index,
      kind: classifyDefinition(text),
      score: displayDefinitionScore(text),
    }));

  if (!candidates.length) return "";

  const selected = [];

  const firstCandidate = candidates.find((entry) => entry.kind !== "reference") || candidates[0];
  if (firstCandidate) {
    selected.push(firstCandidate);
  }

  const bestGrammar = candidates
    .filter((entry) => entry.kind === "grammar")
    .sort((left, right) => right.score - left.score || left.index - right.index)[0];
  if (bestGrammar && !selected.some((entry) => entry.text === bestGrammar.text)) {
    selected.push(bestGrammar);
  }

  const remaining = candidates
    .filter((entry) => !selected.some((picked) => picked.text === entry.text))
    .sort((left, right) => right.score - left.score || left.index - right.index);

  for (const entry of remaining) {
    if (selected.length >= limit) break;
    selected.push(entry);
  }

  return selected
    .slice(0, limit)
    .map((entry) => entry.text)
    .join("\n");
}

export function parseCedictLine(line = "") {
  const trimmed = String(line || "").trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const match = trimmed.match(/^(\S+)\s+(\S+)\s+\[(.+?)\]\s+\/(.+)\/$/u);
  if (!match) return null;

  const [, traditional, simplified, pinyinNumbered, definitionRaw] = match;
  const definitions = definitionRaw
    .split("/")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (!definitions.length) return null;

  return {
    traditional,
    simplified,
    pinyinNumbered,
    pinyin: numberedPinyinToToneMarks(pinyinNumbered),
    definitions,
    gloss: buildDisplayGloss(definitions),
  };
}

let dictionaryCache = {
  path: "",
  mtimeMs: 0,
  bySimplified: new Map(),
  byTraditional: new Map(),
  maxTermLength: 1,
};

function addEntryToIndex(index, key, entry) {
  if (!key) return;
  const existing = index.get(key) || [];
  existing.push(entry);
  index.set(key, existing);
}

async function loadCedictIndex() {
  const dictionaryPath = DEFAULT_CEDICT_PATH;
  let stat;
  try {
    stat = await fs.stat(dictionaryPath);
  } catch {
    throw httpError(
      503,
      "Local CC-CEDICT is not installed yet. Download the CC-CEDICT .txt.gz file manually, then run `npm run dict:install -- --file /path/to/cedict_1_0_ts_utf-8_mdbg.txt.gz`.",
    );
  }

  if (
    dictionaryCache.path === dictionaryPath
    && dictionaryCache.mtimeMs === stat.mtimeMs
    && dictionaryCache.bySimplified.size > 0
  ) {
    return dictionaryCache;
  }

  const source = await fs.readFile(dictionaryPath, "utf8");
  const bySimplified = new Map();
  const byTraditional = new Map();
  let maxTermLength = 1;

  for (const line of source.split(/\r?\n/u)) {
    const entry = parseCedictLine(line);
    if (!entry) continue;
    addEntryToIndex(bySimplified, entry.simplified, entry);
    addEntryToIndex(byTraditional, entry.traditional, entry);
    maxTermLength = Math.max(maxTermLength, entry.simplified.length, entry.traditional.length);
  }

  dictionaryCache = {
    path: dictionaryPath,
    mtimeMs: stat.mtimeMs,
    bySimplified,
    byTraditional,
    maxTermLength,
  };

  return dictionaryCache;
}

function scoreDefinitionPart(definition = "") {
  const lower = String(definition || "").trim().toLowerCase();
  if (!lower) return 0;
  if (lower.startsWith("surname ")) return -8;
  if (lower.startsWith("variant of ") || lower.startsWith("old variant of ")) return -7;
  if (lower.startsWith("see also ") || lower.startsWith("see ")) return -4;
  if (lower.startsWith("used in ")) return -3;
  if (lower.startsWith("classifier for ")) return -2;
  if (
    lower.includes("press charges")
    || lower.includes("file a complaint")
    || lower.includes("lawsuit")
    || lower.includes("prosecution")
    || lower.includes("indictment")
  ) {
    return -4;
  }

  const words = lower
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/u)
    .filter(Boolean);

  let score = 0;
  if (classifyDefinition(lower) === "grammar") score += 6;
  if (words.length <= 1) score += 4;
  else if (words.length === 2) score += 3;
  else if (words.length === 3) score += 2;
  else if (words.length <= 5) score += 1;

  score += lower.startsWith("to ") ? 1 : 2;
  return score;
}

function scoreDefinitionGloss(definition = "") {
  const parts = String(definition || "")
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (!parts.length) {
    return scoreDefinitionPart(definition);
  }

  return parts
    .map(scoreDefinitionPart)
    .sort((left, right) => right - left)
    .slice(0, 3)
    .reduce((sum, value) => sum + value, 0);
}

export function scoreDictionaryEntry(entry, term = "") {
  let score = 0;
  if (entry.simplified === term) score += 8;
  if (entry.traditional === term) score += 6;

  const firstDefinition = entry.definitions[0] || "";
  score += scoreDefinitionGloss(firstDefinition);

  if (entry.definitions.some((definition) => !String(definition || "").trim().toLowerCase().startsWith("to "))) {
    score += 2;
  }

  // A small penalty for very long gloss lists keeps focused entries ahead
  // without burying common multi-sense words like 结果 beneath niche verb readings.
  score -= Math.min(1, Math.max(0, entry.definitions.length - 4));
  return score;
}

export async function lookupDictionaryEntries(term = "", options = {}) {
  const needle = String(term || "").trim();
  if (!needle) {
    throw httpError(400, "A dictionary lookup term is required.");
  }

  const { bySimplified, byTraditional } = await loadCedictIndex();
  const limit = Math.max(1, Math.min(12, Number(options.limit) || 6));
  const combined = [...(bySimplified.get(needle) || []), ...(byTraditional.get(needle) || [])];
  return rankDictionaryEntries(combined, needle).slice(0, limit);
}

function rankDictionaryEntries(entries = [], term = "") {
  const deduped = [];
  const seen = new Set();
  for (const entry of entries) {
    const key = `${entry.traditional}|${entry.simplified}|${entry.pinyinNumbered}|${entry.gloss}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(entry);
  }

  return deduped
    .sort((left, right) => scoreDictionaryEntry(right, term) - scoreDictionaryEntry(left, term))
    .slice();
}

export async function buildSentencePinyin(text = "") {
  const source = String(text || "").trim();
  if (!source) return "";

  const { bySimplified, byTraditional, maxTermLength } = await loadCedictIndex();
  const chars = [...source];
  const parts = [];
  let index = 0;

  while (index < chars.length) {
    const char = chars[index];

    if (/\s/u.test(char)) {
      parts.push(char);
      index += 1;
      continue;
    }

    if (!/\p{Script=Han}/u.test(char)) {
      parts.push(char);
      index += 1;
      continue;
    }

    let matchedEntry = null;
    let matchedLength = 0;
    const remaining = chars.length - index;
    const searchLength = Math.min(maxTermLength, remaining);

    for (let length = searchLength; length >= 1; length -= 1) {
      const term = chars.slice(index, index + length).join("");
      const matches = rankDictionaryEntries([
        ...(bySimplified.get(term) || []),
        ...(byTraditional.get(term) || []),
      ], term);

      if (matches.length) {
        matchedEntry = matches[0];
        matchedLength = length;
        break;
      }
    }

    if (!matchedEntry || !matchedLength) {
      parts.push(char);
      index += 1;
      continue;
    }

    parts.push(matchedEntry.pinyin);
    index += matchedLength;
  }

  return parts
    .join(" ")
    .replace(/\s+([,.;!?，。！？；：、])/gu, "$1")
    .replace(/([([{<"'“‘])\s+/gu, "$1")
    .replace(/\s+([)\]}>"'”’])/gu, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function getCedictPath() {
  return DEFAULT_CEDICT_PATH;
}
