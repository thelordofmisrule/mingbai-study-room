import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const DEFAULT_AZURE_SPEECH_VOICE = "zh-CN-XiaoxiaoNeural";
const DEFAULT_OUTPUT_FORMAT = "audio-16khz-128kbitrate-mono-mp3";
const GENERATED_TTS_ROOT = path.join(process.cwd(), "public", "generated-tts", "azure");

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export function sanitizePathSegment(raw = "", fallback = "audio") {
  const value = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return value || fallback;
}

export function escapeSsmlText(raw = "") {
  return String(raw || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function buildAzureSpeechConfig(env = process.env) {
  const key = String(env.AZURE_SPEECH_KEY || env.SPEECH_KEY || "").trim();
  const region = String(env.AZURE_SPEECH_REGION || env.SPEECH_REGION || "").trim();
  const endpoint = String(env.AZURE_SPEECH_ENDPOINT || env.SPEECH_ENDPOINT || "").trim();
  const voiceName = String(env.AZURE_SPEECH_VOICE || env.SPEECH_VOICE || DEFAULT_AZURE_SPEECH_VOICE).trim();
  const outputFormat = String(env.AZURE_SPEECH_OUTPUT_FORMAT || DEFAULT_OUTPUT_FORMAT).trim() || DEFAULT_OUTPUT_FORMAT;
  const resolvedEndpoint = endpoint || (region ? `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1` : "");

  return {
    configured: !!(key && resolvedEndpoint),
    key,
    region,
    endpoint: resolvedEndpoint,
    endpointConfigured: !!endpoint,
    voiceName,
    outputFormat,
  };
}

export function buildHeadwordSsml(text, voiceName = DEFAULT_AZURE_SPEECH_VOICE) {
  return [
    "<speak version=\"1.0\" xml:lang=\"zh-CN\">",
    `  <voice name="${escapeSsmlText(voiceName)}">`,
    `    ${escapeSsmlText(text)}`,
    "  </voice>",
    "</speak>",
  ].join("\n");
}

function buildGeneratedCardAudioPaths({ userSlug, cardId, variant = "headword" }) {
  const safeUser = sanitizePathSegment(userSlug, "demo");
  const safeCard = sanitizePathSegment(cardId, "card");
  const safeVariant = sanitizePathSegment(variant, "audio");
  const hash = createHash("sha1").update(`${String(cardId || "")}:${safeVariant}`).digest("hex").slice(0, 10);
  const fileName = `${safeCard}-${safeVariant}-${hash}.mp3`;
  const relativePath = path.posix.join("generated-tts", "azure", safeUser, fileName);
  return {
    storageKey: relativePath,
    mediaUrl: `/${relativePath}`,
    filePath: path.join(GENERATED_TTS_ROOT, safeUser, fileName),
  };
}

export function buildGeneratedHeadwordAudioPaths({ userSlug, cardId }) {
  return buildGeneratedCardAudioPaths({ userSlug, cardId, variant: "headword" });
}

export function buildGeneratedExampleAudioPaths({ userSlug, cardId }) {
  return buildGeneratedCardAudioPaths({ userSlug, cardId, variant: "example" });
}

export function buildGeneratedReadingSentenceAudioPaths({ userSlug, readingId, sentenceId }) {
  const safeUser = sanitizePathSegment(userSlug, "demo");
  const safeReading = sanitizePathSegment(readingId, "reading");
  const safeSentence = sanitizePathSegment(sentenceId, "sentence");
  const hash = createHash("sha1").update(`${safeReading}:${safeSentence}:reading-sentence`).digest("hex").slice(0, 10);
  const fileName = `${safeReading}-${safeSentence}-${hash}.mp3`;
  const relativePath = path.posix.join("generated-tts", "azure", safeUser, "readings", fileName);
  return {
    storageKey: relativePath,
    mediaUrl: `/${relativePath}`,
    filePath: path.join(GENERATED_TTS_ROOT, safeUser, "readings", fileName),
  };
}

export function getAzureSpeechStatus(env = process.env) {
  const config = buildAzureSpeechConfig(env);
  return {
    configured: config.configured,
    voiceName: config.voiceName,
    region: config.region,
    usesCustomEndpoint: config.endpointConfigured,
  };
}

async function synthesizeAzureTextAudio({
  text,
  userSlug,
  cardId,
  voiceName,
  variant = "headword",
  emptyMessage = "There is no text to synthesize.",
} = {}) {
  const safeText = String(text || "").trim();
  if (!safeText) {
    throw httpError(400, emptyMessage);
  }

  const config = buildAzureSpeechConfig(process.env);
  if (!config.configured) {
    throw httpError(
      400,
      "Azure Speech is not configured. Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION in .env.local or your shell environment.",
    );
  }

  const resolvedVoice = String(voiceName || config.voiceName || DEFAULT_AZURE_SPEECH_VOICE).trim();
  const ssml = buildHeadwordSsml(safeText, resolvedVoice);
  const paths = buildGeneratedCardAudioPaths({ userSlug, cardId, variant });

  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/ssml+xml",
      "Ocp-Apim-Subscription-Key": config.key,
      "X-Microsoft-OutputFormat": config.outputFormat,
      "User-Agent": "mingbai-study-room",
    },
    body: ssml,
  });

  if (!response.ok) {
    const body = (await response.text()).trim();
    throw httpError(502, `Azure Speech synthesis failed (${response.status}). ${body || "No error details returned."}`);
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());
  await fs.mkdir(path.dirname(paths.filePath), { recursive: true });
  await fs.writeFile(paths.filePath, audioBuffer);

  return {
    ...paths,
    mediaKind: "audio",
    mimeType: "audio/mpeg",
    storageProvider: "local",
    durationMs: 0,
    startMs: 0,
    endMs: 0,
    sourceTitle: `Azure TTS · ${resolvedVoice}`,
    sourceUrl: "",
    voiceName: resolvedVoice,
  };
}

