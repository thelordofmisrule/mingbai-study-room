import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import {
  addReadingSentenceToDeck,
  attachGeneratedExampleAudio,
  attachGeneratedHeadwordAudio,
  attachGeneratedReadingSentenceAudio,
  clearReadingLibrary,
  deleteStudyCard,
  deleteReading,
  getDatabasePath,
  getReadingLibrary,
  getStudyState,
  replaceCardDefinitionsFromDictionary,
  replaceTaggedCardDefinitionsFromDictionary,
  replaceStudyState,
  reviewCard,
  reviewReadingSentence,
  updateStudyPreferences,
  upsertReading,
  upsertStudyCard,
} from "./db.js";
import {
  getAzureSpeechStatus,
  synthesizeAzureExampleAudio,
  synthesizeAzureHeadwordAudio,
  synthesizeAzureReadingSentenceAudio,
} from "./azureTts.js";
import { lookupDictionaryEntries } from "./dictionary.js";

const PORT = Number(process.env.PORT || 3001);
const DIST_DIR = path.join(process.cwd(), "dist");
const PUBLIC_DIR = path.join(process.cwd(), "public");

const MIME_TYPES = {
  ".aac": "audio/aac",
  ".css": "text/css; charset=utf-8",
  ".flac": "audio/flac",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".m4a": "audio/mp4",
  ".m4v": "video/mp4",
  ".mkv": "video/x-matroska",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".json": "application/json; charset=utf-8",
  ".oga": "audio/ogg",
  ".opus": "audio/ogg",
  ".png": "image/png",
  ".srt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".wav": "audio/wav",
  ".webm": "video/webm",
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function sendText(response, statusCode, message) {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(message);
}

async function readJsonBody(request) {
  let raw = "";

  for await (const chunk of request) {
    raw += chunk;
  }

  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.statusCode = 400;
    throw error;
  }
}

async function serveFile(response, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const data = await fs.readFile(filePath);
  response.writeHead(200, {
    "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
  });
  response.end(data);
}

