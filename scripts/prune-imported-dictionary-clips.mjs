import { getDatabasePath, getStudyState, replaceStudyState } from "../server/db.js";

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

const args = parseArgs(process.argv.slice(2));
const userSlug = String(args.user || args["db-user"] || "demo").trim() || "demo";
const state = getStudyState(userSlug);

let cardsChanged = 0;
let clipsRemoved = 0;

const nextState = {
  ...state,
  items: state.items.map((card) => {
    const keptClips = card.clips.filter((clip) => !/^Dictionary example\b/i.test(String(clip.title || "")));
    if (keptClips.length !== card.clips.length) {
      cardsChanged += 1;
      clipsRemoved += card.clips.length - keptClips.length;
      return {
        ...card,
        clips: keptClips,
      };
    }
    return card;
  }),
};

replaceStudyState(userSlug, nextState);

console.log("");
console.log(`User: ${userSlug}`);
console.log(`Database: ${getDatabasePath()}`);
console.log(`Cards updated: ${cardsChanged}`);
console.log(`Dictionary clips removed: ${clipsRemoved}`);
console.log("");