export async function synthesizeAzureHeadwordAudio({ text, userSlug, cardId, voiceName } = {}) {
  return synthesizeAzureTextAudio({
    text,
    userSlug,
    cardId,
    voiceName,
    variant: "headword",
    emptyMessage: "There is no headword text to synthesize.",
  });
}

export async function synthesizeAzureExampleAudio({ text, userSlug, cardId, voiceName } = {}) {
  return synthesizeAzureTextAudio({
    text,
    userSlug,
    cardId,
    voiceName,
    variant: "example",
    emptyMessage: "There is no example sentence text to synthesize.",
  });
}

export async function synthesizeAzureReadingSentenceAudio({ text, userSlug, readingId, sentenceId, voiceName } = {}) {
  const safeText = String(text || "").trim();
  if (!safeText) {
    throw httpError(400, "There is no reading sentence text to synthesize.");
  }

  const config = buildAzureSpeechConfig(process.env);
  if (!config.configured) {
    throw httpError(
      400,
      "Azure Speech is not configured. Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION in .env.local or your shell environment.",
    );
  }

  const resolvedVoice = String(voiceName || config.voiceName || DEFAULT_AZURE_SPEECH_VOICE).trim();
  const ssml = buildHeadwordSsml(safeText, resolvedVoice);
  const paths = buildGeneratedReadingSentenceAudioPaths({ userSlug, readingId, sentenceId });

  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/ssml+xml",
      "Ocp-Apim-Subscription-Key": config.key,
      "X-Microsoft-OutputFormat": config.outputFormat,
      "User-Agent": "mingbai-study-room",
    },
    body: ssml,
  });

  if (!response.ok) {
    const body = (await response.text()).trim();
    throw httpError(502, `Azure Speech synthesis failed (${response.status}). ${body || "No error details returned."}`);
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());
  await fs.mkdir(path.dirname(paths.filePath), { recursive: true });
  await fs.writeFile(paths.filePath, audioBuffer);

  return {
    ...paths,
    mediaKind: "audio",
    mimeType: "audio/mpeg",
    storageProvider: "local",
    durationMs: 0,
    startMs: 0,
    endMs: 0,
    sourceTitle: `Azure TTS · ${resolvedVoice}`,
    sourceUrl: "",
    voiceName: resolvedVoice,
  };
}