async function tryServeStaticFile(baseDir, requestPath, response) {
  const filePath = path.resolve(baseDir, `.${requestPath}`);

  if (!filePath.startsWith(baseDir)) {
    sendText(response, 403, "Forbidden.");
    return true;
  }

  try {
    const stat = await fs.stat(filePath);
    if (stat.isFile()) {
      await serveFile(response, filePath);
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

async function tryServeClient(requestUrl, response) {
  if (requestUrl.pathname !== "/") {
    const servedFromPublic = await tryServeStaticFile(PUBLIC_DIR, requestUrl.pathname, response);
    if (servedFromPublic) {
      return true;
    }
  }

  let filePath = requestUrl.pathname === "/"
    ? path.join(DIST_DIR, "index.html")
    : path.resolve(DIST_DIR, `.${requestUrl.pathname}`);

  if (!filePath.startsWith(DIST_DIR)) {
    sendText(response, 403, "Forbidden.");
    return true;
  }

  try {
    const stat = await fs.stat(filePath);
    if (stat.isFile()) {
      await serveFile(response, filePath);
      return true;
    }
  } catch {
    // Fall through to SPA fallback.
  }

  if (!path.extname(requestUrl.pathname)) {
    try {
      await serveFile(response, path.join(DIST_DIR, "index.html"));
      return true;
    } catch {
      sendText(response, 404, "Client build not found. Run `npm run build` or use `npm run dev`.");
      return true;
    }
  }

  return false;
}

function routeParts(pathname) {
  return pathname.split("/").filter(Boolean);
}

async function handleApi(request, response, requestUrl) {
  const parts = routeParts(requestUrl.pathname);

  if (request.method === "GET" && requestUrl.pathname === "/api/health") {
    sendJson(response, 200, { ok: true, databasePath: getDatabasePath() });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/tts/status") {
    sendJson(response, 200, { azure: getAzureSpeechStatus() });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/dictionary/lookup") {
    const term = String(requestUrl.searchParams.get("term") || "").trim();
    sendJson(response, 200, {
      term,
      entries: await lookupDictionaryEntries(term),
    });
    return;
  }

  if (parts[0] !== "api" || parts[1] !== "users" || !parts[2]) {
    sendJson(response, 404, { error: "Route not found." });
    return;
  }

  const userSlug = decodeURIComponent(parts[2]);

  if (request.method === "GET" && parts.length === 4 && parts[3] === "study-state") {
    sendJson(response, 200, getStudyState(userSlug));
    return;
  }

  if (request.method === "GET" && parts.length === 4 && parts[3] === "readings") {
    sendJson(response, 200, { readings: getReadingLibrary(userSlug) });
    return;
  }

  if (request.method === "DELETE" && parts.length === 4 && parts[3] === "readings") {
    sendJson(response, 200, { readings: clearReadingLibrary(userSlug) });
    return;
  }

  if (request.method === "PUT" && parts.length === 4 && parts[3] === "study-state") {
    const body = await readJsonBody(request);
    if (body.state === undefined) {
      sendJson(response, 400, { error: "A study state payload is required." });
      return;
    }
    sendJson(response, 200, replaceStudyState(userSlug, body.state));
    return;
  }

  if (parts.length >= 5 && parts[3] === "readings") {
    const readingId = decodeURIComponent(parts[4]);

    if (request.method === "PUT" && parts.length === 5) {
      const body = await readJsonBody(request);
      sendJson(response, 200, { readings: await upsertReading(userSlug, { ...(body.reading || {}), id: readingId }) });
      return;
    }

    if (request.method === "DELETE" && parts.length === 5) {
      sendJson(response, 200, { readings: deleteReading(userSlug, readingId) });
      return;
    }

    if (parts.length >= 7 && parts[5] === "sentences") {
      const sentenceId = decodeURIComponent(parts[6]);

      if (request.method === "POST" && parts.length === 8 && parts[7] === "azure-audio") {
        const body = await readJsonBody(request);
        const currentLibrary = getReadingLibrary(userSlug);
        const reading = currentLibrary.find((entry) => entry.id === readingId);
        const sentence = reading?.sentences.find((entry) => entry.id === sentenceId);
        if (!reading || !sentence) {
          sendJson(response, 404, { error: "Reading sentence not found." });
          return;
        }

        const generatedAudio = await synthesizeAzureReadingSentenceAudio({
          text: sentence.text,
          userSlug,
          readingId,
          sentenceId,
          voiceName: body.voiceName,
        });

        sendJson(response, 200, {
          readings: attachGeneratedReadingSentenceAudio(userSlug, readingId, sentenceId, {
            provider: "azure",
            title: "Reading sentence audio",
            mediaKind: "audio",
            storageProvider: generatedAudio.storageProvider,
            storageKey: generatedAudio.storageKey,
            mimeType: generatedAudio.mimeType,
            mediaUrl: generatedAudio.mediaUrl,
            sourceUrl: generatedAudio.sourceUrl,
            sourceTitle: generatedAudio.sourceTitle,
            note: "Cached locally after Azure Speech synthesis.",
            durationMs: generatedAudio.durationMs,
            startMs: generatedAudio.startMs,
            endMs: generatedAudio.endMs,
          }),
        });
        return;
      }

      if (request.method === "POST" && parts.length === 8 && parts[7] === "review") {
        const body = await readJsonBody(request);
        sendJson(response, 200, {
          readings: reviewReadingSentence(userSlug, readingId, sentenceId, body.rating),
        });
        return;
      }

      if (request.method === "POST" && parts.length === 8 && parts[7] === "add-to-deck") {
        const body = await readJsonBody(request);
        sendJson(response, 200, {
          studyState: addReadingSentenceToDeck(userSlug, readingId, sentenceId, body),
        });
        return;
      }
    }
  }

  if (request.method === "PATCH" && parts.length === 4 && parts[3] === "preferences") {
    const body = await readJsonBody(request);
    sendJson(response, 200, updateStudyPreferences(userSlug, body.preferences));
    return;
  }

  if (request.method === "POST" && parts.length === 5 && parts[3] === "cards" && parts[4] === "dictionary-replace") {
    const body = await readJsonBody(request);
    sendJson(response, 200, await replaceTaggedCardDefinitionsFromDictionary(userSlug, {
      tag: body.tag || "anki-import",
    }));
    return;
  }

  if (parts.length >= 5 && parts[3] === "cards") {
    const cardId = decodeURIComponent(parts[4]);

    if (request.method === "PUT" && parts.length === 5) {
      const body = await readJsonBody(request);
      sendJson(response, 200, upsertStudyCard(userSlug, { ...(body.card || {}), id: cardId }));
      return;
    }

    if (request.method === "DELETE" && parts.length === 5) {
      sendJson(response, 200, deleteStudyCard(userSlug, cardId));
      return;
    }

    if (request.method === "POST" && parts.length === 6 && parts[5] === "review") {
      const body = await readJsonBody(request);
      sendJson(response, 200, reviewCard(userSlug, cardId, body.rating));
      return;
    }

    if (request.method === "POST" && parts.length === 6 && parts[5] === "dictionary-replace") {
      sendJson(response, 200, await replaceCardDefinitionsFromDictionary(userSlug, cardId));
      return;
    }

    if (request.method === "POST" && parts.length === 6 && parts[5] === "azure-audio") {
      const body = await readJsonBody(request);
      const currentState = getStudyState(userSlug);
      const card = currentState.items.find((item) => item.id === cardId);
      if (!card) {
        sendJson(response, 404, { error: "Card not found." });
        return;
      }

      const includeHeadword = body.includeHeadword !== false;
      const includeExample = body.includeExample !== false;
      let nextState = currentState;
      const generated = [];

      if (includeHeadword && card.hanzi.trim()) {
        const generatedHeadword = await synthesizeAzureHeadwordAudio({
          text: card.hanzi,
          userSlug,
          cardId,
          voiceName: body.voiceName,
        });

        nextState = attachGeneratedHeadwordAudio(userSlug, cardId, {
          provider: "azure",
          title: "Headword audio",
          mediaKind: "audio",
          storageProvider: generatedHeadword.storageProvider,
          storageKey: generatedHeadword.storageKey,
          mimeType: generatedHeadword.mimeType,
          mediaUrl: generatedHeadword.mediaUrl,
          sourceUrl: generatedHeadword.sourceUrl,
          sourceTitle: generatedHeadword.sourceTitle,
          note: "Cached locally after Azure Speech synthesis.",
          durationMs: generatedHeadword.durationMs,
          startMs: generatedHeadword.startMs,
          endMs: generatedHeadword.endMs,
        });
        generated.push("headword");
      }

      if (includeExample && card.example.trim()) {
        const generatedExample = await synthesizeAzureExampleAudio({
          text: card.example,
          userSlug,
          cardId,
          voiceName: body.voiceName,
        });

        nextState = attachGeneratedExampleAudio(userSlug, cardId, {
          provider: "azure",
          title: "Example audio",
          mediaKind: "audio",
          storageProvider: generatedExample.storageProvider,
          storageKey: generatedExample.storageKey,
          mimeType: generatedExample.mimeType,
          mediaUrl: generatedExample.mediaUrl,
          sourceUrl: generatedExample.sourceUrl,
          sourceTitle: generatedExample.sourceTitle,
          note: "Cached locally after Azure Speech synthesis.",
          durationMs: generatedExample.durationMs,
          startMs: generatedExample.startMs,
          endMs: generatedExample.endMs,
        });
        generated.push("example");
      }

      sendJson(response, 200, {
        ...nextState,
        generated,
      });
      return;
    }

    if (request.method === "POST" && parts.length === 7 && parts[5] === "headword-audio" && parts[6] === "azure") {
      const body = await readJsonBody(request);
      const currentState = getStudyState(userSlug);
      const card = currentState.items.find((item) => item.id === cardId);
      if (!card) {
        sendJson(response, 404, { error: "Card not found." });
        return;
      }

      const generatedAudio = await synthesizeAzureHeadwordAudio({
        text: card.hanzi,
        userSlug,
        cardId,
        voiceName: body.voiceName,
      });

      sendJson(response, 200, attachGeneratedHeadwordAudio(userSlug, cardId, {
        provider: "azure",
        title: "Headword audio",
        mediaKind: "audio",
        storageProvider: generatedAudio.storageProvider,
        storageKey: generatedAudio.storageKey,
        mimeType: generatedAudio.mimeType,
        mediaUrl: generatedAudio.mediaUrl,
        sourceUrl: generatedAudio.sourceUrl,
        sourceTitle: generatedAudio.sourceTitle,
        note: "Cached locally after Azure Speech synthesis.",
        durationMs: generatedAudio.durationMs,
        startMs: generatedAudio.startMs,
        endMs: generatedAudio.endMs,
      }));
      return;
    }

    if (request.method === "POST" && parts.length === 7 && parts[5] === "example-audio" && parts[6] === "azure") {
      const body = await readJsonBody(request);
      const currentState = getStudyState(userSlug);
      const card = currentState.items.find((item) => item.id === cardId);
      if (!card) {
        sendJson(response, 404, { error: "Card not found." });
        return;
      }

      const generatedAudio = await synthesizeAzureExampleAudio({
        text: card.example,
        userSlug,
        cardId,
        voiceName: body.voiceName,
      });

      sendJson(response, 200, attachGeneratedExampleAudio(userSlug, cardId, {
        provider: "azure",
        title: "Example audio",
        mediaKind: "audio",
        storageProvider: generatedAudio.storageProvider,
        storageKey: generatedAudio.storageKey,
        mimeType: generatedAudio.mimeType,
        mediaUrl: generatedAudio.mediaUrl,
        sourceUrl: generatedAudio.sourceUrl,
        sourceTitle: generatedAudio.sourceTitle,
        note: "Cached locally after Azure Speech synthesis.",
        durationMs: generatedAudio.durationMs,
        startMs: generatedAudio.startMs,
        endMs: generatedAudio.endMs,
      }));
      return;
    }
  }

  sendJson(response, 404, { error: "Route not found." });
}

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    if (requestUrl.pathname.startsWith("/api/")) {
      await handleApi(request, response, requestUrl);
      return;
    }

    const served = await tryServeClient(requestUrl, response);
    if (!served) {
      sendText(response, 404, "Not found.");
    }
  } catch (error) {
    console.error("Request failed:", error);
    const statusCode = error?.statusCode || 500;
    sendJson(response, statusCode, {
      error: error?.message || "Internal server error.",
    });
  }
});

server.listen(PORT, () => {
  console.log(`Mingbai API listening on http://localhost:${PORT}`);
});
