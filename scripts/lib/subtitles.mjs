function cleanSubtitleText(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\{\\an\d\}/g, "")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseTimecodeToMs(raw) {
  const match = String(raw || "").trim().match(/^(\d{2,}):(\d{2}):(\d{2})[,.](\d{3})$/);
  if (!match) {
    throw new Error(`Invalid SRT timecode: ${raw}`);
  }

  const [, hours, minutes, seconds, milliseconds] = match;
  return (
    (Number(hours) * 60 * 60 * 1000)
    + (Number(minutes) * 60 * 1000)
    + (Number(seconds) * 1000)
    + Number(milliseconds)
  );
}

export function parseSrt(rawText) {
  const normalized = String(rawText || "").replace(/\r/g, "").trim();
  if (!normalized) return [];

  return normalized
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split("\n").map((line) => line.trimEnd());
      const maybeIndex = lines[0];
      const timingLine = maybeIndex.includes("-->") ? maybeIndex : lines[1];
      const textLines = maybeIndex.includes("-->")
        ? lines.slice(1)
        : lines.slice(2);

      if (!timingLine || !timingLine.includes("-->")) {
        throw new Error(`Could not parse subtitle block: ${block}`);
      }

      const [startRaw, endRaw] = timingLine.split("-->").map((part) => part.trim());
      return {
        index: maybeIndex.includes("-->") ? null : Number(maybeIndex) || null,
        startMs: parseTimecodeToMs(startRaw),
        endMs: parseTimecodeToMs(endRaw),
        text: cleanSubtitleText(textLines.join(" ")),
      };
    })
    .filter((entry) => entry.text);
}

export function findEntriesContaining(entries, term) {
  const needle = String(term || "").trim();
  if (!needle) return [];
  return entries.filter((entry) => entry.text.includes(needle));
}

export function dedupeEntriesByText(entries) {
  const seen = new Set();
  const deduped = [];

  for (const entry of entries) {
    const key = `${entry.text}::${entry.startMs}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(entry);
  }

  return deduped;
}

function overlapMs(left, right) {
  return Math.max(0, Math.min(left.endMs, right.endMs) - Math.max(left.startMs, right.startMs));
}

function midpoint(entry) {
  return (entry.startMs + entry.endMs) / 2;
}

export function pickBestTranslation(sourceEntry, translatedEntries, maxGapMs = 1400) {
  if (!sourceEntry || !translatedEntries?.length) return null;

  let best = null;

  for (const candidate of translatedEntries) {
    const overlap = overlapMs(sourceEntry, candidate);
    const centerGap = Math.abs(midpoint(sourceEntry) - midpoint(candidate));
    if (!overlap && centerGap > maxGapMs) continue;

    const score = overlap > 0 ? overlap + 100000 : -centerGap;
    if (!best || score > best.score) {
      best = { candidate, score };
    }
  }

  return best?.candidate || null;
}

export function safeSlug(value, fallback = "clip") {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");

  return slug || fallback;
}
