import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { detectSourceArtifacts } from "../scripts/lib/source-files.mjs";
import { parseSrt, pickBestTranslation } from "../scripts/lib/subtitles.mjs";

test("parseSrt reads timing blocks and cleans subtitle markup", () => {
  const entries = parseSrt(`1
00:00:01,000 --> 00:00:02,500
<i>你明白吗？</i>

2
00:00:03,000 --> 00:00:04,100
{\\an8}我现在明白了。
`);

  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], {
    index: 1,
    startMs: 1000,
    endMs: 2500,
    text: "你明白吗？",
  });
  assert.equal(entries[1].text, "我现在明白了。");
});

test("pickBestTranslation prefers overlapping subtitle lines", () => {
  const sourceEntry = { startMs: 1000, endMs: 2400, text: "你明白吗？" };
  const translation = pickBestTranslation(sourceEntry, [
    { startMs: 0, endMs: 900, text: "Wait a second." },
    { startMs: 1100, endMs: 2500, text: "Do you understand?" },
    { startMs: 3500, endMs: 4300, text: "I understand now." },
  ]);

  assert.equal(translation?.text, "Do you understand?");
});

test("detectSourceArtifacts finds media plus Chinese and English subtitle files", async (t) => {
  const sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), "mingbai-source-"));
  t.after(async () => {
    await fs.rm(sourceDir, { recursive: true, force: true });
  });

  await Promise.all([
    fs.writeFile(path.join(sourceDir, "Drama Episode [abc123].mp4"), ""),
    fs.writeFile(path.join(sourceDir, "Drama Episode [abc123].zh-Hans.srt"), ""),
    fs.writeFile(path.join(sourceDir, "Drama Episode [abc123].en.srt"), ""),
    fs.writeFile(path.join(sourceDir, "Drama Episode [abc123].info.json"), "{}"),
  ]);

  const artifacts = await detectSourceArtifacts(sourceDir);

  assert.equal(path.basename(artifacts.mediaPath), "Drama Episode [abc123].mp4");
  assert.equal(path.basename(artifacts.subtitles.zh), "Drama Episode [abc123].zh-Hans.srt");
  assert.equal(path.basename(artifacts.subtitles.en), "Drama Episode [abc123].en.srt");
  assert.equal(path.basename(artifacts.infoJsonPath), "Drama Episode [abc123].info.json");
});
