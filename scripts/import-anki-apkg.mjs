import fs from "node:fs/promises";
import path from "node:path";
import { normalizeState } from "../src/lib/studyStore.js";
import {
  getDatabasePath,
  getStudyState as getDatabaseUserState,
  replaceStudyState as replaceDatabaseUserState,
} from "../server/db.js";
import {
  buildAnkiWordAudioClip,
  buildCardFromAnkiRow,
  chooseAnkiModel,
  extractSoundFilename,
  loadAnkiNotes,
  loadApkgModels,
  materializeAnkiAudio,
  mergeImportedCards,
  prepareApkgImport,
} from "./lib/anki-apkg.mjs";

function printUsage() {
  console.log(`Usage:
  npm run anki:seed -- --apkg <deck.apkg> --db-user demo [--limit 5000]
  npm run anki:import -- --apkg <deck.apkg> [--limit 5000] [--output exports/deck.json]
  npm run anki:import -- --apkg <deck.apkg> --upload-user demo
  npm run anki:import -- --apkg <deck.apkg> --merge-file exports/current-deck.json

Options:
  --apkg <path>             required path to a local .apkg file
  --model-id <id>           optional Anki model id override
  --model-name <name>       optional Anki model name override
  --limit <n>               import only the top N notes by frequency rank
  --output <file>           output JSON file, defaults to exports/<apkg-name>.json
  --merge-file <file>       merge imported cards into an existing Mingbai deck JSON
  --db-user <slug>          merge imported cards directly into the local SQLite user
  --upload-user <slug>      merge imported cards into the running local API user
  --api-base <url>          defaults to http://127.0.0.1:3001/api

Examples:
  npm run anki:seed -- --apkg "/Users/me/Downloads/5000.apkg" --db-user demo --limit 1000
  npm run anki:import -- --apkg "/Users/me/Downloads/5000.apkg" --output exports/chinese-frequency.json
  npm run anki:import -- --apkg "/Users/me/Downloads/5000.apkg" --upload-user demo
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

function slugify(value, fallback = "anki-import") {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\.apkg$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

async function readJsonFile(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function fetchUserState(apiBase, userSlug) {
  const response = await fetch(`${String(apiBase).replace(/\/+$/u, "")}/users/${encodeURIComponent(userSlug)}/study-state`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || `Request failed with status ${response.status}.`);
  }
  return payload;
}

async function uploadUserState(apiBase, userSlug, state) {
  const response = await fetch(`${String(apiBase).replace(/\/+$/u, "")}/users/${encodeURIComponent(userSlug)}/study-state`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ state }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || `Request failed with status ${response.status}.`);
  }
  return payload;
}

const args = parseArgs(process.argv.slice(2));

if (args.help || args.h || !args.apkg) {
  printUsage();
  process.exit(args.help || args.h ? 0 : 1);
}

const apkgPath = path.resolve(String(args.apkg));
const mergeFilePath = args["merge-file"] ? path.resolve(String(args["merge-file"])) : "";
const dbUser = String(args["db-user"] || "").trim();
const uploadUser = String(args["upload-user"] || "").trim();
const apiBase = String(args["api-base"] || "http://127.0.0.1:3001/api").trim();
const limit = Math.max(0, Number(args.limit) || 0);
const mergeTargets = [mergeFilePath ? "merge-file" : "", dbUser ? "db-user" : "", uploadUser ? "upload-user" : ""].filter(Boolean);

if (mergeTargets.length > 1) {
  throw new Error("Use only one of --merge-file, --db-user, or --upload-user in a single run.");
}

const defaultOutputPath = path.resolve(path.join("exports", `${slugify(path.basename(apkgPath))}.json`));
const shouldWriteOutput = !!args.output || !!mergeFilePath || (!dbUser && !uploadUser);
const outputPath = shouldWriteOutput ? path.resolve(String(args.output || defaultOutputPath)) : "";

const prepared = await prepareApkgImport(apkgPath);

try {
  const models = await loadApkgModels(prepared.collectionPath);
  const model = chooseAnkiModel(models, {
    modelId: args["model-id"],
    modelName: args["model-name"],
  });

  if (!model) {
    throw new Error("Could not find a compatible Anki note model with Word, Meanings, and Pinyin fields.");
  }

  const rows = await loadAnkiNotes(prepared.collectionPath, model);
  const deckTitle = path.basename(apkgPath, ".apkg");
  const rowsByFrequency = rows
    .map((row) => ({
      ...row,
      rank: Number(row.rank) || Number.MAX_SAFE_INTEGER,
    }))
    .sort((left, right) => left.rank - right.rank || String(left.word || "").localeCompare(String(right.word || "")))
    .slice(0, limit || undefined);
  const audioAttachments = await materializeAnkiAudio({
    prepared,
    apkgPath,
    rows: rowsByFrequency,
    deckTitle,
  });

  const importedCards = rowsByFrequency
    .map((row) => ({
      row,
      card: buildCardFromAnkiRow(row, {
        deckTitle,
        audioClip: audioAttachments.get(String(row.noteId))
          ? buildAnkiWordAudioClip({
            noteId: row.noteId,
            deckTitle,
            ...audioAttachments.get(String(row.noteId)),
          })
          : null,
      }),
    }))
    .filter(({ card }) => card.hanzi && card.gloss)
    .reduce((accumulator, entry) => {
      if (!accumulator.some((existing) => existing.card.hanzi === entry.card.hanzi)) {
        accumulator.push(entry);
      }
      return accumulator;
    }, [])
    .map(({ row, card }) => ({ row, card }));

  const importedRows = importedCards.map((entry) => entry.row);
  const importedDeckCards = importedCards.map((entry) => entry.card);

  let finalState = normalizeState({ items: importedDeckCards });
  let mergedExisting = 0;
  let addedNew = importedDeckCards.length;

  if (mergeFilePath) {
    const mergeBase = await readJsonFile(mergeFilePath);
    const merged = mergeImportedCards(mergeBase, importedDeckCards);
    finalState = merged.state;
    mergedExisting = merged.mergedExisting;
    addedNew = merged.addedNew;
  } else if (dbUser) {
    const mergeBase = getDatabaseUserState(dbUser);
    const merged = mergeImportedCards(mergeBase, importedDeckCards);
    finalState = merged.state;
    mergedExisting = merged.mergedExisting;
    addedNew = merged.addedNew;
  } else if (uploadUser) {
    const mergeBase = await fetchUserState(apiBase, uploadUser);
    const merged = mergeImportedCards(mergeBase, importedDeckCards);
    finalState = merged.state;
    mergedExisting = merged.mergedExisting;
    addedNew = merged.addedNew;
  }

  if (shouldWriteOutput) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(finalState, null, 2)}\n`);
  }

  if (dbUser) {
    replaceDatabaseUserState(dbUser, finalState);
  } else if (uploadUser) {
    await uploadUserState(apiBase, uploadUser, finalState);
  }

  const notesWithAudio = importedRows.filter((row) => extractSoundFilename(row.audio)).length;

  console.log("");
  console.log(`Imported ${importedDeckCards.length} cards from ${path.basename(apkgPath)}`);
  console.log(`Model: ${model.name} (${model.id})`);
  console.log(`Cards with example rows: ${importedDeckCards.filter((card) => card.example || card.clips.length).length}`);
  console.log(`Cards with word audio available in source package: ${notesWithAudio}`);
  console.log(`Cards with word audio extracted into project: ${audioAttachments.size}`);
  if (mergeFilePath || dbUser || uploadUser) {
    console.log(`Merged into existing deck: ${mergedExisting} existing words updated, ${addedNew} new words added`);
  }
  if (shouldWriteOutput) {
    console.log(`Output JSON: ${outputPath}`);
  }
  if (dbUser) {
    console.log(`Saved merged deck to ${getDatabasePath()} for user ${dbUser}`);
  } else if (uploadUser) {
    console.log(`Uploaded merged deck to ${apiBase.replace(/\/+$/u, "")}/users/${encodeURIComponent(uploadUser)}/study-state`);
  }
  console.log("");
} finally {
  await prepared.cleanup();
}
