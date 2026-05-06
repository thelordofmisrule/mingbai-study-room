import { useEffect, useMemo, useRef, useState } from "react";
import {
  createSentenceBankReadings,
  createEmptyReading,
  createReading,
  dueSentenceUnits,
  getSentenceStudyStats,
  normalizeReadingLibrary,
  preserveReadingSentenceData,
  sortReadingSentencesByDifficulty,
  topicSlugFromName,
} from "./lib/readingStore";
import {
  clearReadingLibrary,
  DEFAULT_USER_SLUG,
  fetchReadingLibrary,
  fetchStudyState,
  fetchTtsStatus,
  generateAzureReadingSentenceAudio,
  reviewReadingSentenceById,
  saveReading,
  deleteReadingById,
  updateStudyPreferences,
} from "./lib/studyApi";

const AUDIO_SPEED_OPTIONS = ["1", "0.75", "0.5"];
const STUDY_AUDIO_REPEAT_COUNT = 2;
const STUDY_FLOW_ADVANCE_DELAY_MS = 380;
const STUDY_FLOW_NO_AUDIO_DELAY_MS = 1600;
const AUTOPLAY_OPTIONS = [
  { value: "manual", label: "Pause", note: "Stay on one sentence until you replay or rate it" },
  { value: "autoplay", label: "Autoplay", note: "Play each sentence twice, then wait for your rating" },
  { value: "flow", label: "Flow", note: "Play each sentence twice, mark it Good, and move to the next one" },
];
const PINYIN_OPTIONS = [
  { value: "always", label: "Show", note: "Always show sentence pinyin" },
  { value: "hidden", label: "Hide", note: "Hide pinyin until you want to focus on listening" },
];
const REVIEW_OPTIONS = [
  { value: "again", label: "Repeat", shortcut: "1", note: "Bring it back soon" },
  { value: "good", label: "Good", shortcut: "2", note: "Keep it moving" },
  { value: "easy", label: "Easy", shortcut: "3", note: "Push it further out" },
];

function tagsToFieldValue(tags = []) {
  return Array.isArray(tags) ? tags.join(", ") : "";
}

function parseTagsInput(value = "") {
  return [...new Set(
    String(value || "")
      .split(/[,\n;]/u)
      .map((tag) => tag.trim())
      .filter(Boolean),
  )];
}

function titleFromFilename(filename = "") {
  const basename = String(filename || "").replace(/\.[^.]+$/u, "");
  return basename.replace(/[_-]+/g, " ").trim();
}

function resolveMediaUrl(mediaUrl = "", versionToken = "") {
  const base = String(mediaUrl || "").trim();
  if (!base) return "";
  const token = String(versionToken || "").trim();
  if (!token) return base;
  return `${base}${base.includes("?") ? "&" : "?"}v=${encodeURIComponent(token)}`;
}

function formatPlaybackRate(value = 1) {
  const safe = Number(value);
  if (!Number.isFinite(safe)) return "1x";
  return `${safe}x`;
}

function sentenceStatusLabel(sentence) {
  if (sentence.state === "mature" || sentence.intervalDays >= 21) return "Mastered";
  if (sentence.reps > 0) return "Learning";
  return "Fresh";
}

function countTextDueSentences(text, now = new Date()) {
  return (text.sentences || []).filter((sentence) => new Date(sentence.dueAt || 0) <= now).length;
}

function groupTopics(texts, now = new Date()) {
  const topics = new Map();

  for (const text of texts) {
    const topicSlug = text.topicSlug || topicSlugFromName(text.topic);
    const existing = topics.get(topicSlug) || {
      slug: topicSlug,
      title: text.topic,
      texts: [],
      textCount: 0,
      sentenceCount: 0,
      dueCount: 0,
      masteredCount: 0,
      audioReadyCount: 0,
      missingAudioCount: 0,
    };

    existing.texts.push(text);
    existing.textCount += 1;
    existing.sentenceCount += text.sentences.length;
    existing.dueCount += countTextDueSentences(text, now);
    existing.masteredCount += text.sentences.filter((sentence) => sentence.state === "mature" || sentence.intervalDays >= 21).length;
    existing.audioReadyCount += text.sentences.filter((sentence) => sentence.mediaUrl).length;
    existing.missingAudioCount += text.sentences.filter((sentence) => !sentence.mediaUrl).length;
    topics.set(topicSlug, existing);
  }

  return [...topics.values()].sort((left, right) => (
    left.title.localeCompare(right.title)
  ));
}

function ViewControl({ value, onChange }) {
  return (
    <div className="segmented-control" role="radiogroup" aria-label="Workspace view">
      <button type="button" role="radio" aria-checked={value === "study"} className={`segment${value === "study" ? " is-active" : ""}`} onClick={() => onChange("study")}>
        Study
      </button>
      <button type="button" role="radio" aria-checked={value === "topics"} className={`segment${value === "topics" ? " is-active" : ""}`} onClick={() => onChange("topics")}>
        Topics
      </button>
      <button type="button" role="radio" aria-checked={value === "texts"} className={`segment${value === "texts" ? " is-active" : ""}`} onClick={() => onChange("texts")}>
        Texts
      </button>
    </div>
  );
}

function ThemeControl({ value, onChange }) {
  return (
    <div className="pinyin-control">
      <div className="pinyin-control-label">Theme</div>
      <div className="segmented-control" role="radiogroup" aria-label="Theme mode">
        <button type="button" role="radio" aria-checked={value === "day"} className={`segment${value === "day" ? " is-active" : ""}`} onClick={() => onChange("day")}>
          Day
        </button>
        <button type="button" role="radio" aria-checked={value === "night"} className={`segment${value === "night" ? " is-active" : ""}`} onClick={() => onChange("night")}>
          Night
        </button>
      </div>
    </div>
  );
}

