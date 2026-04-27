import fs from "node:fs/promises";
import path from "node:path";

const MEDIA_EXTENSIONS = new Set([
  ".mp3",
  ".m4a",
  ".aac",
  ".wav",
  ".oga",
  ".opus",
  ".flac",
  ".mp4",
  ".m4v",
  ".mov",
  ".mkv",
  ".webm",
]);

const SUBTITLE_PATTERNS = {
  en: [
    /(?:^|[._-])en(?:[._-](?:us|gb))?(?:[._-]|$)/i,
    /(?:^|[._-])english(?:[._-]|$)/i,
  ],
  zh: [
    /(?:^|[._-])zh(?:[._-](?:hans|hant|cn|tw))?(?:[._-]|$)/i,
    /(?:^|[._-])cmn(?:[._-](?:hans|hant))?(?:[._-]|$)/i,
    /(?:^|[._-])chinese(?:[._-]|$)/i,
  ],
};

function toPosixPath(filePath) {
  return String(filePath || "").split(path.sep).join("/");
}

function normalizeRelativePath(filePath, baseDir) {
  if (!filePath) return "";
  return toPosixPath(path.relative(baseDir, filePath));
}

function scoreSubtitleFile(filePath, language) {
  if (path.extname(filePath).toLowerCase() !== ".srt") return -1;

  const basename = path.basename(filePath);
  const patterns = SUBTITLE_PATTERNS[language] || [];

  for (const [index, pattern] of patterns.entries()) {
    if (pattern.test(basename)) {
      return 100 - (index * 10);
    }
  }

  return -1;
}

export function resolveSourcePath(sourceDir, filePath = "") {
  if (!filePath) return "";
  return path.isAbsolute(filePath) ? filePath : path.resolve(sourceDir, filePath);
}

export async function listSourceFiles(sourceDir) {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(sourceDir, entry.name));
}

export async function detectSourceArtifacts(sourceDir) {
  const files = await listSourceFiles(sourceDir);
  const mediaPath = files.find((filePath) => MEDIA_EXTENSIONS.has(path.extname(filePath).toLowerCase())) || "";
  const infoJsonPath = files.find((filePath) => filePath.toLowerCase().endsWith(".info.json")) || "";

  let zhSubtitlePath = "";
  let enSubtitlePath = "";
  let bestZhScore = -1;
  let bestEnScore = -1;

  for (const filePath of files) {
    const zhScore = scoreSubtitleFile(filePath, "zh");
    if (zhScore > bestZhScore) {
      bestZhScore = zhScore;
      zhSubtitlePath = filePath;
    }

    const enScore = scoreSubtitleFile(filePath, "en");
    if (enScore > bestEnScore) {
      bestEnScore = enScore;
      enSubtitlePath = filePath;
    }
  }

  return {
    files,
    infoJsonPath,
    mediaPath,
    subtitles: {
      en: bestEnScore >= 0 ? enSubtitlePath : "",
      zh: bestZhScore >= 0 ? zhSubtitlePath : "",
    },
  };
}

export async function readSourceManifest(sourceDir) {
  try {
    const manifestPath = path.join(sourceDir, "source-manifest.json");
    const raw = await fs.readFile(manifestPath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function writeSourceManifest(sourceDir, manifest) {
  const manifestPath = path.join(sourceDir, "source-manifest.json");
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifestPath;
}

export function buildSourceManifest({ sourceId, sourceDir, sourceTitle = "", sourceUrl = "", mediaPath = "", subtitleZhPath = "", subtitleEnPath = "", infoJsonPath = "" }) {
  return {
    sourceId,
    sourceDir: normalizeRelativePath(sourceDir, process.cwd()),
    sourceTitle,
    sourceUrl,
    mediaPath: normalizeRelativePath(mediaPath, sourceDir),
    subtitles: {
      zh: normalizeRelativePath(subtitleZhPath, sourceDir),
      en: normalizeRelativePath(subtitleEnPath, sourceDir),
    },
    infoJsonPath: normalizeRelativePath(infoJsonPath, sourceDir),
    generatedAt: new Date().toISOString(),
  };
}
