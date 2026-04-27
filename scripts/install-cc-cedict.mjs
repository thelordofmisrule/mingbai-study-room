import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { promisify } from "node:util";

const gunzip = promisify(zlib.gunzip);
const INSTALL_DIR = path.join(process.cwd(), "data", "dictionaries", "cc-cedict");
const INSTALL_PATH = path.join(INSTALL_DIR, "cedict_ts.u8");

function printUsage() {
  console.log(`
Install a manually-downloaded CC-CEDICT dictionary file for local lookups.

Usage:
  npm run dict:install -- --file "/path/to/cedict_1_0_ts_utf-8_mdbg.txt.gz"

Accepted formats:
  - .txt
  - .u8
  - .gz
`.trim());
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const part = argv[index];
    if (part === "--file") {
      args.file = argv[index + 1];
      index += 1;
    } else if (part === "--help" || part === "-h") {
      args.help = true;
    }
  }
  return args;
}

function looksLikeCedict(text = "") {
  return /^.+\s+.+\s+\[.+\]\s+\/.+\/$/mu.test(String(text || ""));
}

async function readDictionarySource(filePath) {
  const sourceBuffer = await fs.readFile(filePath);
  if (filePath.toLowerCase().endsWith(".gz")) {
    return gunzip(sourceBuffer);
  }
  return sourceBuffer;
}

async function main() {
  const args = parseArgs();
  if (args.help || !args.file) {
    printUsage();
    process.exit(args.help ? 0 : 1);
  }

  const sourcePath = path.resolve(String(args.file));
  const buffer = await readDictionarySource(sourcePath);
  const text = buffer.toString("utf8");

  if (!looksLikeCedict(text)) {
    throw new Error("That file does not look like CC-CEDICT text.");
  }

  await fs.mkdir(INSTALL_DIR, { recursive: true });
  await fs.writeFile(INSTALL_PATH, text, "utf8");

  console.log(`Installed CC-CEDICT to ${INSTALL_PATH}`);
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
