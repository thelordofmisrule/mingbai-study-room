import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { createStudyClip, normalizeState } from "../src/lib/studyStore.js";
import {
  dedupeEntriesByText,
  findEntriesContaining,
  parseSrt,
  pickBestTranslation,
  safeSlug,
} from "./lib/subtitles.mjs";
import {
  detectSourceArtifacts,
  readSourceManifest,
  resolveSourcePath,
} from "./lib/source-files.mjs";

function printUsage() {
  console.log(`Usage:
  npm run clips:mine -- --source-id <id> --deck <deck.json> [--source-title "Show Name"] [--source-url <url>] [--limit 4] [--padding-ms 250]
  npm run clips:mine -- --source-dir media/sources/mingbai-ep01 --deck <deck.json>
  npm run clips:mine -- --deck <deck.json> --media <video-or-audio-file> --subtitle-zh <zh.srt> [--subtitle-en <en.srt>]

Examples:
  npm run clips:mine -- --source-id mingbai-ep01 --deck exports/current-deck.json
  npm run clips:mine -- --source-id mingbai-ep01 --deck exports/current-deck.json --upload-user demo

Optional:
  --terms <terms.txt>          newline-delimited list of target words; defaults to all existing deck words
  --source-dir <dir>           defaults to media/sources/<source-id>
  --media <file>               override auto-detected media path
  --subtitle-zh <file>         override auto-detected Chinese subtitle path
  --subtitle-en <file>         override auto-detected English subtitle path
  --out-dir <dir>              defaults to public/generated-clips/<source-id>
  --output-deck <file>         defaults to exports/<source-id>-deck.json
  --limit <n>                  clips per word, default 4
  --padding-ms <n>             milliseconds added before/after subtitle timing, default 250
  --audio-format <mp3|m4a|wav> defaults to mp3
  --upload-user <slug>         upload the updated deck directly into the running API user
  --api-base <url>             defaults to http://127.0.0.1:3001/api
  --dry-run                    do everything except call ffmpeg
`);
}

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const part = argv[index];
    if (!part.startsWith("--")) continue;
    const key = part.slice(2);
    const next = argv[index + 1];

    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }

    args[key] = next;
    index += 1;
  }

  return args;
}

function mimeTypeForFormat(audioFormat) {
  if (audioFormat === "m4a") return "audio/mp4";
  if (audioFormat === "wav") return "audio/wav";
  return "audio/mpeg";
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function encoderArgsForFormat(audioFormat) {
  if (audioFormat === "m4a") return ["-c:a", "aac", "-b:a", "128k"];
  if (audioFormat === "wav") return ["-c:a", "pcm_s16le"];
  return ["-c:a", "libmp3lame", "-b:a", "128k"];
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
  });
}

async function readDeckState(deckPath) {
  const raw = await fs.readFile(deckPath, "utf8");
  return normalizeState(JSON.parse(raw));
}

async function readTargetTerms(termsPath, state) {
  if (termsPath) {
    const raw = await fs.readFile(termsPath, "utf8");
    return [...new Set(raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean))];
  }

  return [...new Set(state.items
    .map((item) => item.hanzi)
    .filter(Boolean))];
}

function findCardByTerm(state, term) {
  return state.items.find((item) => item.hanzi === term);
}

function buildOutputFilename(term, index, transcript, audioFormat) {
  const safeTerm = safeSlug(term, "term");
  const safeTranscript = safeSlug(transcript, "line").slice(0, 48);
  const order = String(index + 1).padStart(2, "0");
  return `${order}-${safeTerm}-${safeTranscript}.${audioFormat}`;
}

async function cutAudioSnippet({ mediaPath, outputPath, startMs, endMs, audioFormat, dryRun }) {
  if (dryRun) return;

  const args = [
    "-y",
    "-ss",
    (startMs / 1000).toFixed(3),
    "-to",
    (endMs / 1000).toFixed(3),
    "-i",
    mediaPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "44100",
    ...encoderArgsForFormat(audioFormat),
    outputPath,
  ];

  await runCommand("ffmpeg", args);
}

async function resolveSourceInputs(args) {
  const explicitSourceDir = args["source-dir"] ? path.resolve(String(args["source-dir"])) : "";
  const derivedSourceName = explicitSourceDir
    ? path.basename(explicitSourceDir)
    : args.media
      ? path.parse(String(args.media)).name
      : "source";
  const sourceId = safeSlug(args["source-id"] || derivedSourceName);
  const sourceDir = explicitSourceDir || path.resolve(path.join("media", "sources", sourceId));
  const sourceDirExists = await pathExists(sourceDir);
  const manifest = sourceDirExists ? await readSourceManifest(sourceDir) : null;
  const artifacts = sourceDirExists ? await detectSourceArtifacts(sourceDir) : null;

  return {
    sourceId,
    sourceDir,
    manifest,
    mediaPath: args.media
      ? path.resolve(String(args.media))
      : resolveSourcePath(sourceDir, manifest?.mediaPath) || artifacts?.mediaPath || "",
    subtitleZhPath: args["subtitle-zh"]
      ? path.resolve(String(args["subtitle-zh"]))
      : resolveSourcePath(sourceDir, manifest?.subtitles?.zh) || artifacts?.subtitles?.zh || "",
    subtitleEnPath: args["subtitle-en"]
      ? path.resolve(String(args["subtitle-en"]))
      : resolveSourcePath(sourceDir, manifest?.subtitles?.en) || artifacts?.subtitles?.en || "",
  };
}

