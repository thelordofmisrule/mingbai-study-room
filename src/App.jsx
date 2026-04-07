import { useEffect, useMemo, useState } from "react";
import {
  createChineseCard,
  createEmptyChineseCard,
  deleteStudyCard,
  dueStudyCards,
  importStudyStateFromJson,
  loadStudyState,
  reviewStudyCard,
  saveStudyState,
  summarizeStudyCards,
  upsertStudyCard,
} from "./lib/studyStore";

function fmtDue(iso) {
  if (!iso) return "Now";
  try {
    return new Date(iso).toLocaleString("en-GB", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "Now";
  }
}

function isDirectVideo(url) {
  return /\.(mp4|webm|ogg|m4v)(\?|#|$)/i.test(String(url || "").trim());
}

function splitTags(raw) {
  return [...new Set(
    String(raw || "")
      .split(/[,\n;]+/)
      .map((tag) => tag.trim())
      .filter(Boolean),
  )];
}

function pickEditorCard(items) {
  const dueItems = dueStudyCards(items || []);
  return dueItems[0] || (items || [])[0] || null;
}

const PINYIN_MODES = [
  { value: "hidden", label: "Off", note: "No pinyin prompts" },
  { value: "reveal", label: "Reveal", note: "Show it only when needed" },
  { value: "always", label: "Always", note: "Keep pronunciation visible" },
];

function StatCard({ label, value, note }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {note ? <div className="stat-note">{note}</div> : null}
    </div>
  );
}

function PinyinModeControl({ value, onChange }) {
  return (
    <div className="pinyin-control">
      <div className="pinyin-control-label">Pinyin</div>
      <div className="segmented-control" role="tablist" aria-label="Pinyin display mode">
        {PINYIN_MODES.map((mode) => (
          <button
            key={mode.value}
            type="button"
            className={`segment${value === mode.value ? " is-active" : ""}`}
            aria-pressed={value === mode.value}
            onClick={() => onChange(mode.value)}
            title={mode.note}
          >
            {mode.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ThemeControl({ value, onChange }) {
  return (
    <div className="pinyin-control">
      <div className="pinyin-control-label">Theme</div>
      <div className="segmented-control" role="tablist" aria-label="Theme mode">
        <button type="button" className={`segment${value === "day" ? " is-active" : ""}`} onClick={() => onChange("day")}>
          Day
        </button>
        <button type="button" className={`segment${value === "night" ? " is-active" : ""}`} onClick={() => onChange("night")}>
          Night
        </button>
      </div>
    </div>
  );
}

function ClipCard({ clip, showPinyin }) {
  const directVideo = isDirectVideo(clip.mediaUrl);
  return (
    <div className="clip-card">
      <div>
        <div className="clip-title">{clip.title || "Usage clip"}</div>
        {(clip.sourceLabel || clip.startSeconds) && (
          <div className="clip-meta">
            {[clip.sourceLabel, clip.startSeconds ? `Start ${clip.startSeconds}s` : ""].filter(Boolean).join(" · ")}
          </div>
        )}
      </div>

      {clip.quote ? (
        <div className="quote-block">
          <div className="hanzi-line">{clip.quote}</div>
          {showPinyin && clip.quotePinyin ? <div className="pinyin-line">{clip.quotePinyin}</div> : null}
        </div>
      ) : null}

      {directVideo ? (
        <video controls preload="metadata" src={clip.mediaUrl} className="clip-video" />
      ) : clip.mediaUrl ? (
        <a className="btn btn-secondary btn-sm" href={clip.mediaUrl} target="_blank" rel="noopener noreferrer">
          Open clip
        </a>
      ) : null}

      {clip.note ? <div className="clip-note">{clip.note}</div> : null}
      {clip.sourceUrl ? (
        <a href={clip.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-link">
          Source context
        </a>
      ) : null}
    </div>
  );
}

function ClipEditor({ clip, index, onChange, onRemove, disableRemove = false }) {
  return (
    <div className="clip-editor">
      <div className="clip-editor-head">
        <div className="section-kicker">Clip {index + 1}</div>
        <button className="btn btn-ghost btn-sm" disabled={disableRemove} onClick={onRemove}>
          Remove
        </button>
      </div>

      <input className="input" value={clip.title} onChange={(event) => onChange({ title: event.target.value })} placeholder="Clip label" />
      <textarea className="input" rows={2} value={clip.quote} onChange={(event) => onChange({ quote: event.target.value })} placeholder="Quote with the target word" />
      <input className="input" value={clip.quotePinyin} onChange={(event) => onChange({ quotePinyin: event.target.value })} placeholder="Quote pinyin (tone marks preferred)" />
      <input className="input" value={clip.sourceLabel} onChange={(event) => onChange({ sourceLabel: event.target.value })} placeholder="Movie / show / scene" />
      <input className="input" value={clip.mediaUrl} onChange={(event) => onChange({ mediaUrl: event.target.value })} placeholder="Direct video URL or clip link" />
      <div className="clip-grid">
        <input className="input" value={clip.sourceUrl} onChange={(event) => onChange({ sourceUrl: event.target.value })} placeholder="Reference URL" />
        <input className="input" type="number" min="0" value={clip.startSeconds} onChange={(event) => onChange({ startSeconds: Number(event.target.value) || 0 })} placeholder="Start seconds" />
      </div>
      <textarea className="input" rows={2} value={clip.note} onChange={(event) => onChange({ note: event.target.value })} placeholder="Why this usage matters" />
    </div>
  );
}

export default function App() {
  const [state, setState] = useState({ items: [], preferences: { pinyinMode: "reveal", theme: "day" } });
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState(createEmptyChineseCard());
  const [revealAnswer, setRevealAnswer] = useState(false);
  const [revealPinyin, setRevealPinyin] = useState(false);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    const next = loadStudyState();
    const initialCard = pickEditorCard(next.items);
    setState(next);
    setDraft(initialCard ? createChineseCard(initialCard) : createEmptyChineseCard());
    setSelectedId(initialCard?.id || "");
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    saveStudyState(state);
  }, [loaded, state]);

  useEffect(() => {
    if (!notice) return undefined;
    const timeoutId = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  const dueCards = useMemo(() => dueStudyCards(state.items), [state.items]);
  const summary = useMemo(() => summarizeStudyCards(state.items), [state.items]);
  const currentCard = dueCards[0] || null;
  const pinyinMode = state.preferences?.pinyinMode || "reveal";
  const theme = state.preferences?.theme || "day";
  const currentCardHasExtraPinyin = !!(
    currentCard?.pinyin
    || currentCard?.examplePinyin
    || currentCard?.clips?.some((clip) => clip.quotePinyin)
  );
  const showCurrentPinyin = pinyinMode === "always" || (pinyinMode === "reveal" && revealPinyin);

  const filteredItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const items = [...state.items].sort((left, right) => (
      new Date(left.dueAt || 0).getTime() - new Date(right.dueAt || 0).getTime()
      || String(left.hanzi || "").localeCompare(String(right.hanzi || ""))
    ));
    if (!needle) return items;
    return items.filter((item) => (
      item.hanzi.toLowerCase().includes(needle)
      || item.pinyin.toLowerCase().includes(needle)
      || item.gloss.toLowerCase().includes(needle)
      || item.example.toLowerCase().includes(needle)
      || item.examplePinyin.toLowerCase().includes(needle)
      || item.clips.some((clip) => (
        clip.quote.toLowerCase().includes(needle)
        || clip.quotePinyin.toLowerCase().includes(needle)
        || clip.sourceLabel.toLowerCase().includes(needle)
      ))
      || item.tags.some((tag) => tag.toLowerCase().includes(needle))
    ));
  }, [query, state.items]);

  useEffect(() => {
    setRevealAnswer(false);
    setRevealPinyin(pinyinMode === "always");
  }, [currentCard?.id, pinyinMode]);

  const pushNotice = (kind, message) => setNotice({ kind, message });

  const updatePreferences = (patch) => {
    setState((prev) => ({
      ...prev,
      preferences: {
        ...(prev?.preferences || {}),
        ...patch,
      },
    }));
  };

  const selectCardForEdit = (card) => {
    setSelectedId(card.id);
    setDraft(createChineseCard(card));
  };

  const resetDraft = () => {
    setSelectedId("");
    setDraft(createEmptyChineseCard());
  };

  const updateDraft = (patch) => {
    setDraft((prev) => createChineseCard({ ...prev, ...patch }));
  };

  const updateClip = (clipId, patch) => {
    updateDraft({
      clips: draft.clips.map((clip) => (clip.id === clipId ? { ...clip, ...patch } : clip)),
    });
  };

  const addClip = () => {
    updateDraft({
      clips: [
        ...draft.clips,
        {
          id: `clip-${Date.now()}`,
          title: "",
          quote: "",
          quotePinyin: "",
          sourceLabel: "",
          note: "",
          mediaUrl: "",
          sourceUrl: "",
          startSeconds: 0,
        },
      ],
    });
  };

  const removeClip = (clipId) => {
    updateDraft({
      clips: draft.clips.filter((clip) => clip.id !== clipId),
    });
  };

  const saveCard = () => {
    if (!draft.hanzi.trim() || !draft.gloss.trim()) {
      pushNotice("error", "Add at least the word and its gloss.");
      return;
    }
    const wasEditing = !!selectedId;
    const next = upsertStudyCard(state, {
      ...draft,
      tags: splitTags(draft.tags?.join(", ")),
      clips: draft.clips.filter((clip) => clip.title || clip.quote || clip.quotePinyin || clip.mediaUrl || clip.sourceLabel || clip.note || clip.sourceUrl),
      dueAt: draft.dueAt || new Date().toISOString(),
    });
    const saved = next.items.find((item) => item.id === draft.id) || next.items[0];
    setState(next);
    setSelectedId(saved?.id || "");
    setDraft(saved ? createChineseCard(saved) : createEmptyChineseCard());
    pushNotice("success", wasEditing ? "Word updated." : "Word added.");
  };

  const removeCard = () => {
    if (!draft.id) return;
    const ok = window.confirm(`Delete ${draft.hanzi || "this card"} from your deck?`);
    if (!ok) return;
    const next = deleteStudyCard(state, draft.id);
    setState(next);
    resetDraft();
    pushNotice("success", "Word deleted.");
  };

  const reviewCurrentCard = (rating) => {
    if (!currentCard) return;
    const updated = reviewStudyCard(currentCard, rating);
    const next = upsertStudyCard(state, updated);
    const nextEditorCard = pickEditorCard(next.items);
    setState(next);
    setSelectedId(nextEditorCard?.id || "");
    setDraft(nextEditorCard ? createChineseCard(nextEditorCard) : createEmptyChineseCard());
    pushNotice("success", `${currentCard.hanzi} marked ${rating}.`);
  };

  const copyDeckJson = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(state, null, 2));
      pushNotice("success", "Deck JSON copied.");
    } catch {
      pushNotice("error", "Could not copy the deck.");
    }
  };

  const importDeckFromClipboard = async () => {
    try {
      const raw = await navigator.clipboard.readText();
      const next = importStudyStateFromJson(raw);
      const initialCard = pickEditorCard(next.items);
      setState(next);
      setSelectedId(initialCard?.id || "");
      setDraft(initialCard ? createChineseCard(initialCard) : createEmptyChineseCard());
      pushNotice("success", `Imported ${next.items.length} cards from clipboard.`);
    } catch {
      pushNotice("error", "Could not import clipboard JSON.");
    }
  };

  const downloadDeckJson = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `mingbai-deck-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    pushNotice("success", "Deck JSON downloaded.");
  };

  if (!loaded) {
    return (
      <div className="loading-shell">
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className={`study-app theme-${theme}`}>
      <div className="study-shell">
        <header className="hero">
          <div>
            <div className="eyebrow">Standalone Study Room</div>
            <h1>Mingbai</h1>
            <p>
              A local-first Chinese study app for reading, listening, and vocabulary. Review a word, reveal only as much pinyin as you want, then anchor it with sentence context and clips from real speech.
            </p>
          </div>
          <div className="hero-controls">
            <ThemeControl value={theme} onChange={(nextTheme) => updatePreferences({ theme: nextTheme })} />
            <PinyinModeControl value={pinyinMode} onChange={(mode) => {
              updatePreferences({ pinyinMode: mode });
              setRevealPinyin(mode === "always");
            }} />
          </div>
        </header>

        {notice ? (
          <div className={`notice notice-${notice.kind}`}>
            {notice.message}
          </div>
        ) : null}

        <section className="stats-grid">
          <StatCard label="Due now" value={summary.due} note="Cards waiting in the review queue." />
          <StatCard label="New" value={summary.new} note="Fresh words you still need to anchor." />
          <StatCard label="Learning" value={summary.learning} note="Cards still cycling on shorter intervals." />
          <StatCard label="Mature" value={summary.mature} note="Words that have reached longer spacing." />
          <StatCard label="Reviewed today" value={summary.reviewedToday} note="Cards already touched in this session." />
        </section>

        <main className="study-grid">
          <section className="panel panel-soft">
            <div className="panel-head">
              <div>
                <div className="section-kicker">Review Session</div>
                <div className="section-title">{currentCard ? "Current card" : "Queue clear"}</div>
              </div>
              <div className="action-row">
                <button className="btn btn-secondary btn-sm" onClick={copyDeckJson}>Copy JSON</button>
                <button className="btn btn-secondary btn-sm" onClick={importDeckFromClipboard}>Import clipboard</button>
                <button className="btn btn-secondary btn-sm" onClick={downloadDeckJson}>Download JSON</button>
              </div>
            </div>

            {!currentCard ? (
              <div className="empty-state">
                <div className="empty-title">No cards due right now</div>
                <div className="empty-copy">
                  Add new vocabulary on the right, or wait for the next review window. Cards marked <em>Again</em> come back in ten minutes, which makes this a good room for short focused study bursts.
                </div>
              </div>
            ) : (
              <>
                <div className="review-card">
                  <div className="review-meta">
                    <div>Due {fmtDue(currentCard.dueAt)}</div>
                    <div>
                      Interval {currentCard.intervalDays > 0 ? `${currentCard.intervalDays} day${currentCard.intervalDays === 1 ? "" : "s"}` : "new"} · Ease {currentCard.ease.toFixed(2)}
                    </div>
                  </div>

                  <div className="review-focus">
                    <div className="review-hanzi">{currentCard.hanzi}</div>
                    {showCurrentPinyin && currentCard.pinyin ? <div className="pinyin-line review-pinyin">{currentCard.pinyin}</div> : null}
                  </div>

                  {pinyinMode === "reveal" && currentCardHasExtraPinyin && !showCurrentPinyin ? (
                    <div className="center-row">
                      <button className="btn btn-ghost btn-sm" onClick={() => setRevealPinyin(true)}>
                        Reveal pinyin
                      </button>
                    </div>
                  ) : null}

                  {!revealAnswer ? (
                    <div className="center-row">
                      <button className="btn btn-primary" onClick={() => setRevealAnswer(true)}>
                        Reveal meaning and context
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="review-blocks">
                        <div>
                          <div className="section-kicker">Meaning</div>
                          <div className="meaning-copy">{currentCard.gloss}</div>
                        </div>

                        {(currentCard.example || currentCard.exampleTranslation) ? (
                          <div className="example-box">
                            <div className="section-kicker">Sentence Context</div>
                            {currentCard.example ? (
                              <div className="quote-block">
                                <div className="hanzi-line example-line">{currentCard.example}</div>
                                {showCurrentPinyin && currentCard.examplePinyin ? <div className="pinyin-line">{currentCard.examplePinyin}</div> : null}
                              </div>
                            ) : null}
                            {currentCard.exampleTranslation ? <div className="translation-line">{currentCard.exampleTranslation}</div> : null}
                          </div>
                        ) : null}

                        {currentCard.notes ? <div className="notes-copy">{currentCard.notes}</div> : null}

                        {currentCard.clips.length > 0 ? (
                          <div className="clip-section">
                            <div className="section-kicker">Movie and TV usage</div>
                            <div className="clip-grid-cards">
                              {currentCard.clips.map((clip) => (
                                <ClipCard key={clip.id} clip={clip} showPinyin={showCurrentPinyin} />
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>

                      <div className="rating-row">
                        <div className="section-kicker">How did it go?</div>
                        <div className="rating-grid">
                          <button className="btn btn-ghost danger" onClick={() => reviewCurrentCard("again")}>Again</button>
                          <button className="btn btn-secondary" onClick={() => reviewCurrentCard("hard")}>Hard</button>
                          <button className="btn btn-primary" onClick={() => reviewCurrentCard("good")}>Good</button>
                          <button className="btn btn-secondary" onClick={() => reviewCurrentCard("easy")}>Easy</button>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {dueCards.length > 1 ? (
                  <div className="queue-note">
                    {dueCards.length - 1} more card{dueCards.length - 1 === 1 ? "" : "s"} waiting after this one.
                  </div>
                ) : null}
              </>
            )}
          </section>

          <aside className="sidebar">
            <section className="panel">
              <div className="panel-head">
                <div>
                  <div className="section-title">{selectedId ? "Edit word" : "Add word"}</div>
                  <div className="panel-subcopy">
                    Build the card around context first, then attach a few real clips. Tone-marked pinyin works best here.
                  </div>
                </div>
                {selectedId ? (
                  <button className="btn btn-ghost btn-sm" onClick={resetDraft}>
                    New card
                  </button>
                ) : null}
              </div>

              <div className="field-grid">
                <div className="field-pair">
                  <input className="input" value={draft.hanzi} onChange={(event) => updateDraft({ hanzi: event.target.value })} placeholder="Word" />
                  <input className="input" value={draft.pinyin} onChange={(event) => updateDraft({ pinyin: event.target.value })} placeholder="Pinyin (tone marks preferred)" />
                </div>
                <input className="input" value={draft.gloss} onChange={(event) => updateDraft({ gloss: event.target.value })} placeholder="Meaning / gloss" />
                <textarea className="input" rows={2} value={draft.example} onChange={(event) => updateDraft({ example: event.target.value })} placeholder="Example sentence" />
                <input className="input" value={draft.examplePinyin} onChange={(event) => updateDraft({ examplePinyin: event.target.value })} placeholder="Example pinyin" />
                <textarea className="input" rows={2} value={draft.exampleTranslation} onChange={(event) => updateDraft({ exampleTranslation: event.target.value })} placeholder="Example translation" />
                <textarea className="input" rows={3} value={draft.notes} onChange={(event) => updateDraft({ notes: event.target.value })} placeholder="Usage notes, register, memory hooks" />
                <input className="input" value={draft.tags.join(", ")} onChange={(event) => updateDraft({ tags: splitTags(event.target.value) })} placeholder="Tags (comma separated)" />
              </div>

              <div className="clip-editor-section">
                <div className="panel-head tight">
                  <div className="section-kicker">Usage clips</div>
                  <button className="btn btn-secondary btn-sm" onClick={addClip}>
                    Add clip
                  </button>
                </div>
                <div className="clip-editors">
                  {draft.clips.map((clip, index) => (
                    <ClipEditor
                      key={clip.id}
                      clip={clip}
                      index={index}
                      onChange={(patch) => updateClip(clip.id, patch)}
                      onRemove={() => removeClip(clip.id)}
                      disableRemove={draft.clips.length === 1}
                    />
                  ))}
                </div>
              </div>

              <div className="action-row">
                <button className="btn btn-primary" onClick={saveCard}>
                  {selectedId ? "Save word" : "Add word"}
                </button>
                {selectedId ? (
                  <button className="btn btn-ghost danger" onClick={removeCard}>
                    Delete
                  </button>
                ) : null}
              </div>
            </section>

            <section className="panel">
              <div className="panel-head">
                <div>
                  <div className="section-title">Deck</div>
                  <div className="panel-subcopy">{filteredItems.length} card{filteredItems.length === 1 ? "" : "s"}</div>
                </div>
                <input className="input deck-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search deck…" />
              </div>

              {filteredItems.length === 0 ? (
                <div className="empty-copy">
                  No cards match that search yet.
                </div>
              ) : (
                <div className="deck-list">
                  {filteredItems.map((item) => {
                    const selected = item.id === selectedId;
                    const dueNow = new Date(item.dueAt || 0) <= new Date();
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => selectCardForEdit(item)}
                        className={`deck-item${selected ? " is-selected" : ""}`}
                      >
                        <div className="deck-head">
                          <div>
                            <div className="deck-hanzi">{item.hanzi}</div>
                            {pinyinMode === "always" && item.pinyin ? <div className="pinyin-line deck-pinyin">{item.pinyin}</div> : null}
                          </div>
                          <div className={`deck-due${dueNow ? " is-due" : ""}`}>
                            {dueNow ? "Due now" : fmtDue(item.dueAt)}
                          </div>
                        </div>
                        <div className="deck-gloss">{item.gloss}</div>
                        {item.example ? <div className="deck-example">{item.example}</div> : null}
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          </aside>
        </main>
      </div>
    </div>
  );
}
