const API_ROOT = "/api";

export const DEFAULT_USER_SLUG = "demo";

function userPath(userSlug = DEFAULT_USER_SLUG) {
  return `/users/${encodeURIComponent(String(userSlug || DEFAULT_USER_SLUG))}`;
}

async function request(path, options = {}) {
  const { body, headers, ...rest } = options;
  const response = await fetch(`${API_ROOT}${path}`, {
    ...rest,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(headers || {}),
    },
    body,
  });

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : null;

  if (!response.ok) {
    throw new Error(payload?.error || `Request failed with status ${response.status}.`);
  }

  return payload;
}

export function fetchStudyState(userSlug = DEFAULT_USER_SLUG) {
  return request(`${userPath(userSlug)}/study-state`);
}

export function fetchReadingLibrary(userSlug = DEFAULT_USER_SLUG) {
  return request(`${userPath(userSlug)}/readings`);
}

export function clearReadingLibrary(userSlug = DEFAULT_USER_SLUG) {
  return request(`${userPath(userSlug)}/readings`, {
    method: "DELETE",
  });
}

export function replaceStudyState(userSlug = DEFAULT_USER_SLUG, state) {
  return request(`${userPath(userSlug)}/study-state`, {
    method: "PUT",
    body: JSON.stringify({ state }),
  });
}

export function updateStudyPreferences(userSlug = DEFAULT_USER_SLUG, preferences) {
  return request(`${userPath(userSlug)}/preferences`, {
    method: "PATCH",
    body: JSON.stringify({ preferences }),
  });
}

export function saveStudyCard(userSlug = DEFAULT_USER_SLUG, card) {
  return request(`${userPath(userSlug)}/cards/${encodeURIComponent(card.id)}`, {
    method: "PUT",
    body: JSON.stringify({ card }),
  });
}

export function deleteStudyCardById(userSlug = DEFAULT_USER_SLUG, cardId) {
  return request(`${userPath(userSlug)}/cards/${encodeURIComponent(cardId)}`, {
    method: "DELETE",
  });
}

export function reviewStudyCardById(userSlug = DEFAULT_USER_SLUG, cardId, rating) {
  return request(`${userPath(userSlug)}/cards/${encodeURIComponent(cardId)}/review`, {
    method: "POST",
    body: JSON.stringify({ rating }),
  });
}

export function replaceCardDefinitionsFromDictionary(userSlug = DEFAULT_USER_SLUG, cardId) {
  return request(`${userPath(userSlug)}/cards/${encodeURIComponent(cardId)}/dictionary-replace`, {
    method: "POST",
  });
}

export function replaceTaggedCardDefinitionsFromDictionary(userSlug = DEFAULT_USER_SLUG, tag = "anki-import") {
  return request(`${userPath(userSlug)}/cards/dictionary-replace`, {
    method: "POST",
    body: JSON.stringify({ tag }),
  });
}

export function fetchTtsStatus() {
  return request("/tts/status");
}

export function lookupDictionary(term) {
  return request(`/dictionary/lookup?term=${encodeURIComponent(String(term || "").trim())}`);
}

export function generateAzureHeadwordAudio(userSlug = DEFAULT_USER_SLUG, cardId, options = {}) {
  return request(`${userPath(userSlug)}/cards/${encodeURIComponent(cardId)}/headword-audio/azure`, {
    method: "POST",
    body: JSON.stringify(options),
  });
}

export function generateAzureCardAudio(userSlug = DEFAULT_USER_SLUG, cardId, options = {}) {
  return request(`${userPath(userSlug)}/cards/${encodeURIComponent(cardId)}/azure-audio`, {
    method: "POST",
    body: JSON.stringify(options),
  });
}

export function saveReading(userSlug = DEFAULT_USER_SLUG, reading) {
  return request(`${userPath(userSlug)}/readings/${encodeURIComponent(reading.id)}`, {
    method: "PUT",
    body: JSON.stringify({ reading }),
  });
}

export function deleteReadingById(userSlug = DEFAULT_USER_SLUG, readingId) {
  return request(`${userPath(userSlug)}/readings/${encodeURIComponent(readingId)}`, {
    method: "DELETE",
  });
}

export function generateAzureReadingSentenceAudio(userSlug = DEFAULT_USER_SLUG, readingId, sentenceId, options = {}) {
  return request(
    `${userPath(userSlug)}/readings/${encodeURIComponent(readingId)}/sentences/${encodeURIComponent(sentenceId)}/azure-audio`,
    {
      method: "POST",
      body: JSON.stringify(options),
    },
  );
}

export function reviewReadingSentenceById(userSlug = DEFAULT_USER_SLUG, readingId, sentenceId, rating) {
  return request(
    `${userPath(userSlug)}/readings/${encodeURIComponent(readingId)}/sentences/${encodeURIComponent(sentenceId)}/review`,
    {
      method: "POST",
      body: JSON.stringify({ rating }),
    },
  );
}

export function addReadingSentenceToDeck(userSlug = DEFAULT_USER_SLUG, readingId, sentenceId, payload = {}) {
  return request(
    `${userPath(userSlug)}/readings/${encodeURIComponent(readingId)}/sentences/${encodeURIComponent(sentenceId)}/add-to-deck`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}
