import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { safeSlug } from "./lib/subtitles.mjs";
import {
  buildSourceManifest,
  detectSourceArtifacts,
  writeSourceManifest,
} from "./lib/source-files.mjs";

function printUsage() {
  console.log(`Usage:
  npm run media:download -- --url <video-url> [--source-id show-ep01] [--out-dir media/sources] [--langs zh-Hans,zh-Hant,zh,en] [--cookies-from-browser chrome]

Examples:
  npm run media:download -- --url "https://www.youtube.com/watch?v=..." --source-id mingbai-ep01
  npm run media:download -- --url "https://www.bilibili.com/video/BV..." --source-id drama-scene-12 --cookies-from-browser safari
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

function deriveSourceId(url) {
  try {
    const parsed = new URL(url);
    const pathBits = parsed.pathname.split("/").filter(Boolean);
    const videoId = parsed.searchParams.get("v") || pathBits.at(-1) || parsed.hostname;
    return safeSlug(`${parsed.hostname}-${videoId}`);
  } catch {
    return `source-${Date.now()}`;
  }
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
    });

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

const args = parseArgs(process.argv.slice(2));

if (args.help || args.h) {
  printUsage();
  process.exit(0);
}

if (!args.url) {
  printUsage();
  process.exit(1);
}

const outDir = path.resolve(args["out-dir"] || "media/sources");
const sourceId = safeSlug(args["source-id"] || deriveSourceId(args.url));
const sourceDir = path.join(outDir, sourceId);
const langs = args.langs || "zh-Hans,zh-Hant,zh,en";

await fs.mkdir(sourceDir, { recursive: true });

const ytDlpArgs = [
  "--write-info-json",
  "--write-subs",
  "--write-auto-subs",
  "--sub-langs",
  langs,
  "--sub-format",
  "srt",
  "--convert-subs",
  "srt",
  "--merge-output-format",
  "mp4",
  "--output",
  path.join(sourceDir, "%(title).120B [%(id)s].%(ext)s"),
];

if (args["cookies-from-browser"]) {
  ytDlpArgs.push("--cookies-from-browser", String(args["cookies-from-browser"]));
}

ytDlpArgs.push(String(args.url));

console.log(`Downloading source media to ${sourceDir}`);
await runCommand("yt-dlp", ytDlpArgs);

const artifacts = await detectSourceArtifacts(sourceDir);

let sourceTitle = "";
let sourceUrl = String(args.url);

if (artifacts.infoJsonPath) {
  try {
    const info = JSON.parse(await fs.readFile(artifacts.infoJsonPath, "utf8"));
    sourceTitle = String(info.title || "").trim();
    sourceUrl = String(info.webpage_url || info.original_url || info.url || sourceUrl).trim();
  } catch {
    // Keep the manifest resilient even if yt-dlp's info JSON is missing or malformed.
  }
}

const manifestPath = await writeSourceManifest(sourceDir, buildSourceManifest({
  sourceId,
  sourceDir,
  sourceTitle,
  sourceUrl,
  mediaPath: artifacts.mediaPath,
  subtitleZhPath: artifacts.subtitles.zh,
  subtitleEnPath: artifacts.subtitles.en,
  infoJsonPath: artifacts.infoJsonPath,
}));

console.log("");
console.log("Download complete.");
console.log(`Source directory: ${sourceDir}`);
console.log(`Manifest: ${manifestPath}`);
console.log("Next step:");
console.log(`npm run clips:mine -- --source-id ${sourceId} --deck <path-to-exported-deck.json>`);
