import {
  getDatabasePath,
  getStudyState,
  replaceStudyState,
} from "../server/db.js";
import { createChineseCard } from "../src/lib/studyStore.js";
import { stripImportedDeckLabel } from "./lib/anki-apkg.mjs";

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

function printUsage() {
  console.log(`Usage:
  npm run anki:cleanup -- --user demo
`);
}

const args = parseArgs(process.argv.slice(2));

if (args.help || args.h) {
  printUsage();
  process.exit(0);
}

const userSlug = String(args.user || "demo").trim() || "demo";
const state = getStudyState(userSlug);
let changedCards = 0;
let changedClips = 0;

const cleanedItems = state.items.map((item) => {
  if (!item.tags.includes("anki-import")) return item;

  const nextNotes = stripImportedDeckLabel(item.notes);
  const nextClips = item.clips.map((clip) => {
    if (!/^Dictionary example\b/i.test(String(clip.title || ""))) {
      return clip;
    }

    if (!clip.sourceTitle) {
      return clip;
    }

    changedClips += 1;
    return {
      ...clip,
      sourceTitle: "",
    };
  });

  const notesChanged = nextNotes !== item.notes;
  const clipsChanged = nextClips.some((clip, index) => clip !== item.clips[index]);

  if (!notesChanged && !clipsChanged) {
    return item;
  }

  changedCards += 1;
  return createChineseCard({
    ...item,
    notes: nextNotes,
    clips: nextClips,
  });
});

if (!changedCards) {
  console.log(`No imported card metadata needed cleanup for user ${userSlug}.`);
  process.exit(0);
}

replaceStudyState(userSlug, {
  ...state,
  items: cleanedItems,
});

console.log("");
console.log(`Cleaned ${changedCards} imported cards for user ${userSlug}`);
console.log(`Removed ${changedClips} dictionary example source labels`);
console.log(`Updated database: ${getDatabasePath()}`);
console.log("");