function SettingControl({ label, value, onChange, options, ariaLabel }) {
  return (
    <div className="settings-control">
      <div className="pinyin-control-label">{label}</div>
      <div className="segmented-control" role="radiogroup" aria-label={ariaLabel || label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            className={`segment${value === option.value ? " is-active" : ""}`}
            aria-checked={value === option.value}
            onClick={() => onChange(option.value)}
            title={option.note}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Notice({ notice }) {
  if (!notice) return null;
  return (
    <div className={`notice notice-${notice.kind || "info"}`}>
      {notice.message}
    </div>
  );
}

function SentenceTagList({ tags = [] }) {
  if (!tags.length) return null;
  return (
    <div className="reading-card-tags sentence-tag-list">
      {tags.map((tag) => (
        <span key={tag} className="tag-chip">{tag}</span>
      ))}
    </div>
  );
}

function SettingsPanel({ preferences, onChange, onClose }) {
  const [dailyReps, setDailyReps] = useState(String(preferences.dailyReviewLimit || 100));

  useEffect(() => {
    setDailyReps(String(preferences.dailyReviewLimit || 100));
  }, [preferences.dailyReviewLimit]);

  const saveDailyReps = () => {
    const nextLimit = Math.max(10, Math.min(500, Math.round(Number(dailyReps) || 100)));
    setDailyReps(String(nextLimit));
    onChange({ dailyReviewLimit: nextLimit });
  };

  return (
    <section className="panel settings-panel">
      <div className="panel-head settings-panel-head">
        <div>
          <div className="section-title settings-title">Sentence Settings</div>
          <div className="panel-subcopy">Autoplay, pinyin visibility, playback speed, and daily repetition targets.</div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
      </div>

      <div className="settings-grid">
        <SettingControl
          label="Playback"
          value={["autoplay", "flow"].includes(preferences.audioMode) ? preferences.audioMode : "manual"}
          onChange={(value) => onChange({ audioMode: value })}
          options={AUTOPLAY_OPTIONS}
        />
        <SettingControl
          label="Pinyin"
          value={preferences.pinyinMode === "hidden" ? "hidden" : "always"}
          onChange={(value) => onChange({ pinyinMode: value })}
          options={PINYIN_OPTIONS}
        />
        <div className="settings-control">
          <div className="pinyin-control-label">Speed</div>
          <div className="segmented-control" role="radiogroup" aria-label="Playback speed">
            {AUDIO_SPEED_OPTIONS.map((speed) => (
              <button
                key={speed}
                type="button"
                role="radio"
                className={`segment${String(preferences.audioSpeed || "1") === speed ? " is-active" : ""}`}
                aria-checked={String(preferences.audioSpeed || "1") === speed}
                onClick={() => onChange({ audioSpeed: speed })}
              >
                {formatPlaybackRate(speed)}
              </button>
            ))}
          </div>
        </div>
        <div className="settings-limit-field">
          <div className="pinyin-control-label">Daily reps</div>
          <div className="settings-limit-grid">
            <input
              className="input"
              type="number"
              min="10"
              max="500"
              step="10"
              value={dailyReps}
              onChange={(event) => setDailyReps(event.target.value)}
            />
            <button className="btn btn-primary btn-sm" onClick={saveDailyReps}>
              Save reps
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function TopicCard({
  topic,
  selected = false,
  azureReady = false,
  isGeneratingAudio = false,
  onStudy,
  onBrowse,
  onGenerateAudio,
}) {
  return (
    <article className={`panel topic-card${selected ? " is-selected" : ""}`}>
      <div className="topic-card-head">
        <div>
          <div className="section-kicker">Language island</div>
          <div className="section-title">{topic.title}</div>
        </div>
        <div className="topic-card-chip">{topic.textCount} text{topic.textCount === 1 ? "" : "s"}</div>
      </div>
      <div className="topic-card-stats">
        <div><strong>{topic.sentenceCount}</strong> sentences</div>
        <div><strong>{topic.dueCount}</strong> due now</div>
        <div><strong>{topic.masteredCount}</strong> mastered</div>
        <div><strong>{topic.audioReadyCount}</strong> with audio</div>
      </div>
      <div className="action-row">
        <button className="btn btn-primary btn-sm" onClick={onStudy}>Study island</button>
        <button className="btn btn-secondary btn-sm" onClick={onBrowse}>Browse texts</button>
        <button
          className="btn btn-secondary btn-sm"
          onClick={onGenerateAudio}
          disabled={isGeneratingAudio || !azureReady || !topic.missingAudioCount}
          title={
            !azureReady
              ? "Set up Azure Speech first"
              : !topic.missingAudioCount
                ? "This island already has audio for every sentence"
                : "Generate Azure audio for every missing sentence in this island"
          }
        >
          {isGeneratingAudio ? "Generating..." : topic.missingAudioCount ? `Generate island audio (${topic.missingAudioCount})` : "Island audio ready"}
        </button>
      </div>
    </article>
  );
}

function SentenceBankImporter({
  draft,
  onChange,
  onImport,
  onLoadFile,
  onClose,
  isImporting = false,
}) {
  return (
    <section className="panel workspace-panel text-editor-panel">
      <div className="panel-head">
        <div>
          <div className="section-title">Import sentence bank</div>
          <div className="panel-subcopy">
            Paste one sentence per line, or load a CSV/TSV file. Recommended headers: sentence, pinyin, translation, tags, topic, note.
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          Hide importer
        </button>
      </div>

      <div className="field-grid">
        <input
          className="input"
          value={draft.title}
          onChange={(event) => onChange({ title: event.target.value })}
          placeholder="Collection title"
        />
        <input
          className="input"
          value={draft.topic}
          onChange={(event) => onChange({ topic: event.target.value })}
          placeholder="Default island / topic"
        />
        <input
          className="input"
          value={draft.tags}
          onChange={(event) => onChange({ tags: event.target.value })}
          placeholder="Default tags (comma separated)"
        />
        <textarea
          className="input"
          rows={14}
          value={draft.raw}
          onChange={(event) => onChange({ raw: event.target.value })}
          placeholder={"你好。\tHello.\tni hao\tgreeting, basics\trestaurant\n我要一碗面。\tI'd like a bowl of noodles.\t\tfood, ordering\trestaurant"}
        />
        <textarea
          className="input"
          rows={3}
          value={draft.notes}
          onChange={(event) => onChange({ notes: event.target.value })}
          placeholder="Optional note for this import batch"
        />
      </div>

      <div className="panel-subcopy">
        Fresh imports are automatically sorted from easier to harder sentence order inside each island.
      </div>

      <div className="action-row">
        <button className="btn btn-secondary" type="button" onClick={onLoadFile}>
          Load CSV/TSV file
        </button>
        <button className="btn btn-primary" onClick={onImport} disabled={isImporting}>
          {isImporting ? "Importing..." : "Import sentence bank"}
        </button>
      </div>
    </section>
  );
}

function TextCard({ text, selected = false, dueCount = 0, onSelect }) {
  return (
    <button type="button" className={`reading-card${selected ? " is-selected" : ""}`} onClick={onSelect}>
      {text.coverImageUrl ? (
        <div className="reading-cover-wrap">
          <img className="reading-cover" src={text.coverImageUrl} alt="" />
        </div>
      ) : null}
      <div className="reading-card-body">
        <div className="reading-card-title">{text.title || "Untitled text"}</div>
        <div className="reading-card-meta">
          {text.topic} · {text.sentences.length} sentence{text.sentences.length === 1 ? "" : "s"}
        </div>
        <div className="reading-card-tags">
          {dueCount} due · {text.sentences.filter((sentence) => sentence.mediaUrl).length} with audio
        </div>
      </div>
    </button>
  );
}

function SentenceRow({
  text,
  sentence,
  azureReady = false,
  isGeneratingAudio = false,
  onGenerateAudio,
  onStudyTopic,
}) {
  const audioSrc = resolveMediaUrl(
    sentence.mediaUrl,
    sentence.updatedAt || sentence.storageKey || sentence.assetId,
  );

  return (
    <article className="panel sentence-row-card">
      <div className="sentence-row-head">
        <div className="sentence-row-index">{sentence.position + 1}</div>
        <div className="sentence-row-meta">
          <div className="section-kicker">{sentenceStatusLabel(sentence)}</div>
          <div className="sentence-row-title">{text.title}</div>
        </div>
        <div className="action-row sentence-row-actions">
          {audioSrc ? <audio controls preload="metadata" src={audioSrc} className="sentence-audio" /> : null}
          <button
            className="btn btn-secondary btn-sm"
            onClick={onGenerateAudio}
            disabled={isGeneratingAudio || !azureReady}
            title={azureReady ? "Generate and cache Azure sentence audio" : "Set up Azure Speech first"}
          >
            {isGeneratingAudio ? "Generating..." : audioSrc ? "Refresh audio" : "Azure audio"}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={onStudyTopic}>
            Study topic
          </button>
        </div>
      </div>
      <div className="sentence-row-text">{sentence.text}</div>
      <div className="sentence-row-chip-row">
        <span className="sentence-difficulty-chip">{sentence.difficultyLabel}</span>
        <SentenceTagList tags={sentence.tags} />
      </div>
      {sentence.pinyin ? <div className="sentence-row-pinyin">{sentence.pinyin}</div> : null}
      {sentence.translation ? <div className="translation-line">{sentence.translation}</div> : null}
      {sentence.note ? <div className="clip-note">{sentence.note}</div> : null}
    </article>
  );
}

function TextEditor({
  text,
  onChange,
  onSave,
  onDelete,
  onClose,
  onSortByDifficulty,
  isSaving = false,
  isEditing = false,
}) {
  return (
    <section className="panel workspace-panel text-editor-panel">
      <div className="panel-head">
        <div>
          <div className="section-title">{isEditing ? "Edit text" : "Add text"}</div>
          <div className="panel-subcopy">Import or paste a text, assign it to an island, then tune sentence translations, pinyin, and notes.</div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          Hide editor
        </button>
      </div>

      <div className="field-grid">
        <input className="input" value={text.title} onChange={(event) => onChange({ title: event.target.value })} placeholder="Text title" />
        <input className="input" value={text.topic} onChange={(event) => onChange({ topic: event.target.value })} placeholder="Topic / language island" />
        <input className="input" value={text.coverImageUrl} onChange={(event) => onChange({ coverImageUrl: event.target.value })} placeholder="Cover image URL (optional)" />
        <textarea className="input" rows={10} value={text.body} onChange={(event) => onChange({ body: event.target.value })} placeholder="Paste Chinese text here" />
        <textarea className="input" rows={3} value={text.notes} onChange={(event) => onChange({ notes: event.target.value })} placeholder="Why this text matters or how you want to use it" />
      </div>

      {text.sentences.length > 0 ? (
        <div className="reading-sentence-editor-section">
          <div className="panel-head tight">
            <div>
              <div className="section-kicker">Sentence bank</div>
              <div className="panel-subcopy">Each sentence becomes a repetition unit. Pinyin can be auto-generated and edited here.</div>
            </div>
          </div>
          <div className="reading-draft-sentence-list">
            {text.sentences.map((sentence) => (
              <div key={sentence.id} className="reading-draft-sentence">
                <div className="reading-draft-sentence-head">
                  <div className="sentence-index">{sentence.position + 1}</div>
                  <div className="sentence-text">
                    {sentence.text}
                    <span className="sentence-editor-difficulty">{sentence.difficultyLabel}</span>
                  </div>
                </div>
                <div className="reading-draft-sentence-fields">
                  <textarea
                    className="input"
                    rows={2}
                    value={sentence.pinyin}
                    onChange={(event) => onChange({
                      sentences: text.sentences.map((entry) => (
                        entry.id === sentence.id ? { ...entry, pinyin: event.target.value } : entry
                      )),
                    })}
                    placeholder="Sentence pinyin"
                  />
                  <textarea
                    className="input"
                    rows={2}
                    value={sentence.translation}
                    onChange={(event) => onChange({
                      sentences: text.sentences.map((entry) => (
                        entry.id === sentence.id ? { ...entry, translation: event.target.value } : entry
                      )),
                    })}
                    placeholder="English translation"
                  />
                  <textarea
                    className="input"
                    rows={2}
                    value={sentence.note}
                    onChange={(event) => onChange({
                      sentences: text.sentences.map((entry) => (
                        entry.id === sentence.id ? { ...entry, note: event.target.value } : entry
                      )),
                    })}
                    placeholder="Usage note"
                  />
                  <input
                    className="input"
                    value={tagsToFieldValue(sentence.tags)}
                    onChange={(event) => onChange({
                      sentences: text.sentences.map((entry) => (
                        entry.id === sentence.id ? { ...entry, tags: parseTagsInput(event.target.value) } : entry
                      )),
                    })}
                    placeholder="Sentence tags (comma separated)"
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="action-row">
            <button className="btn btn-secondary btn-sm" type="button" onClick={onSortByDifficulty}>
              Sort easy to hard
            </button>
          </div>
        </div>
      ) : null}

      <div className="action-row">
        <button className="btn btn-primary" onClick={onSave} disabled={isSaving}>
          {isSaving ? "Saving..." : isEditing ? "Save text" : "Add text"}
        </button>
        {isEditing ? (
          <button className="btn btn-ghost danger" onClick={onDelete} disabled={isSaving}>
            Delete
          </button>
        ) : null}
      </div>
    </section>
  );
}

export default function App() {
  const userSlug = DEFAULT_USER_SLUG;
  const importFileInputRef = useRef(null);
  const sentenceBankFileInputRef = useRef(null);
  const currentSentenceAudioRef = useRef(null);
  const playAllAudioRef = useRef(null);
  const playAllQueueRef = useRef({ readingId: "", ids: [], index: 0 });
  const lastAutoplayKeyRef = useRef("");
  const studyPlaybackStateRef = useRef({
    cycleId: 0,
    sentenceId: "",
    repeatsCompleted: 0,
    mode: "manual",
    autoAdvance: false,
  });
  const studyReplayTimeoutRef = useRef(0);
  const studyFlowAdvanceTimeoutRef = useRef(0);

  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState(null);
  const [activeView, setActiveView] = useState("study");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [preferences, setPreferences] = useState({
    theme: "day",
    pinyinMode: "always",
    audioMode: "autoplay",
    audioSpeed: "1",
    dailyReviewLimit: 100,
  });
  const [texts, setTexts] = useState([]);
  const [selectedTextId, setSelectedTextId] = useState("");
  const [activeTopicSlug, setActiveTopicSlug] = useState("all");
  const [isTextEditorOpen, setIsTextEditorOpen] = useState(false);
  const [isSentenceImportOpen, setIsSentenceImportOpen] = useState(false);
  const [textDraft, setTextDraft] = useState(createEmptyReading());
  const [sentenceImportDraft, setSentenceImportDraft] = useState({
    title: "",
    topic: "General",
    tags: "",
    notes: "",
    raw: "",
  });
  const [isTextSaving, setIsTextSaving] = useState(false);
  const [isSentenceImporting, setIsSentenceImporting] = useState(false);
  const [ttsStatus, setTtsStatus] = useState({
    azure: {
      configured: false,
      voiceName: "",
    },
  });
  const [generatingSentenceAudioId, setGeneratingSentenceAudioId] = useState("");
  const [generatingTextAudioId, setGeneratingTextAudioId] = useState("");
  const [generatingTopicAudioSlug, setGeneratingTopicAudioSlug] = useState("");
  const [isReviewSaving, setIsReviewSaving] = useState(false);
  const [playAllSentenceId, setPlayAllSentenceId] = useState("");
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [isFlowActive, setIsFlowActive] = useState(false);

  const pinyinMode = preferences.pinyinMode === "hidden" ? "hidden" : "always";
  const audioMode = ["autoplay", "flow"].includes(preferences.audioMode) ? preferences.audioMode : "manual";
  const audioSpeed = Number(preferences.audioSpeed || "1") || 1;
  const azureReady = !!ttsStatus?.azure?.configured;

  useEffect(() => {
    let cancelled = false;

    async function loadApp() {
      try {
        const [studyState, readingLibrary, nextTtsStatus] = await Promise.all([
          fetchStudyState(userSlug),
          fetchReadingLibrary(userSlug),
          fetchTtsStatus().catch(() => null),
        ]);

        if (cancelled) return;
        setPreferences({
          ...preferences,
          ...(studyState?.preferences || {}),
        });
        const loadedTexts = normalizeReadingLibrary(readingLibrary?.readings || []);
        setTexts(loadedTexts);
        setSelectedTextId(loadedTexts[0]?.id || "");
        if (nextTtsStatus) {
          setTtsStatus(nextTtsStatus);
        }
      } catch (error) {
        if (!cancelled) {
          setNotice({ kind: "error", message: error.message || "Could not load the sentence room." });
        }
      } finally {
        if (!cancelled) {
          setLoaded(true);
        }
      }
    }

    loadApp();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!notice) return undefined;
    const timeoutId = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  const pushNotice = (kind, message) => setNotice({ kind, message });

  const applyTextLibrary = (nextReadings, preferredTextId = "") => {
    const normalized = normalizeReadingLibrary(nextReadings || []);
    setTexts(normalized);
    setSelectedTextId((current) => {
      if (preferredTextId && normalized.some((text) => text.id === preferredTextId)) {
        return preferredTextId;
      }
      if (current && normalized.some((text) => text.id === current)) {
        return current;
      }
      return normalized[0]?.id || "";
    });
  };

  const updatePreferences = async (patch) => {
    const next = await updateStudyPreferences(userSlug, patch);
    setPreferences((prev) => ({
      ...prev,
      ...(next?.preferences || patch),
    }));
  };

  const clearStudyPlaybackTimers = () => {
    if (studyReplayTimeoutRef.current) {
      window.clearTimeout(studyReplayTimeoutRef.current);
      studyReplayTimeoutRef.current = 0;
    }
    if (studyFlowAdvanceTimeoutRef.current) {
      window.clearTimeout(studyFlowAdvanceTimeoutRef.current);
      studyFlowAdvanceTimeoutRef.current = 0;
    }
  };

  const topicSummaries = useMemo(() => groupTopics(texts), [texts]);
  const filteredTexts = useMemo(() => {
    if (activeTopicSlug === "all") return [...texts];
    return texts.filter((text) => text.topicSlug === activeTopicSlug);
  }, [texts, activeTopicSlug]);
  const selectedText = useMemo(() => (
    filteredTexts.find((text) => text.id === selectedTextId)
      || texts.find((text) => text.id === selectedTextId)
      || filteredTexts[0]
      || texts[0]
      || null
  ), [filteredTexts, selectedTextId, texts]);
  const mergeTargetOptions = useMemo(() => (
    texts.filter((text) => text.id !== selectedText?.id)
  ), [texts, selectedText?.id]);
  useEffect(() => {
    if (!mergeTargetOptions.length) {
      setMergeTargetId("");
      return;
    }

    setMergeTargetId((current) => (
      mergeTargetOptions.some((text) => text.id === current)
        ? current
        : mergeTargetOptions[0]?.id || ""
    ));
  }, [mergeTargetOptions]);
  const studyStats = useMemo(() => getSentenceStudyStats(texts, new Date(), {
    dailySentenceLimit: preferences.dailyReviewLimit,
    topicSlug: activeTopicSlug === "all" ? "" : activeTopicSlug,
  }), [texts, preferences.dailyReviewLimit, activeTopicSlug]);
  const sentenceQueue = studyStats.queue || [];
  const currentSentence = sentenceQueue[0] || null;
  const currentTopicTitle = useMemo(() => {
    if (activeTopicSlug === "all") return "All islands";
    return topicSummaries.find((topic) => topic.slug === activeTopicSlug)?.title || "Selected island";
  }, [activeTopicSlug, topicSummaries]);

  const updateTextDraft = (patch) => {
    setTextDraft((prev) => {
      const nextDraft = { ...prev, ...patch };

      if (Object.prototype.hasOwnProperty.call(patch, "body")) {
        return preserveReadingSentenceData(prev, createReading({
          ...nextDraft,
          sentences: undefined,
        }));
      }

      return createReading(nextDraft);
    });
  };

  const openNewTextEditor = () => {
    setTextDraft(createEmptyReading());
    setIsTextEditorOpen(true);
    setIsSentenceImportOpen(false);
    setActiveView("texts");
  };

  const openSentenceImporter = () => {
    setIsSentenceImportOpen(true);
    setIsTextEditorOpen(false);
    setSentenceImportDraft((prev) => ({
      ...prev,
      topic: selectedText?.topic || prev.topic || "General",
    }));
    setActiveView("texts");
  };

  const selectTextForEdit = (text) => {
    if (!text) return;
    setTextDraft(createReading(text));
    setSelectedTextId(text.id);
    setIsTextEditorOpen(true);
    setIsSentenceImportOpen(false);
    setActiveView("texts");
  };

  const closeTextEditor = () => {
    setIsTextEditorOpen(false);
    setTextDraft(selectedText ? createReading(selectedText) : createEmptyReading());
  };

  const closeSentenceImporter = () => {
    setIsSentenceImportOpen(false);
  };

  const importTextFromFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const raw = await file.text();
      const nextDraft = createReading({
        id: createEmptyReading().id,
        title: titleFromFilename(file.name),
        topic: selectedText?.topic || "General",
        body: String(raw || "").replace(/^\uFEFF/u, ""),
      });
      setTextDraft(nextDraft);
      setIsTextEditorOpen(true);
      setIsSentenceImportOpen(false);
      setActiveView("texts");
      pushNotice("success", `${file.name} imported into the text editor.`);
    } catch (error) {
      pushNotice("error", error.message || "Could not import that text file.");
    }
  };

  const loadSentenceBankFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const raw = await file.text();
      setSentenceImportDraft((prev) => ({
        ...prev,
        title: prev.title.trim() || titleFromFilename(file.name),
        raw: String(raw || "").replace(/^\uFEFF/u, ""),
      }));
      setIsSentenceImportOpen(true);
      setIsTextEditorOpen(false);
      setActiveView("texts");
      pushNotice("success", `${file.name} loaded into the sentence importer.`);
    } catch (error) {
      pushNotice("error", error.message || "Could not load that sentence bank file.");
    }
  };

  const saveTextDraft = async () => {
    if (!textDraft.title.trim() || !textDraft.body.trim()) {
      pushNotice("error", "Add a text title and body first.");
      return;
    }

    setIsTextSaving(true);
    try {
      const response = await saveReading(userSlug, textDraft);
      applyTextLibrary(response.readings, textDraft.id);
      setIsTextEditorOpen(false);
      pushNotice("success", `${textDraft.title} saved.`);
    } catch (error) {
      pushNotice("error", error.message || "Could not save that text.");
    } finally {
      setIsTextSaving(false);
    }
  };

  const combineTextNotes = (left = "", right = "") => {
    const first = String(left || "").trim();
    const second = String(right || "").trim();
    if (!first) return second;
    if (!second || first === second) return first;
    return `${first}\n\n${second}`;
  };

  const moveTextToTopic = async (text) => {
    if (!text?.id) return;

    const nextTopicInput = window.prompt(
      `Move "${text.title || "this text"}" to which island/topic?`,
      text.topic || "General",
    );

    if (nextTopicInput === null) return;

    const nextTopic = String(nextTopicInput || "").trim();
    if (!nextTopic) {
      pushNotice("error", "Enter an island/topic name.");
      return;
    }

    const nextText = createReading({
      ...text,
      topic: nextTopic,
    });

    const mergeTarget = texts.find((candidate) => (
      candidate.id !== text.id
      && candidate.topicSlug === nextText.topicSlug
      && candidate.title.trim() === nextText.title.trim()
    ));

    setIsTextSaving(true);
    try {
      if (mergeTarget) {
        const mergedSentences = sortReadingSentencesByDifficulty([
          ...(mergeTarget.sentences || []),
          ...(text.sentences || []),
        ]).map((sentence, index) => ({
          ...sentence,
          position: index,
        }));

        const mergedText = createReading({
          ...mergeTarget,
          topic: nextText.topic,
          coverImageUrl: mergeTarget.coverImageUrl || text.coverImageUrl,
          notes: combineTextNotes(mergeTarget.notes, text.notes),
          tags: [...new Set([...(mergeTarget.tags || []), ...(text.tags || [])])],
          body: mergedSentences.map((sentence) => sentence.text).join("\n"),
          sentences: mergedSentences,
        });

        await saveReading(userSlug, mergedText);
        const response = await deleteReadingById(userSlug, text.id);
        setActiveTopicSlug(mergedText.topicSlug);
        applyTextLibrary(response.readings, mergedText.id);
        pushNotice("success", `Merged ${text.title || "that text"} into ${mergedText.topic}.`);
      } else {
        const response = await saveReading(userSlug, nextText);
        setActiveTopicSlug(nextText.topicSlug);
        applyTextLibrary(response.readings, nextText.id);
        pushNotice("success", `Moved ${nextText.title || "that text"} to ${nextText.topic}.`);
      }
    } catch (error) {
      pushNotice("error", error.message || "Could not move that text to a different island.");
    } finally {
      setIsTextSaving(false);
    }
  };

  const mergeTextIntoTarget = async (sourceText, targetTextId) => {
    if (!sourceText?.id) return;

    const targetText = texts.find((text) => text.id === String(targetTextId || ""));
    if (!targetText || targetText.id === sourceText.id) {
      pushNotice("error", "Choose another text to merge into.");
      return;
    }

    const ok = window.confirm(
      `Merge "${sourceText.title || "this text"}" into "${targetText.title || "that text"}"? `
      + `This will move ${sourceText.sentences.length} sentence${sourceText.sentences.length === 1 ? "" : "s"} and delete the source text.`,
    );
    if (!ok) return;

    const mergedSentences = sortReadingSentencesByDifficulty([
      ...(targetText.sentences || []),
      ...(sourceText.sentences || []),
    ]).map((sentence, index) => ({
      ...sentence,
      position: index,
    }));

    const mergedText = createReading({
      ...targetText,
      coverImageUrl: targetText.coverImageUrl || sourceText.coverImageUrl,
      notes: combineTextNotes(targetText.notes, sourceText.notes),
      tags: [...new Set([...(targetText.tags || []), ...(sourceText.tags || [])])],
      body: mergedSentences.map((sentence) => sentence.text).join("\n"),
      sentences: mergedSentences,
    });

    setIsTextSaving(true);
    try {
      await saveReading(userSlug, mergedText);
      const response = await deleteReadingById(userSlug, sourceText.id);
      setActiveTopicSlug(mergedText.topicSlug);
      applyTextLibrary(response.readings, mergedText.id);
      pushNotice("success", `Merged ${sourceText.title || "that text"} into ${mergedText.title || "the target text"}.`);
    } catch (error) {
      pushNotice("error", error.message || "Could not merge those texts.");
    } finally {
      setIsTextSaving(false);
    }
  };

  const sortTextDraftByDifficulty = () => {
    setTextDraft((prev) => {
      const sortedSentences = sortReadingSentencesByDifficulty(prev.sentences || []);
      return createReading({
        ...prev,
        sentences: sortedSentences,
        body: sortedSentences.map((sentence) => sentence.text).join("\n"),
      });
    });
    pushNotice("success", "Sentences reordered from easier to harder.");
  };

  const deleteText = async () => {
    if (!textDraft.id) return;
    const ok = window.confirm(`Delete ${textDraft.title || "this text"}?`);
    if (!ok) return;

    setIsTextSaving(true);
    try {
      const response = await deleteReadingById(userSlug, textDraft.id);
      applyTextLibrary(response.readings);
      setIsTextEditorOpen(false);
      pushNotice("success", "Text deleted.");
    } catch (error) {
      pushNotice("error", error.message || "Could not delete that text.");
    } finally {
      setIsTextSaving(false);
    }
  };

  const wipeSentenceLibrary = async () => {
    const ok = window.confirm("Delete every imported text and sentence from the library? This keeps settings but clears the sentence bank.");
    if (!ok) return;

    setIsTextSaving(true);
    try {
      const response = await clearReadingLibrary(userSlug);
      applyTextLibrary(response.readings || []);
      setIsTextEditorOpen(false);
      setIsSentenceImportOpen(false);
      setTextDraft(createEmptyReading());
      pushNotice("success", "Sentence library cleared. Ready for a fresh import.");
    } catch (error) {
      pushNotice("error", error.message || "Could not clear the sentence library.");
    } finally {
      setIsTextSaving(false);
    }
  };

  const importSentenceBank = async () => {
    if (!sentenceImportDraft.raw.trim()) {
      pushNotice("error", "Paste some sentences first.");
      return;
    }

    const readings = createSentenceBankReadings(sentenceImportDraft.raw, {
      title: sentenceImportDraft.title,
      topic: sentenceImportDraft.topic,
      tags: parseTagsInput(sentenceImportDraft.tags),
      notes: sentenceImportDraft.notes,
    });

    if (!readings.length) {
      pushNotice("error", "No valid sentence rows were found.");
      return;
    }

    const totalSentences = readings.reduce((sum, reading) => sum + reading.sentences.length, 0);

    setIsSentenceImporting(true);
    try {
      let latestReadings = texts;
      for (const reading of readings) {
        const response = await saveReading(userSlug, reading);
        latestReadings = response.readings || latestReadings;
      }
      applyTextLibrary(latestReadings, readings[0]?.id || "");
      setIsSentenceImportOpen(false);
      setSentenceImportDraft({
        title: "",
        topic: sentenceImportDraft.topic || "General",
        tags: "",
        notes: "",
        raw: "",
      });
      pushNotice(
        "success",
        `Imported ${totalSentences} sentence${totalSentences === 1 ? "" : "s"} into ${readings.length} island${readings.length === 1 ? "" : "s"}.`,
      );
    } catch (error) {
      pushNotice("error", error.message || "Could not import the sentence bank.");
    } finally {
      setIsSentenceImporting(false);
    }
  };

  const generateSentenceAudio = async (text, sentence) => {
    if (!text?.id || !sentence?.id) return;
    setGeneratingSentenceAudioId(sentence.id);
    try {
      const response = await generateAzureReadingSentenceAudio(userSlug, text.id, sentence.id);
      applyTextLibrary(response.readings, text.id);
      pushNotice("success", "Sentence audio cached.");
    } catch (error) {
      pushNotice("error", error.message || "Could not generate sentence audio.");
    } finally {
      setGeneratingSentenceAudioId("");
    }
  };

  const ensureTextAudio = async (text, { promptBeforeGenerate = false, silent = false } = {}) => {
    if (!text?.id) return text;
    const sentencesWithoutAudio = (text.sentences || []).filter((sentence) => !sentence.mediaUrl);
    if (!sentencesWithoutAudio.length) return text;

    if (!azureReady) {
      pushNotice("error", "Set up Azure Speech first.");
      return null;
    }

    if (promptBeforeGenerate) {
      const ok = window.confirm(
        `${sentencesWithoutAudio.length} sentence${sentencesWithoutAudio.length === 1 ? "" : "s"} are missing audio. Generate them now first?`,
      );
      if (!ok) return null;
    }

    setGeneratingTextAudioId(text.id);
    try {
      let latestTexts = texts;
      let latestText = text;

      for (const sentence of sentencesWithoutAudio) {
        const response = await generateAzureReadingSentenceAudio(userSlug, text.id, sentence.id);
        latestTexts = normalizeReadingLibrary(response.readings || latestTexts);
        latestText = latestTexts.find((entry) => entry.id === text.id) || latestText;
        applyTextLibrary(latestTexts, text.id);
      }

      if (!silent) {
        pushNotice(
          "success",
          `Generated audio for ${sentencesWithoutAudio.length} sentence${sentencesWithoutAudio.length === 1 ? "" : "s"}.`,
        );
      }
      return latestText;
    } catch (error) {
      const message = error.message || "Could not finish generating sentence audio.";
      if (!silent) {
        pushNotice("error", message);
      } else {
        throw new Error(`${text?.title || "Text"}: ${message}`);
      }
    } finally {
      setGeneratingTextAudioId("");
    }
  };

  const generateTopicAudio = async (topicSlug, { promptBeforeGenerate = false } = {}) => {
    const slug = String(topicSlug || "").trim();
    const topicTexts = texts.filter((text) => text.topicSlug === slug);
    if (!topicTexts.length) {
      pushNotice("error", "No texts found in that island.");
      return;
    }

    if (!azureReady) {
      pushNotice("error", "Set up Azure Speech first.");
      return;
    }

    const sentencesWithoutAudio = topicTexts.reduce(
      (sum, text) => sum + text.sentences.filter((sentence) => !sentence.mediaUrl).length,
      0,
    );

    if (!sentencesWithoutAudio) {
      pushNotice("info", "That island already has audio for every sentence.");
      return;
    }

    if (promptBeforeGenerate) {
      const ok = window.confirm(
        `Generate Azure audio for ${sentencesWithoutAudio} sentence${sentencesWithoutAudio === 1 ? "" : "s"} across ${topicTexts.length} text${topicTexts.length === 1 ? "" : "s"}?`,
      );
      if (!ok) return;
    }

    setGeneratingTopicAudioSlug(slug);
    try {
      for (const originalText of topicTexts) {
        const updatedText = await ensureTextAudio(originalText, { silent: true });
        if (!updatedText) return;
      }

      pushNotice(
        "success",
        `Generated island audio for ${sentencesWithoutAudio} sentence${sentencesWithoutAudio === 1 ? "" : "s"} in ${topicTexts.length} text${topicTexts.length === 1 ? "" : "s"}.`,
      );
    } catch (error) {
      pushNotice("error", error.message || "Could not finish generating island audio.");
    } finally {
      setGeneratingTopicAudioSlug("");
    }
  };

  const stopPlayAllSentences = () => {
    const audio = playAllAudioRef.current;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute("src");
      try { audio.load(); } catch (_) { /* ignore */ }
    }
    playAllQueueRef.current = { readingId: "", ids: [], index: 0 };
    setPlayAllSentenceId("");
  };

  const playAllSentencesForText = async (text) => {
    if (!text?.id) return;
    const readyText = await ensureTextAudio(text, { promptBeforeGenerate: true });
    if (!readyText?.id) return;

    const sentences = (readyText.sentences || []).filter((sentence) => sentence.mediaUrl);
    if (!sentences.length) {
      pushNotice("info", "No sentence audio available yet.");
      return;
    }

    stopPlayAllSentences();

    const audio = playAllAudioRef.current || new Audio();
    playAllAudioRef.current = audio;
    const playbackRate = Number(preferences.audioSpeed || "1") || 1;
    playAllQueueRef.current = {
      readingId: readyText.id,
      ids: sentences.map((sentence) => sentence.id),
      index: 0,
    };

    const playIndex = (index) => {
      const current = playAllQueueRef.current;
      if (!current.ids[index] || current.readingId !== readyText.id) {
        stopPlayAllSentences();
        return;
      }

      const sentence = sentences[index];
      const src = resolveMediaUrl(
        sentence.mediaUrl,
        sentence.updatedAt || sentence.storageKey || sentence.assetId,
      );
      if (!src) {
        playAllQueueRef.current = { ...current, index: index + 1 };
        playIndex(index + 1);
        return;
      }

      audio.onended = null;
      audio.onerror = null;
      audio.pause();

      let advanced = false;
      const advance = () => {
        if (advanced) return;
        advanced = true;
        const next = playAllQueueRef.current;
        if (next.readingId !== readyText.id) return;
        playAllQueueRef.current = { ...next, index: index + 1 };
        playIndex(index + 1);
      };

      setPlayAllSentenceId(sentence.id);
      audio.src = src;
      audio.playbackRate = playbackRate;
      audio.onended = advance;
      audio.onerror = advance;

      try {
        audio.load();
      } catch (_) { /* ignore */ }

      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => advance());
      }
    };

    playIndex(0);
  };

  useEffect(() => () => stopPlayAllSentences(), []);

  useEffect(() => () => clearStudyPlaybackTimers(), []);

  useEffect(() => {
    if (activeView !== "texts") {
      stopPlayAllSentences();
    }
  }, [activeView]);

  useEffect(() => {
    if (audioMode !== "flow") {
      setIsFlowActive(false);
    }
  }, [audioMode]);

  const reviewCurrentSentence = async (rating, options = {}) => {
    const targetSentence = options.targetSentence || currentSentence;
    if (!targetSentence || isReviewSaving) return;

    setIsReviewSaving(true);
    try {
      const response = await reviewReadingSentenceById(
        userSlug,
        targetSentence.readingId,
        targetSentence.id,
        rating,
      );
      applyTextLibrary(response.readings, targetSentence.readingId);
    } catch (error) {
      if (!options.silent) {
        pushNotice("error", error.message || "Could not record that repetition.");
      }
    } finally {
      setIsReviewSaving(false);
    }
  };

  const queueFlowAdvance = (targetSentence, cycleId) => {
    clearStudyPlaybackTimers();
    studyFlowAdvanceTimeoutRef.current = window.setTimeout(() => {
      const playbackState = studyPlaybackStateRef.current;
      if (playbackState.cycleId !== cycleId || playbackState.sentenceId !== targetSentence.id) return;
      reviewCurrentSentence("good", {
        silent: true,
        targetSentence,
      });
    }, STUDY_FLOW_ADVANCE_DELAY_MS);
  };

  const playCurrentSentence = ({ mode = audioMode, autoAdvance = mode === "flow" } = {}) => {
    clearStudyPlaybackTimers();

    const targetSentence = currentSentence;
    const audio = currentSentenceAudioRef.current;
    const hasAudio = !!(targetSentence && currentSentenceAudioSrc && audio);
    const nextCycleId = studyPlaybackStateRef.current.cycleId + 1;

    studyPlaybackStateRef.current = {
      cycleId: nextCycleId,
      sentenceId: targetSentence?.id || "",
      repeatsCompleted: 0,
      mode,
      autoAdvance,
    };

    if (!targetSentence) return;

    if (!hasAudio) {
      if (autoAdvance) {
        studyFlowAdvanceTimeoutRef.current = window.setTimeout(() => {
          const playbackState = studyPlaybackStateRef.current;
          if (playbackState.cycleId !== nextCycleId || playbackState.sentenceId !== targetSentence.id) return;
          reviewCurrentSentence("good", {
            silent: true,
            targetSentence,
          });
        }, STUDY_FLOW_NO_AUDIO_DELAY_MS);
      }
      return;
    }

    audio.pause();
    audio.currentTime = 0;
    audio.playbackRate = audioSpeed;

    const playPromise = audio.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {
        if (autoAdvance) {
          queueFlowAdvance(targetSentence, nextCycleId);
        }
      });
    }
  };

  const handleCurrentSentenceAudioEnded = () => {
    const playbackState = studyPlaybackStateRef.current;
    const audio = currentSentenceAudioRef.current;
    const targetSentence = currentSentence;

    if (!playbackState.sentenceId || playbackState.sentenceId !== targetSentence?.id) return;
    if (!audio) return;

    if ((playbackState.repeatsCompleted + 1) < STUDY_AUDIO_REPEAT_COUNT) {
      playbackState.repeatsCompleted += 1;
      const cycleId = playbackState.cycleId;
      studyReplayTimeoutRef.current = window.setTimeout(() => {
        const latestState = studyPlaybackStateRef.current;
        if (latestState.cycleId !== cycleId || latestState.sentenceId !== targetSentence?.id) return;
        audio.currentTime = 0;
        audio.playbackRate = audioSpeed;
        const replayPromise = audio.play();
        if (replayPromise && typeof replayPromise.catch === "function") {
          replayPromise.catch(() => {
            if (latestState.autoAdvance && targetSentence) {
              queueFlowAdvance(targetSentence, cycleId);
            }
          });
        }
      }, 180);
      return;
    }

    playbackState.repeatsCompleted = STUDY_AUDIO_REPEAT_COUNT;
    if (playbackState.autoAdvance && targetSentence) {
      queueFlowAdvance(targetSentence, playbackState.cycleId);
    }
  };

  useEffect(() => {
    clearStudyPlaybackTimers();
    studyPlaybackStateRef.current = {
      cycleId: studyPlaybackStateRef.current.cycleId + 1,
      sentenceId: currentSentence?.id || "",
      repeatsCompleted: 0,
      mode: audioMode,
      autoAdvance: audioMode === "flow",
    };

    const audio = currentSentenceAudioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    audio.playbackRate = audioSpeed;
  }, [audioSpeed, currentSentence?.id, currentSentence?.mediaUrl, audioMode]);

  useEffect(() => {
    if (activeView !== "study") {
      clearStudyPlaybackTimers();
      const audio = currentSentenceAudioRef.current;
      if (audio) {
        audio.pause();
      }
      setIsFlowActive(false);
      return;
    }

    if (audioMode === "manual" || isReviewSaving || !currentSentence) {
      return;
    }

    if (audioMode === "flow" && !isFlowActive) {
      return;
    }

    const autoplayKey = `${audioMode}:${currentSentence.id}:${currentSentence.mediaUrl || "no-audio"}`;
    if (lastAutoplayKeyRef.current === autoplayKey) return;

    lastAutoplayKeyRef.current = autoplayKey;
    playCurrentSentence({
      mode: audioMode,
      autoAdvance: audioMode === "flow",
    });
  }, [activeView, audioMode, currentSentence, currentSentence?.mediaUrl, isReviewSaving, audioSpeed, isFlowActive]);

  useEffect(() => {
    lastAutoplayKeyRef.current = "";
  }, [currentSentence?.id]);

  const replayCurrentSentence = () => {
    if (audioMode === "flow") {
      setIsFlowActive(true);
    }
    playCurrentSentence({
      mode: audioMode,
      autoAdvance: audioMode === "flow",
    });
  };

  useEffect(() => {
    if (activeView !== "study" || !currentSentence) return undefined;

    const handleKeydown = (event) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement
        && (
          target.isContentEditable
          || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
        )
      ) {
        return;
      }

      if (event.key === " ") {
        event.preventDefault();
        replayCurrentSentence();
        return;
      }

      if (audioMode === "flow") {
        return;
      }

      const rating = REVIEW_OPTIONS.find((option) => option.shortcut === event.key)?.value;
      if (!rating) return;
      event.preventDefault();
      reviewCurrentSentence(rating);
    };

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [activeView, audioMode, currentSentence, isReviewSaving]);

  if (!loaded) {
    return (
      <div className="loading-shell">
        <div className="spinner" />
      </div>
    );
  }

  const filteredTextCount = filteredTexts.length;
  const currentSentenceAudioSrc = currentSentence
    ? resolveMediaUrl(
        currentSentence.mediaUrl,
        currentSentence.updatedAt || currentSentence.storageKey || currentSentence.assetId,
      )
    : "";

  return (
    <div className={`study-app theme-${preferences.theme || "day"}`}>
      <Notice notice={notice} />
      <div className="study-shell">
        <header className="topbar">
          <div className="topbar-left">
            <div className="brand-title">Mingbai Sentence Lab</div>
            <ViewControl value={activeView} onChange={setActiveView} />
            <div className="reps-counter">
              <strong>{studyStats.summary.totalReviewCount || 0}</strong> total reps
            </div>
            <div className="queue-inline-note">
              {studyStats.summary.dueNow} in queue · {studyStats.summary.backlogDue} backlog · {studyStats.summary.totalTexts} texts
            </div>
          </div>
          <div className="topbar-controls">
            <ThemeControl value={preferences.theme || "day"} onChange={(value) => updatePreferences({ theme: value })} />
            <button className={`btn btn-secondary btn-sm${isSettingsOpen ? " is-active" : ""}`} onClick={() => setIsSettingsOpen((open) => !open)}>
              Settings
            </button>
          </div>
        </header>

        {isSettingsOpen ? (
          <SettingsPanel
            preferences={preferences}
            onChange={updatePreferences}
            onClose={() => setIsSettingsOpen(false)}
          />
        ) : null}

        <input
          ref={importFileInputRef}
          type="file"
          accept=".txt,.text,.md,text/plain,text/markdown"
          className="hidden-input"
          onChange={importTextFromFile}
          aria-hidden="true"
          tabIndex={-1}
        />
        <input
          ref={sentenceBankFileInputRef}
          type="file"
          accept=".csv,.CSV,.tsv,.TSV,.txt,.TXT,text/*,application/vnd.ms-excel"
          className="hidden-input"
          onChange={loadSentenceBankFile}
          aria-hidden="true"
          tabIndex={-1}
        />

        {activeView === "study" ? (
          <section className="sentence-stage panel panel-soft">
            <div className="panel-head sentence-stage-head">
              <div>
                <div className="section-kicker">Daily repetitions</div>
                <div className="section-title">{currentTopicTitle}</div>
                <div className="panel-subcopy">
                  {studyStats.summary.dueNow} due now, {studyStats.summary.backlogDue} waiting behind your daily cap of {preferences.dailyReviewLimit || 100}.
                </div>
              </div>
              <div className="deck-tools">
                <label className="reading-toolbar-field">
                  <span>Topic</span>
                  <select className="input" value={activeTopicSlug} onChange={(event) => setActiveTopicSlug(event.target.value)}>
                    <option value="all">All islands</option>
                    {topicSummaries.map((topic) => (
                      <option key={topic.slug} value={topic.slug}>{topic.title}</option>
                    ))}
                  </select>
                </label>
                <SettingControl
                  label="Playback"
                  value={audioMode}
                  onChange={(value) => updatePreferences({ audioMode: value })}
                  options={AUTOPLAY_OPTIONS}
                />
              </div>
            </div>

            {!currentSentence ? (
              <div className="empty-state">
                <div className="empty-title">No sentence reps due right now</div>
                <div className="empty-copy">Import more texts, add them to an island, or switch the topic filter back to all islands.</div>
              </div>
            ) : (
              <div className="sentence-player">
                {currentSentenceAudioSrc ? (
                  <audio
                    ref={currentSentenceAudioRef}
                    preload="metadata"
                    src={currentSentenceAudioSrc}
                    className="review-audio-element"
                    onEnded={handleCurrentSentenceAudioEnded}
                    onError={handleCurrentSentenceAudioEnded}
                  />
                ) : null}

                <div className="sentence-player-meta">
                  <div className="sentence-player-chip">{currentSentence.topic}</div>
                  <div className="sentence-player-chip is-secondary">{currentSentence.difficultyLabel}</div>
                  <div className="sentence-player-copy">
                    {currentSentence.readingTitle} · {sentenceQueue.length} in queue
                  </div>
                </div>
                <SentenceTagList tags={currentSentence.tags} />

                <div className="sentence-player-body">
                  <div className="sentence-player-text">{currentSentence.text}</div>
                  {pinyinMode !== "hidden" ? (
                    <div className="sentence-player-pinyin">
                      {currentSentence.pinyin || "Pinyin is still being prepared for this sentence."}
                    </div>
                  ) : null}
                  {currentSentence.translation ? (
                    <div className="sentence-player-translation">{currentSentence.translation}</div>
                  ) : null}
                  {currentSentence.note ? <div className="notes-copy sentence-player-note">{currentSentence.note}</div> : null}
                </div>

                <div className="sentence-player-controls">
                  <button className="btn btn-secondary btn-sm" onClick={replayCurrentSentence}>
                    {audioMode === "flow" ? (isFlowActive ? "Restart flow" : "Start flow") : "Replay x2"}
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      const sourceText = texts.find((text) => text.id === currentSentence.readingId);
                      if (sourceText) {
                        const sourceSentence = sourceText.sentences.find((sentence) => sentence.id === currentSentence.id);
                        if (sourceSentence) {
                          generateSentenceAudio(sourceText, sourceSentence);
                        }
                      }
                    }}
                    disabled={generatingSentenceAudioId === currentSentence.id || !azureReady}
                    title={azureReady ? "Generate or refresh audio for this sentence" : "Set up Azure Speech first"}
                  >
                    {generatingSentenceAudioId === currentSentence.id ? "Generating..." : currentSentenceAudioSrc ? "Refresh audio" : "Generate audio"}
                  </button>
                  {audioMode === "flow" ? (
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => setIsFlowActive(false)}
                    >
                      Pause flow
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="audio-speed-chip audio-speed-chip-button"
                    onClick={() => {
                      const currentIndex = AUDIO_SPEED_OPTIONS.findIndex((speed) => speed === String(preferences.audioSpeed || "1"));
                      const nextIndex = (currentIndex + 1) % AUDIO_SPEED_OPTIONS.length;
                      updatePreferences({ audioSpeed: AUDIO_SPEED_OPTIONS[nextIndex] });
                    }}
                    title="Click to change playback speed"
                    aria-label={`Playback speed ${formatPlaybackRate(audioSpeed)} — click to change`}
                  >
                    {formatPlaybackRate(audioSpeed)}
                  </button>
                </div>

                {audioMode === "flow" ? (
                  <div className="panel-subcopy sentence-flow-note">
                    {isFlowActive
                      ? <>Flow mode plays each sentence twice, records it as <strong>Good</strong>, and advances automatically until the queue is done.</>
                      : <>Flow mode is paused. Press <strong>Start flow</strong> when you want it to begin advancing.</>}
                  </div>
                ) : (
                  <div className="rating-grid sentence-rating-grid">
                    {REVIEW_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        className="btn btn-primary"
                        onClick={() => reviewCurrentSentence(option.value)}
                        disabled={isReviewSaving}
                      >
                        <span className="rating-keycap">{option.shortcut}</span>
                        {option.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        ) : null}

        {activeView === "topics" ? (
          <section className="topic-grid">
            {topicSummaries.length === 0 ? (
              <div className="empty-state">
                <div className="empty-title">No islands yet</div>
                <div className="empty-copy">Create a text, give it a topic like ordering at a restaurant or going to the barber, and the app will start building sentence reps around that island.</div>
              </div>
            ) : (
              topicSummaries.map((topic) => (
                <TopicCard
                  key={topic.slug}
                  topic={topic}
                  selected={topic.slug === activeTopicSlug}
                  azureReady={azureReady}
                  isGeneratingAudio={generatingTopicAudioSlug === topic.slug}
                  onStudy={() => {
                    setActiveTopicSlug(topic.slug);
                    setActiveView("study");
                  }}
                  onBrowse={() => {
                    setActiveTopicSlug(topic.slug);
                    setActiveView("texts");
                  }}
                  onGenerateAudio={() => generateTopicAudio(topic.slug, { promptBeforeGenerate: true })}
                />
              ))
            )}
          </section>
        ) : null}

        {activeView === "texts" ? (
          <section className={`workspace-grid sentence-library-grid${isTextEditorOpen || isSentenceImportOpen ? " has-editor" : ""}`}>
            <section className="panel workspace-panel">
              <div className="panel-head">
                <div>
                  <div className="section-title">Text Library</div>
                  <div className="panel-subcopy">
                    {filteredTextCount} of {texts.length} text{texts.length === 1 ? "" : "s"} shown. Each text feeds a bank of sentence repetitions.
                  </div>
                </div>
                <div className="deck-tools">
                  <label className="reading-toolbar-field">
                    <span>Topic</span>
                    <select className="input" value={activeTopicSlug} onChange={(event) => setActiveTopicSlug(event.target.value)}>
                      <option value="all">All islands</option>
                      {topicSummaries.map((topic) => (
                        <option key={topic.slug} value={topic.slug}>{topic.title}</option>
                      ))}
                    </select>
                  </label>
                  <button className="btn btn-secondary btn-sm" onClick={() => importFileInputRef.current?.click()}>
                    Import text file
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={openSentenceImporter}>
                    Import sentence bank
                  </button>
                  {activeTopicSlug !== "all" ? (
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => generateTopicAudio(activeTopicSlug, { promptBeforeGenerate: true })}
                      disabled={generatingTopicAudioSlug === activeTopicSlug || !azureReady}
                    >
                      {generatingTopicAudioSlug === activeTopicSlug ? "Generating island..." : "Generate island audio"}
                    </button>
                  ) : null}
                  <button className="btn btn-secondary btn-sm" onClick={openNewTextEditor}>
                    Add text
                  </button>
                  <button className="btn btn-ghost btn-sm danger" onClick={wipeSentenceLibrary} disabled={isTextSaving || isSentenceImporting}>
                    Wipe library
                  </button>
                </div>
              </div>

              {filteredTexts.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-title">No texts yet</div>
                  <div className="empty-copy">Import a text, assign it to a topic, and start farming sentence reps.</div>
                </div>
              ) : (
                <div className="reading-card-grid">
                  {filteredTexts.map((text) => (
                    <TextCard
                      key={text.id}
                      text={text}
                      selected={text.id === selectedText?.id}
                      dueCount={countTextDueSentences(text)}
                      onSelect={() => setSelectedTextId(text.id)}
                    />
                  ))}
                </div>
              )}
            </section>

            <section className="panel workspace-panel reader-detail-panel">
              {selectedText ? (
                <>
                  <div className="panel-head">
                    <div>
                      <div className="section-title">{selectedText.title}</div>
                      <div className="panel-subcopy">
                        {selectedText.topic} · {selectedText.sentences.length} sentence{selectedText.sentences.length === 1 ? "" : "s"} · {countTextDueSentences(selectedText)} due now
                      </div>
                    </div>
                    <div className="action-row">
                      <button
                        className={`btn btn-primary btn-sm${playAllQueueRef.current.readingId === selectedText.id ? " is-active" : ""}`}
                        onClick={() => (
                          playAllQueueRef.current.readingId === selectedText.id
                            ? stopPlayAllSentences()
                            : playAllSentencesForText(selectedText)
                        )}
                        disabled={generatingTextAudioId === selectedText.id}
                      >
                        {playAllQueueRef.current.readingId === selectedText.id ? "Stop" : generatingTextAudioId === selectedText.id ? "Preparing..." : "Play all"}
                      </button>
                      <button
                        type="button"
                        className="audio-speed-chip audio-speed-chip-button"
                        onClick={() => {
                          const currentIndex = AUDIO_SPEED_OPTIONS.findIndex((speed) => speed === String(preferences.audioSpeed || "1"));
                          const nextIndex = (currentIndex + 1) % AUDIO_SPEED_OPTIONS.length;
                          updatePreferences({ audioSpeed: AUDIO_SPEED_OPTIONS[nextIndex] });
                        }}
                        title="Click to change playback speed"
                        aria-label={`Playback speed ${formatPlaybackRate(audioSpeed)} — click to change`}
                      >
                        {formatPlaybackRate(audioSpeed)}
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => ensureTextAudio(selectedText)}
                        disabled={generatingTextAudioId === selectedText.id || !azureReady}
                        title={azureReady ? "Generate Azure sentence audio for every missing sentence in this text" : "Set up Azure Speech first"}
                      >
                        {generatingTextAudioId === selectedText.id ? "Generating..." : "Generate missing audio"}
                      </button>
                      <button className="btn btn-secondary btn-sm" onClick={() => moveTextToTopic(selectedText)} disabled={isTextSaving}>
                        Move island
                      </button>
                      {mergeTargetOptions.length ? (
                        <>
                          <select
                            className="input"
                            value={mergeTargetId}
                            onChange={(event) => setMergeTargetId(event.target.value)}
                            aria-label="Merge this text into another text"
                          >
                            {mergeTargetOptions.map((text) => (
                              <option key={text.id} value={text.id}>
                                {text.title || "Untitled text"} · {text.topic}
                              </option>
                            ))}
                          </select>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => mergeTextIntoTarget(selectedText, mergeTargetId)}
                            disabled={isTextSaving || !mergeTargetId}
                          >
                            Merge text
                          </button>
                        </>
                      ) : null}
                      <button className="btn btn-ghost btn-sm" onClick={() => selectTextForEdit(selectedText)}>
                        Edit text
                      </button>
                    </div>
                  </div>

                  {selectedText.coverImageUrl ? (
                    <div className="reading-detail-cover-wrap">
                      <img className="reading-detail-cover" src={selectedText.coverImageUrl} alt="" />
                    </div>
                  ) : null}
                  {selectedText.notes ? <div className="notes-copy">{selectedText.notes}</div> : null}

                  <div className="sentence-list">
                    {selectedText.sentences.map((sentence) => (
                      <SentenceRow
                        key={sentence.id}
                        text={selectedText}
                        sentence={sentence}
                        azureReady={azureReady}
                        isGeneratingAudio={generatingSentenceAudioId === sentence.id}
                        onGenerateAudio={() => generateSentenceAudio(selectedText, sentence)}
                        onStudyTopic={() => {
                          setActiveTopicSlug(selectedText.topicSlug);
                          setActiveView("study");
                        }}
                      />
                    ))}
                  </div>
                </>
              ) : (
                <div className="empty-state">
                  <div className="empty-title">Pick a text</div>
                  <div className="empty-copy">Select a text to inspect its sentences, generate audio, and send that topic into the study queue.</div>
                </div>
              )}
            </section>

            {isTextEditorOpen ? (
              <TextEditor
                text={textDraft}
                onChange={updateTextDraft}
                onSave={saveTextDraft}
                onDelete={deleteText}
                onClose={closeTextEditor}
                onSortByDifficulty={sortTextDraftByDifficulty}
                isSaving={isTextSaving}
                isEditing={texts.some((text) => text.id === textDraft.id)}
              />
            ) : null}

            {isSentenceImportOpen ? (
              <SentenceBankImporter
                draft={sentenceImportDraft}
                onChange={(patch) => setSentenceImportDraft((prev) => ({ ...prev, ...patch }))}
                onImport={importSentenceBank}
                onLoadFile={() => sentenceBankFileInputRef.current?.click()}
                onClose={closeSentenceImporter}
                isImporting={isSentenceImporting}
              />
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}
