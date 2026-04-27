import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAzureSpeechConfig,
  buildGeneratedExampleAudioPaths,
  buildGeneratedHeadwordAudioPaths,
  buildHeadwordSsml,
  escapeSsmlText,
} from "../server/azureTts.js";

test("buildAzureSpeechConfig resolves key, region, endpoint, and default voice", () => {
  const config = buildAzureSpeechConfig({
    AZURE_SPEECH_KEY: "key-123",
    AZURE_SPEECH_REGION: "eastasia",
  });

  assert.equal(config.configured, true);
  assert.equal(config.endpoint, "https://eastasia.tts.speech.microsoft.com/cognitiveservices/v1");
  assert.equal(config.voiceName, "zh-CN-XiaoxiaoNeural");
});

test("buildGeneratedHeadwordAudioPaths creates a stable local cache path", () => {
  const paths = buildGeneratedHeadwordAudioPaths({
    userSlug: "Demo User",
    cardId: "hanzi-123",
  });

  assert.equal(paths.storageKey.startsWith("generated-tts/azure/demo-user/hanzi-123-headword-"), true);
  assert.equal(paths.mediaUrl.startsWith("/generated-tts/azure/demo-user/hanzi-123-headword-"), true);
  assert.equal(paths.filePath.includes("/public/generated-tts/azure/demo-user/hanzi-123-headword-"), true);
});

test("buildGeneratedExampleAudioPaths creates a separate stable cache path", () => {
  const paths = buildGeneratedExampleAudioPaths({
    userSlug: "Demo User",
    cardId: "hanzi-123",
  });

  assert.equal(paths.storageKey.startsWith("generated-tts/azure/demo-user/hanzi-123-example-"), true);
  assert.equal(paths.mediaUrl.startsWith("/generated-tts/azure/demo-user/hanzi-123-example-"), true);
  assert.equal(paths.filePath.includes("/public/generated-tts/azure/demo-user/hanzi-123-example-"), true);
});

test("buildHeadwordSsml escapes unsafe characters", () => {
  assert.equal(escapeSsmlText("明白 & <懂>"), "明白 &amp; &lt;懂&gt;");
  const ssml = buildHeadwordSsml("明白 & <懂>", "zh-CN-XiaoxiaoNeural");
  assert.match(ssml, /zh-CN-XiaoxiaoNeural/);
  assert.match(ssml, /明白 &amp; &lt;懂&gt;/);
});
