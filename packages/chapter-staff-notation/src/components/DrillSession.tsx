/**
 * DrillSession — Anki-like progressive staff note reading drill.
 *
 * Stages:
 *   1. Treble · C4       (C4–B4, 7 notes)
 *   2. Treble · C5       (C5–B5, 7 notes)
 *   3. Treble · C4 + C5  (C4–B5, 14 notes)
 *   4. Bass   · C2       (C2–B2, 7 notes)
 *   5. Bass   · C3       (C3–B3, 7 notes)
 *   6. Bass   · C2 + C3  (C2–B3, 14 notes)
 *   7. Grand staff       (C2–B5, 28 notes across bass/treble clefs)
 *
 * Mastery rule: 3 consecutive correct answers per note.
 * Progress is persisted to localStorage.
 * Users can freely switch between any stage at any time.
 */
import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  Card, Button, Space, Typography, Progress, Tag,
  Tooltip, Popconfirm, Grid, Select, Collapse,
  message,
} from 'antd';
import {
  CheckOutlined, CloseOutlined, ReloadOutlined,
  TrophyOutlined, FireOutlined, MenuOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  DRILL_STAGE_ORDER,
  DRILL_STAGE_NOTES,
  COMMON_MAJOR_KEYS,
  applyKeyToPool,
  pickRandomAccidental,
  applySpecificAccidental,
  ACCIDENTAL_OPTIONS,
  type DrillStage,
  type NoteProgress,
  type AccidentalOption,
  selectDrillNote,
  getDrillDistractors,
  shuffleArray,
  getClefForNote,
  useAudio,
  triggerOpenDrawer,
  isAccidentalApplicable,
} from '@ezmusic/shared';
import StaffDisplay from './StaffDisplay';
import { PianoKeyboard, type KeyHighlight } from '@ezmusic/shared';

const { Text } = Typography;
const { useBreakpoint } = Grid;

const STORAGE_KEY = 'ezmusic-staff-drill-progress';
const MASTERY_STREAK = 3;
const NOTE_PLAY_DURATION = 0.8;
const ANSWER_FEEDBACK_DELAY_MS = NOTE_PLAY_DURATION * 1000 + 150;
/** Delay before auto-advancing to next question on correct answer */
const AUTO_ADVANCE_DELAY_MS = 1200;
/** Delay for wrong answer: playNote resolves immediately (Tone.js schedules playback),
 *  so the actual wait is gap(ANSWER_FEEDBACK_DELAY_MS) + correctNote(NOTE_PLAY_DURATION) + buffer */
const WRONG_ANSWER_AUTO_ADVANCE_DELAY_MS =
  ANSWER_FEEDBACK_DELAY_MS + NOTE_PLAY_DURATION * 1000 + 400;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/** Training mode: note-name buttons or piano keyboard (with or without note labels) */
type DrillMode = 'note-name' | 'piano' | 'piano-no-labels';

/** Compute the keyboard range for a given note pool (extend max to next C for completeness). */
function getKeyboardRange(pool: readonly string[]): { min: string; max: string } {
  const min = pool[0];
  const max = pool[pool.length - 1];
  // If the max note is not a C, extend to C of the next octave
  const maxPC = max.replace(/\d+$/, '');
  const maxOctMatch = /\d+$/.exec(max);
  const maxOct = maxOctMatch ? parseInt(maxOctMatch[0], 10) : 4;
  const extendedMax = maxPC === 'C' ? max : `C${maxOct + 1}`;
  return { min, max: extendedMax };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DrillProgressStore {
  noteProgress: Record<string, NoteProgress>;
  /** Persisted training stage preference */
  preferredStage?: DrillStage;
  /** Persisted training mode preference */
  preferredMode?: DrillMode;
  /** Persisted key signature preference */
  preferredKeySignature?: string;
  /** Persisted accidental selection preference */
  preferredAccidentals?: AccidentalOption[];
  /** Persisted collapse panel expanded state */
  progressPanelExpanded?: boolean;
}

function emptyProgress(): DrillProgressStore {
  return {
    noteProgress: {},
  };
}

function loadProgress(): DrillProgressStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DrillProgressStore & { unlockedStages?: unknown }>;
      return {
        noteProgress: parsed.noteProgress ?? {},
        preferredStage: parsed.preferredStage,
        preferredMode: parsed.preferredMode,
        preferredKeySignature: parsed.preferredKeySignature,
        preferredAccidentals: parsed.preferredAccidentals,
      };
    }
  } catch { /* ignore */ }
  return emptyProgress();
}

