import test from "node:test";
import assert from "node:assert/strict";

import { buildDisplayGloss, numberedPinyinToToneMarks, parseCedictLine, scoreDictionaryEntry } from "../server/dictionary.js";

test("numberedPinyinToToneMarks converts numbered syllables to tone marks", () => {
  assert.equal(numberedPinyinToToneMarks("ni3 hao3"), "nǐ hǎo");
  assert.equal(numberedPinyinToToneMarks("nu:3 peng2 you5"), "nǚ péng you");
});

test("parseCedictLine extracts simplified, pinyin, and gloss", () => {
  const entry = parseCedictLine("中國 中国 [Zhong1 guo2] /China/Middle Kingdom/");

  assert.deepEqual(entry, {
    traditional: "中國",
    simplified: "中国",
    pinyinNumbered: "Zhong1 guo2",
    pinyin: "zhōng guó",
    definitions: ["China", "Middle Kingdom"],
    gloss: "China\nMiddle Kingdom",
  });
});

test("buildDisplayGloss keeps multiple major senses for words like 把", () => {
  const gloss = buildDisplayGloss([
    "to hold; to grasp",
    "to hold a baby in position to help it urinate or defecate",
    "handlebar",
    "classifier: handful, bundle, bunch",
    "classifier for things with handles",
    "(used to put the object before the verb: 把[ba3] + {noun} + {verb})",
  ]);

  assert.match(gloss, /to hold; to grasp/);
  assert.match(gloss, /used to put the object before the verb/);
  assert.doesNotMatch(gloss, /hold a baby in position/);
});

test("buildDisplayGloss keeps the first core definition as the anchor meaning", () => {
  const gloss = buildDisplayGloss([
    "outcome; result; consequence",
    "in the end; as a result",
    "to kill; to dispatch",
  ]);

  assert.equal(gloss.split("\n")[0], "outcome; result; consequence");
});

test("scoreDictionaryEntry prefers common non-verb learner senses for ambiguous entries", () => {
  const fruitEntry = parseCedictLine("結果 结果 [jie1 guo3] /to bear fruit/");
  const resultEntry = parseCedictLine("結果 结果 [jie2 guo3] /outcome; result; consequence/in the end; as a result/to kill; to dispatch/");

  assert.ok(fruitEntry);
  assert.ok(resultEntry);
  assert.ok(scoreDictionaryEntry(resultEntry, "结果") > scoreDictionaryEntry(fruitEntry, "结果"));
});

test("scoreDictionaryEntry downranks niche legal senses when a common everyday sense exists", () => {
  const legalEntry = parseCedictLine("告訴 告诉 [gao4 su4] /to press charges; to file a complaint/");
  const everydayEntry = parseCedictLine("告訴 告诉 [gao4 su5] /to tell; to inform; to let know/");

  assert.ok(legalEntry);
  assert.ok(everydayEntry);
  assert.ok(scoreDictionaryEntry(everydayEntry, "告诉") > scoreDictionaryEntry(legalEntry, "告诉"));
});

test("scoreDictionaryEntry keeps structural-particle readings competitive for common grammar words", () => {
  const lexicalEntry = parseCedictLine("得 得 [de2] /to obtain/to get/to gain/");
  const grammarEntry = parseCedictLine("得 得 [de5] /structural particle: used after a verb, linking it to a following phrase/");
  const nicheEntry = parseCedictLine("得 得 [de4] /used in 得瑟[de4 se5]/");

  assert.ok(lexicalEntry);
  assert.ok(grammarEntry);
  assert.ok(nicheEntry);
  assert.ok(scoreDictionaryEntry(grammarEntry, "得") > scoreDictionaryEntry(nicheEntry, "得"));
});