async function uploadStudyState({ apiBase, state, userSlug }) {
  const response = await fetch(`${String(apiBase || "http://127.0.0.1:3001/api").replace(/\/+$/u, "")}/users/${encodeURIComponent(userSlug)}/study-state`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ state }),
  });

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : null;

  if (!response.ok) {
    throw new Error(payload?.error || `Upload failed with status ${response.status}.`);
  }

  return payload;
}

const args = parseArgs(process.argv.slice(2));

if (args.help || args.h) {
  printUsage();
  process.exit(0);
}

if (!args.deck) {
  printUsage();
  process.exit(1);
}

if (!args["source-id"] && !args["source-dir"] && (!args.media || !args["subtitle-zh"])) {
  printUsage();
  process.exit(1);
}

const deckPath = path.resolve(String(args.deck));
const sourceInputs = await resolveSourceInputs(args);
const { sourceId, sourceDir, manifest, mediaPath, subtitleZhPath, subtitleEnPath } = sourceInputs;

if (!mediaPath || !subtitleZhPath) {
  const missing = [
    !mediaPath ? "media file" : "",
    !subtitleZhPath ? "Chinese subtitle file" : "",
  ].filter(Boolean);
  throw new Error(`Could not resolve ${missing.join(" and ")} for ${sourceDir}. Pass --media/--subtitle-zh explicitly or download the source first.`);
}

const outputDir = path.resolve(args["out-dir"] || path.join("public", "generated-clips", sourceId));
const outputDeckPath = path.resolve(args["output-deck"] || path.join("exports", `${sourceId}-deck.json`));
const limitPerWord = Math.max(1, Number(args.limit) || 4);
const paddingMs = Math.max(0, Number(args["padding-ms"]) || 250);
const audioFormat = ["mp3", "m4a", "wav"].includes(String(args["audio-format"] || "mp3"))
  ? String(args["audio-format"] || "mp3")
  : "mp3";
const sourceTitle = String(args["source-title"] || manifest?.sourceTitle || sourceId).trim();
const sourceUrl = String(args["source-url"] || manifest?.sourceUrl || "").trim();
const uploadUser = String(args["upload-user"] || "").trim();
const apiBase = String(args["api-base"] || "http://127.0.0.1:3001/api").trim();
const dryRun = Boolean(args["dry-run"]);

if (dryRun && uploadUser) {
  throw new Error("Cannot upload a dry-run result. Remove --dry-run or skip --upload-user.");
}

const [deckState, zhRaw, enRaw] = await Promise.all([
  readDeckState(deckPath),
  fs.readFile(subtitleZhPath, "utf8"),
  subtitleEnPath ? fs.readFile(subtitleEnPath, "utf8") : Promise.resolve(""),
]);

const zhEntries = parseSrt(zhRaw);
const enEntries = enRaw ? parseSrt(enRaw) : [];
const targetTerms = await readTargetTerms(args.terms, deckState);

await fs.mkdir(outputDir, { recursive: true });
await fs.mkdir(path.dirname(outputDeckPath), { recursive: true });

const nextState = normalizeState(deckState);
const results = [];

for (const term of targetTerms) {
  const card = findCardByTerm(nextState, term);
  if (!card) {
    results.push({ term, generated: 0, skipped: "missing-card" });
    continue;
  }

  const remainingSlots = Math.max(0, limitPerWord - card.clips.length);
  if (remainingSlots === 0) {
    results.push({ term, generated: 0, skipped: "limit-reached" });
    continue;
  }

  const hits = dedupeEntriesByText(findEntriesContaining(zhEntries, term)).slice(0, remainingSlots);

  let generated = 0;

  for (const [index, hit] of hits.entries()) {
    const clipStartMs = Math.max(0, hit.startMs - paddingMs);
    const clipEndMs = hit.endMs + paddingMs;
    const translation = pickBestTranslation(hit, enEntries)?.text || "";
    const filename = buildOutputFilename(term, index, hit.text, audioFormat);
    const outputPath = path.join(outputDir, filename);
    const storageKey = path.posix.join("generated-clips", sourceId, filename);
    const mediaUrl = `/${storageKey}`;

    await cutAudioSnippet({
      mediaPath,
      outputPath,
      startMs: clipStartMs,
      endMs: clipEndMs,
      audioFormat,
      dryRun,
    });

    const clip = createStudyClip({
      title: `${sourceTitle} · ${index + 1}`,
      transcript: hit.text,
      translation,
      sourceTitle,
      sourceUrl,
      mediaKind: "audio",
      storageProvider: dryRun ? "planned" : "public",
      storageKey,
      mimeType: mimeTypeForFormat(audioFormat),
      mediaUrl,
      startMs: clipStartMs,
      endMs: clipEndMs,
      durationMs: clipEndMs - clipStartMs,
      note: `Subtitle hit for ${term}`,
    });

    const duplicate = card.clips.some((existingClip) => (
      existingClip.storageKey === clip.storageKey
      || (existingClip.transcript === clip.transcript && existingClip.sourceTitle === clip.sourceTitle)
    ));

    if (!duplicate) {
      card.clips.push(clip);
      generated += 1;
    }
  }

  results.push({ term, generated, matches: hits.length });
}

await fs.writeFile(outputDeckPath, `${JSON.stringify(nextState, null, 2)}\n`);

if (uploadUser) {
  await uploadStudyState({
    apiBase,
    state: nextState,
    userSlug: uploadUser,
  });
}

console.log("");
console.log(`Updated deck written to ${outputDeckPath}`);
console.log(`Clip output directory: ${outputDir}`);
if (uploadUser) {
  console.log(`Uploaded deck to ${apiBase.replace(/\/+$/u, "")}/users/${encodeURIComponent(uploadUser)}/study-state`);
}
console.log("");
console.table(results);