function saveProgress(p: DrillProgressStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Stage metadata
// ---------------------------------------------------------------------------

interface StageInfo {
  id: DrillStage;
  titleKey: string;
  descKey: string;
  color: string;
}

const STAGE_INFO: StageInfo[] = [
  { id: 'treble-c4',       titleKey: 'staffNotation.stageTrebleC4',       descKey: 'staffNotation.stageTrebleC4Desc',       color: '#7c3aed' },
  { id: 'treble-c5',       titleKey: 'staffNotation.stageTrebleC5',       descKey: 'staffNotation.stageTrebleC5Desc',       color: '#2563eb' },
  { id: 'treble-c4c5',     titleKey: 'staffNotation.stageTrebleC4C5',     descKey: 'staffNotation.stageTrebleC4C5Desc',     color: '#059669' },
  { id: 'bass-c2',         titleKey: 'staffNotation.stageBassC2',         descKey: 'staffNotation.stageBassC2Desc',         color: '#d97706' },
  { id: 'bass-c3',         titleKey: 'staffNotation.stageBassC3',         descKey: 'staffNotation.stageBassC3Desc',         color: '#dc2626' },
  { id: 'bass-c2c3',       titleKey: 'staffNotation.stageBassC2C3',       descKey: 'staffNotation.stageBassC2C3Desc',       color: '#0891b2' },
  { id: 'combined-grand',  titleKey: 'staffNotation.stageCombinedGrand',  descKey: 'staffNotation.stageCombinedGrandDesc',  color: '#6d28d9' },
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface AnswerButtonProps {
  label: string;
  state: 'idle' | 'correct' | 'wrong' | 'reveal';
  onClick: () => void;
  disabled: boolean;
}

function AnswerButton({ label, state, onClick, disabled }: AnswerButtonProps) {
  let bg = '#fff';
  let border = '#d9d9d9';
  let color = '#333';
  let icon = null;

  if (state === 'correct') { bg = '#d1fae5'; border = '#059669'; color = '#065f46'; icon = <CheckOutlined />; }
  else if (state === 'wrong')   { bg = '#fee2e2'; border = '#dc2626'; color = '#991b1b'; icon = <CloseOutlined />; }
  else if (state === 'reveal')  { bg = '#ddd6fe'; border = '#7c3aed'; color = '#4c1d95'; }

  return (
    <Button
      block
      size="large"
      disabled={disabled}
      onClick={onClick}
      icon={icon ?? undefined}
      style={{
        height: 52,
        fontWeight: 600,
        fontSize: 16,
        background: bg,
        borderColor: border,
        color,
        transition: 'all 0.2s',
      }}
    >
      {label}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Stage selector
// ---------------------------------------------------------------------------

interface StageSelectorProps {
  current: DrillStage;
  onSelect: (s: DrillStage) => void;
  noteProgress: Record<string, NoteProgress>;
}

function StageSelector({ current, onSelect, noteProgress }: StageSelectorProps) {
  const { t } = useTranslation();

  const options = STAGE_INFO.map((s) => {
    const pool = DRILL_STAGE_NOTES[s.id];
    const mastered = pool.filter((n) => noteProgress[n]?.mastered).length;
    return {
      value: s.id,
      label: `${t(s.titleKey)} — ${mastered}/${pool.length}`,
    };
  });

  return (
    <Select
      value={current}
      onChange={(v) => onSelect(v)}
      options={options}
      style={{ minWidth: 220 }}
      size="small"
    />
  );
}

// ---------------------------------------------------------------------------
// Progress board
// ---------------------------------------------------------------------------

interface ProgressBoardProps {
  pool: readonly string[];
  noteProgress: Record<string, NoteProgress>;
  currentNote: string | null;
}

function ProgressBoard({ pool, noteProgress, currentNote }: ProgressBoardProps) {
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(44px, 1fr))', gap: 6 }}>
        {pool.map((note) => {
          const p = noteProgress[note];
          const streak = p?.correctStreak ?? 0;
          const mastered = p?.mastered ?? false;
          const isCurrent = note === currentNote;

          return (
            <Tooltip
              key={note}
              title={`${note} — ${p ? `${p.totalCorrect}/${p.totalAttempts}` : '0/0'}`}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 8,
                  border: `2px solid ${isCurrent ? '#7c3aed' : mastered ? '#059669' : '#e0e0e0'}`,
                  background: mastered ? '#d1fae5' : isCurrent ? '#ede9fe' : '#f9f9f9',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 1,
                  transition: 'all 0.2s',
                  cursor: 'default',
                }}
              >
                <Text style={{ fontSize: 11, fontWeight: 600, color: mastered ? '#065f46' : '#555', lineHeight: 1 }}>
                  {note}
                </Text>
                <div style={{ display: 'flex', gap: 2 }}>
                  {Array.from({ length: MASTERY_STREAK }).map((_, i) => (
                    <div
                      key={i}
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: '50%',
                        background: mastered ? '#059669' : i < streak ? '#7c3aed' : '#ddd',
                      }}
                    />
                  ))}
                </div>
              </div>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function DrillSession() {
  const { t } = useTranslation();
  const screens = useBreakpoint();
  const { playNote } = useAudio();

  // Load persisted preferences
  const initialProgress = useMemo(() => loadProgress(), []);

  const [store, setStore] = useState<DrillProgressStore>(initialProgress);
  const [stage, setStage] = useState<DrillStage>(
    initialProgress.preferredStage ?? DRILL_STAGE_ORDER[0],
  );
  const [drillMode, setDrillMode] = useState<DrillMode>(
    initialProgress.preferredMode ?? 'note-name',
  );
  const [keySignature, setKeySignature] = useState<string>(
    initialProgress.preferredKeySignature ?? 'C',
  );
  const [selectedAccidentals, setSelectedAccidentals] = useState<AccidentalOption[]>(
    initialProgress.preferredAccidentals ?? ['natural'],
  );
  const [currentNote, setCurrentNote] = useState<string | null>(null);
  const [choices, setChoices] = useState<string[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [streak, setStreak] = useState(0);
  const [sessionCorrect, setSessionCorrect] = useState(0);
  const [sessionTotal, setSessionTotal] = useState(0);

  // Ref for auto-advance timeout
  const autoAdvanceRef = useRef<number | null>(null);

  const pool = useMemo(() => DRILL_STAGE_NOTES[stage], [stage]);
  const effectivePool = useMemo(
    () => applyKeyToPool(pool, keySignature),
    [pool, keySignature],
  );
  const clef = useMemo(
    () => (currentNote ? getClefForNote(currentNote, stage) : 'treble'),
    [currentNote, stage],
  );
  // Keyboard range for piano mode
  const keyboardRange = useMemo(
    () => getKeyboardRange(effectivePool),
    [effectivePool],
  );

  // Detect single-octave keyboard for fillWidth mode
  const isSingleOctave = useMemo(() => {
    const minMatch = /\d+$/.exec(keyboardRange.min);
    const maxMatch = /\d+$/.exec(keyboardRange.max);
    if (!minMatch || !maxMatch) return false;
    const minOct = parseInt(minMatch[0], 10);
    const maxOct = parseInt(maxMatch[0], 10);
    return maxOct - minOct <= 1;
  }, [keyboardRange]);

  // Answer highlights for piano mode keyboard
  const keyboardHighlights = useMemo<KeyHighlight[]>(() => {
    if (chosen === null) return [];
    if (chosen === currentNote) {
      return [{ note: chosen, state: 'correct' }];
    }
    const highlights: KeyHighlight[] = [
      { note: chosen, state: 'wrong' },
    ];
    if (currentNote) {
      highlights.push({ note: currentNote, state: 'reveal' });
    }
    return highlights;
  }, [chosen, currentNote]);

  /** Generate a question: pick base note, decide accidental, apply uniformly. */
  const generateQuestion = useCallback(
    (targetPool: string[], progress: Record<string, NoteProgress>, lastNote?: string) => {
      // Exclude notes where every selected accidental type would cause an
      // enharmonic simplification that collides with the note pool
      // (e.g. E♯→F, B♯→C, F♭→E, C♭→B).  When "不变音" (natural) is
      // selected, all notes pass the filter.
      const filteredPool = targetPool.filter((note) =>
        selectedAccidentals.some((accType) => isAccidentalApplicable(note, accType, targetPool)),
      );
      // Defensive fallback in case all notes are filtered out
      const pool = filteredPool.length > 0 ? filteredPool : targetPool;

      const baseNote = selectDrillNote(pool, progress, lastNote);
      const accidentalType = pickRandomAccidental(baseNote, selectedAccidentals, pool);

      let note: string;
      let distractorCandidates: string[];
      if (accidentalType) {
        note = applySpecificAccidental(baseNote, accidentalType, pool);
        distractorCandidates = getDrillDistractors(baseNote, pool)
          .map((d) => applySpecificAccidental(d, accidentalType, pool));
      } else {
        note = baseNote;
        distractorCandidates = getDrillDistractors(baseNote, pool);
      }

      const choices = [...new Set([note, ...distractorCandidates])];
      return { note, choices: shuffleArray(choices) };
    },
    [selectedAccidentals],
  );

  const replayCurrentNote = useCallback(() => {
    if (!currentNote) return;
    void playNote(currentNote, NOTE_PLAY_DURATION);
  }, [currentNote, playNote]);

  const playAnswerFeedback = useCallback(
    (answer: string, expected: string) => {
      void (async () => {
        if (answer === expected) {
          await playNote(expected, NOTE_PLAY_DURATION);
          return;
        }

        await playNote(answer, NOTE_PLAY_DURATION);
        await wait(ANSWER_FEEDBACK_DELAY_MS);
        await playNote(expected, NOTE_PLAY_DURATION);
      })();
    },
    [playNote],
  );

  // Persist store whenever it changes
  useEffect(() => { saveProgress(store); }, [store]);

  // Persist mode, stage, key signature & accidental preferences
  useEffect(() => {
    setStore((prev) => ({
      ...prev,
      preferredStage: stage,
      preferredMode: drillMode,
      preferredKeySignature: keySignature,
      preferredAccidentals: selectedAccidentals,
    }));
  }, [stage, drillMode, keySignature, selectedAccidentals]);

  // Clear auto-advance timeout on unmount
  useEffect(() => {
    return () => {
      if (autoAdvanceRef.current !== null) {
        window.clearTimeout(autoAdvanceRef.current);
      }
    };
  }, []);

  // Generate a new question
  const nextQuestion = useCallback(
    (lastNote?: string) => {
      // Clear any pending auto-advance
      if (autoAdvanceRef.current !== null) {
        window.clearTimeout(autoAdvanceRef.current);
        autoAdvanceRef.current = null;
      }

      const { note, choices } = generateQuestion(effectivePool, store.noteProgress, lastNote);
      setCurrentNote(note);
      setChoices(choices);
      setChosen(null);
      void playNote(note, NOTE_PLAY_DURATION);
    },
    [effectivePool, store.noteProgress, playNote, generateQuestion],
  );

  // Start or restart the stage
  const startStage = useCallback(
    (s: DrillStage) => {
      // Clear any pending auto-advance
      if (autoAdvanceRef.current !== null) {
        window.clearTimeout(autoAdvanceRef.current);
        autoAdvanceRef.current = null;
      }

      setStage(s);
      setChosen(null);
      setCurrentNote(null);
      // Slight delay so pool updates before generating question
      setTimeout(() => {
        const targetPool = applyKeyToPool(DRILL_STAGE_NOTES[s], keySignature);
        const { note, choices } = generateQuestion(targetPool, store.noteProgress);
        setCurrentNote(note);
        setChoices(choices);
        void playNote(note, NOTE_PLAY_DURATION);
      }, 0);
    },
    [store.noteProgress, playNote, keySignature, generateQuestion],
  );

  // Initialize first question on mount
  useEffect(() => {
    const initialPool = applyKeyToPool(pool, keySignature);
    const { note, choices } = generateQuestion(initialPool, store.noteProgress);
    setCurrentNote(note);
    setChoices(choices);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Regenerate question when key signature or accidental selection changes
  useEffect(() => {
    if (currentNote === null) {
      const newPool = applyKeyToPool(pool, keySignature);
      const { note, choices } = generateQuestion(newPool, store.noteProgress);
      setCurrentNote(note);
      setChoices(choices);
      void playNote(note, NOTE_PLAY_DURATION);
    }
    // Only react to keySignature / selectedAccidentals changes, not every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keySignature, selectedAccidentals]);

  const handleAnswer = useCallback(
    (answer: string) => {
      if (!currentNote || chosen !== null) return;

      // Clear any pending auto-advance
      if (autoAdvanceRef.current !== null) {
        window.clearTimeout(autoAdvanceRef.current);
        autoAdvanceRef.current = null;
      }

      setChosen(answer);
      setSessionTotal((n) => n + 1);

      const isCorrect = answer === currentNote;
      playAnswerFeedback(answer, currentNote);

      setStore((prev) => {
        const existing = prev.noteProgress[currentNote] ?? {
          correctStreak: 0, totalCorrect: 0, totalAttempts: 0, mastered: false,
        };
        const newStreak = isCorrect ? existing.correctStreak + 1 : 0;
        const mastered = newStreak >= MASTERY_STREAK;
        const updated: NoteProgress = {
          correctStreak: mastered ? MASTERY_STREAK : newStreak,
          totalCorrect: existing.totalCorrect + (isCorrect ? 1 : 0),
          totalAttempts: existing.totalAttempts + 1,
          mastered,
        };

        const newProgress = { ...prev.noteProgress, [currentNote]: updated };

        return {
          ...prev,
          noteProgress: newProgress,
        };
      });

      if (isCorrect) {
        setSessionCorrect((n) => n + 1);
        setStreak((n) => n + 1);
        // Show toast
        message.success(t('staffNotation.correct'));
        // Auto-advance after feedback plays
        autoAdvanceRef.current = window.setTimeout(() => {
          autoAdvanceRef.current = null;
          nextQuestion(currentNote ?? undefined);
        }, AUTO_ADVANCE_DELAY_MS);
      } else {
        setStreak(0);
        // Show toast with correct answer
        message.error(`${t('staffNotation.wrong')} ${currentNote}`);
        // Auto-advance after feedback plays (longer delay for wrong answer audio)
        autoAdvanceRef.current = window.setTimeout(() => {
          autoAdvanceRef.current = null;
          nextQuestion(currentNote ?? undefined);
        }, WRONG_ANSWER_AUTO_ADVANCE_DELAY_MS);
      }
    },
    [currentNote, chosen, playAnswerFeedback, t, nextQuestion],
  );

  const handleReset = useCallback(() => {
    // Clear any pending auto-advance
    if (autoAdvanceRef.current !== null) {
      window.clearTimeout(autoAdvanceRef.current);
      autoAdvanceRef.current = null;
    }

    const newStore: DrillProgressStore = {
      ...store,
      noteProgress: Object.fromEntries(
        Object.entries(store.noteProgress).filter(([k]) => !effectivePool.includes(k)),
      ),
    };
    setStore(newStore);
    setChosen(null);
    const { note, choices } = generateQuestion(effectivePool, newStore.noteProgress);
    setCurrentNote(note);
    setChoices(choices);
    setStreak(0);
  }, [store, effectivePool, generateQuestion]);

  // Determine answer button states
  const getButtonState = useCallback(
    (option: string): 'idle' | 'correct' | 'wrong' | 'reveal' => {
      if (chosen === null) return 'idle';
      if (option === currentNote) return chosen === currentNote ? 'correct' : 'reveal';
      if (option === chosen) return 'wrong';
      return 'idle';
    },
    [chosen, currentNote],
  );

  const masteredCount = effectivePool.filter((n) => store.noteProgress[n]?.mastered).length;
  const accuracy = sessionTotal > 0 ? Math.round((sessionCorrect / sessionTotal) * 100) : null;
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        overflow: 'hidden',
      }}
    >
      {/* Top area: Card takes remaining space, body scrolls internally */}
      <Card
        title={
          <Space>
            {screens.lg ? (
              <span style={{ fontSize: 18 }}>🎓</span>
            ) : (
              <Button
                type="text"
                icon={<MenuOutlined />}
                onClick={() => triggerOpenDrawer()}
                style={{ padding: 0 }}
              />
            )}
            <span style={{ fontWeight: 600 }}>{t('staffNotation.drillTitle')}</span>
          </Space>
        }
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          marginBottom: 0,
          minHeight: 0,
        }}
        styles={{ body: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' } }}
      >
        {/* Scrollable body content */}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {/* Collapsible progress section */}
          <Collapse
            ghost
            activeKey={store.progressPanelExpanded !== false ? ['progress'] : []}
            onChange={(keys) => {
              setStore((prev) => ({
                ...prev,
                progressPanelExpanded: Array.isArray(keys) && keys.includes('progress'),
              }));
            }}
            style={{ marginBottom: 16 }}
            items={[
              {
                key: 'progress',
                label: (
                  <Space size={8} wrap>
                    <Text style={{ fontSize: 13 }}>
                      {t('staffNotation.stageProgress', { done: masteredCount, total: effectivePool.length })}
                    </Text>
                    <Progress
                      percent={Math.round((masteredCount / effectivePool.length) * 100)}
                      size="small"
                      style={{ width: 120 }}
                      strokeColor={masteredCount === effectivePool.length ? '#059669' : '#7c3aed'}
                    />
                    {accuracy !== null && (
                      <Tag icon={<TrophyOutlined />} color="gold">
                        {t('staffNotation.accuracy')} {accuracy}%
                      </Tag>
                    )}
                  </Space>
                ),
                children: (
                  <div>
                    {/* Training mode & stage selector */}
                    <Space style={{ marginBottom: 12 }} wrap size={12}>
                      <Space size={4}>
                        <Text style={{ fontSize: 13 }}>{t('staffNotation.trainingMode')}:</Text>
                        <Select
                          value={drillMode}
                          onChange={(v) => setDrillMode(v)}
                          options={[
                            { value: 'note-name', label: t('staffNotation.trainingModeNoteName') },
                            { value: 'piano', label: t('staffNotation.trainingModePiano') },
                            { value: 'piano-no-labels', label: t('staffNotation.trainingModePianoNoLabels') },
                          ]}
                          style={{ minWidth: 180 }}
                          size="small"
                        />
                      </Space>
                      <Space size={4}>
                        <Text style={{ fontSize: 13 }}>{t('staffNotation.trainingStage')}:</Text>
                        <StageSelector
                          current={stage}
                          onSelect={startStage}
                          noteProgress={store.noteProgress}
                        />
                      </Space>
                      <Space size={4}>
                        <Text style={{ fontSize: 13 }}>{t('staffNotation.keySignatureLabel')}:</Text>
                        <Select
                          value={keySignature}
                          onChange={(v) => {
                            setKeySignature(v);
                            // Clear current question so nextQuestion generates with new pool
                            setCurrentNote(null);
                            setChosen(null);
                            if (autoAdvanceRef.current !== null) {
                              window.clearTimeout(autoAdvanceRef.current);
                              autoAdvanceRef.current = null;
                            }
                          }}
                          options={[...COMMON_MAJOR_KEYS].map((k) => ({
                            value: k,
                            label: k,
                          }))}
                          style={{ minWidth: 100 }}
                          size="small"
                        />
                      </Space>
                      <Space size={4}>
                        <Text style={{ fontSize: 13 }}>{t('staffNotation.accidentalLabel')}:</Text>
                        <Select
                          mode="multiple"
                          value={selectedAccidentals}
                          onChange={(v) => {
                            setSelectedAccidentals(v);
                            // Clear current question so the effect regenerates with new settings
                            setCurrentNote(null);
                            setChosen(null);
                            if (autoAdvanceRef.current !== null) {
                              window.clearTimeout(autoAdvanceRef.current);
                              autoAdvanceRef.current = null;
                            }
                          }}
                          options={ACCIDENTAL_OPTIONS.map((opt) => ({
                            value: opt.value,
                            label: t(opt.labelKey),
                          }))}
                          style={{ minWidth: 200 }}
                          size="small"
                          maxTagCount={2}
                        />
                      </Space>
                    </Space>
                    <Space style={{ marginBottom: 12 }} wrap>
                      {streak >= 3 && (
                        <Tag icon={<FireOutlined />} color="red">
                          {t('staffNotation.streak', { n: streak })}
                        </Tag>
                      )}
                    </Space>
                    <div style={{ marginBottom: 12 }}>
                      <Popconfirm
                        title={t('staffNotation.resetProgress')}
                        onConfirm={handleReset}
                        okText="OK"
                        cancelText={t('nav.close')}
                      >
                        <Button size="small" icon={<ReloadOutlined />} danger>
                          {t('staffNotation.resetProgress')}
                        </Button>
                      </Popconfirm>
                    </div>
                    <ProgressBoard
                      pool={effectivePool}
                      noteProgress={store.noteProgress}
                      currentNote={chosen !== null ? currentNote : null}
                    />
                  </div>
                ),
              },
            ]}
          />

          {/* Staff display */}
          <div
            role="button"
            tabIndex={currentNote ? 0 : -1}
            onClick={replayCurrentNote}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                replayCurrentNote();
              }
            }}
            style={{
              background: '#fafafa',
              border: '1px solid #f0f0f0',
              borderRadius: 12,
              padding: '16px 12px',
              textAlign: 'center',
              minHeight: 220,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: currentNote ? 'pointer' : 'default',
            }}
          >
            <Text type="secondary" style={{ fontSize: 13, marginBottom: 8 }}>
              {t('staffNotation.whatNote')}
            </Text>
            {currentNote && (
              <StaffDisplay
                notes={currentNote}
                clef={clef}
                highlightNote={chosen !== null ? currentNote : undefined}
                keySignature={keySignature !== 'C' ? keySignature : undefined}
                width={screens.xl ? 520 : screens.lg ? 440 : screens.md ? 360 : 280}
                height={190}
              />
            )}
          </div>
        </div>
      </Card>

      {/* Fixed bottom answer area */}
      <div
        style={{
          flexShrink: 0,
          background: '#fff',
          borderTop: '1px solid #f0f0f0',
          padding: '12px 16px 16px',
        }}
      >
        {/* Answer buttons (note-name mode only) */}
        {drillMode === 'note-name' && (
          <div style={{ display: 'flex', gap: 8 }}>
            {choices.map((option) => (
              <div key={option} style={{ flex: 1 }}>
                <AnswerButton
                  label={option}
                  state={getButtonState(option)}
                  onClick={() => handleAnswer(option)}
                  disabled={chosen !== null}
                />
              </div>
            ))}
          </div>
        )}

        {/* Piano keyboard (piano modes) */}
        {drillMode !== 'note-name' && (
          <PianoKeyboard
            onKeyPress={(_pc, note) => handleAnswer(note)}
            noteRange={keyboardRange}
            highlightKeys={keyboardHighlights}
            disabled={chosen !== null}
            showNoteLabels={drillMode === 'piano'}
            fillWidth={isSingleOctave}
            maxHeight={200}
          />
        )}

      </div>
    </div>
  );
}
