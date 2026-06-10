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
  message, Slider,
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
  expandPoolWithAccidentals,
} from '@ezmusic/shared';
import StaffDisplay from './StaffDisplay';
import { PianoKeyboard, GuitarFretboard, type KeyHighlight } from '@ezmusic/shared';

const { Text } = Typography;
const { useBreakpoint } = Grid;

const STORAGE_KEY = 'ezmusic-staff-drill-progress';
const MASTERY_STREAK = 3;

// ---------------------------------------------------------------------------
// Piano keyboard range slider helpers
// ---------------------------------------------------------------------------

const CHROMATIC_PC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Generate all chromatic note names between two notes (inclusive). */
function generateNoteNames(fromNote: string, toNote: string): string[] {
  const flatToSharp: Record<string, string> = { Bb: 'A#', Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#' };
  const parseNoteName = (note: string) => {
    const match = /^([A-G][#b]?)(\d+)$/.exec(note);
    if (!match) throw new Error(`Invalid note: ${note}`);
    return { pc: flatToSharp[match[1]] ?? match[1], octave: parseInt(match[2], 10) };
  };
  const from = parseNoteName(fromNote);
  const to = parseNoteName(toNote);
  const fromIdx = from.octave * 12 + CHROMATIC_PC.indexOf(from.pc);
  const toIdx = to.octave * 12 + CHROMATIC_PC.indexOf(to.pc);
  const notes: string[] = [];
  for (let i = fromIdx; i <= toIdx; i++) {
    notes.push(`${CHROMATIC_PC[i % 12]}${Math.floor(i / 12)}`);
  }
  return notes;
}

/** Complete chromatic note list from C2 to C6 (the full available piano range). */
const ALL_PIANO_NOTES = generateNoteNames('C2', 'C6');

/** Guitar string tuning (low to high, standard tuning). */
const GUITAR_STRINGS = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'];

/** Chromatic pitch classes (sharp form) for note computation. */
const GUITAR_CHROMATIC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const GUITAR_FLAT_TO_SHARP: Record<string, string> = { Bb: 'A#', Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#' };

/** Compute the note name at a given string index (0=low E2) and fret number. */
function getGuitarFretNote(stringIdx: number, fret: number): string {
  const baseNote = GUITAR_STRINGS[stringIdx];
  const match = /^([A-G][#b]?)(\d+)$/.exec(baseNote);
  if (!match) return baseNote;
  const pc = GUITAR_FLAT_TO_SHARP[match[1]] ?? match[1];
  const octave = parseInt(match[2], 10);
  const baseIdx = GUITAR_CHROMATIC.indexOf(pc);
  if (baseIdx === -1) return baseNote;
  const totalIdx = baseIdx + fret;
  const newOctave = octave + Math.floor(totalIdx / 12);
  const newPC = GUITAR_CHROMATIC[totalIdx % 12];
  return `${newPC}${newOctave}`;
}

/** Get all unique notes playable on the guitar within the given fret range. */
function getGuitarRangeNotes(fretStart: number, fretEnd: number): string[] {
  const notes = new Set<string>();
  for (let s = 0; s < GUITAR_STRINGS.length; s++) {
    for (let f = fretStart; f <= fretEnd; f++) {
      notes.add(getGuitarFretNote(s, f));
    }
  }
  return [...notes];
}

/** Minimum number of chromatic notes visible on the keyboard. */
const MIN_PIANO_RANGE = 12;
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
type DrillMode = 'note-name' | 'piano' | 'piano-no-labels' | 'guitar' | 'guitar-no-labels';

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
  /** Persisted guitar fretboard range */
  preferredFretStart?: number;
  preferredFretEnd?: number;
  /** Persisted piano keyboard range (indices into ALL_PIANO_NOTES) */
  preferredPianoRangeStart?: number;
  preferredPianoRangeEnd?: number;
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
        progressPanelExpanded: parsed.progressPanelExpanded,
        preferredFretStart: parsed.preferredFretStart,
        preferredFretEnd: parsed.preferredFretEnd,
        preferredPianoRangeStart: parsed.preferredPianoRangeStart,
        preferredPianoRangeEnd: parsed.preferredPianoRangeEnd,
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
  showInstrumentRange?: boolean;
}

function StageSelector({ current, onSelect, noteProgress, showInstrumentRange }: StageSelectorProps) {
  const { t } = useTranslation();

  const options = STAGE_INFO.map((s) => {
    const pool = DRILL_STAGE_NOTES[s.id];
    const mastered = pool.filter((n) => noteProgress[n]?.mastered).length;
    return {
      value: s.id,
      label: `${t(s.titleKey)} — ${mastered}/${pool.length}`,
    };
  });

  if (showInstrumentRange) {
    options.push({
      value: 'instrument-range' as DrillStage,
      label: t('staffNotation.stageInstrumentRange'),
    });
  }

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
      <div style={{ display: 'grid', gridAutoFlow: 'column', gridAutoColumns: '44px', gap: 6, overflowX: 'auto' }}>
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
                <div style={{ display: 'flex', gap: 2, flexWrap: 'nowrap', overflowX: 'auto' }}>
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
  const [fretStart, setFretStart] = useState<number>(
    initialProgress.preferredFretStart ?? 0,
  );
  const [fretEnd, setFretEnd] = useState<number>(
    initialProgress.preferredFretEnd ?? 12,
  );

  const handleFretRangeChange = useCallback((start: number, end: number) => {
    setFretStart(start);
    setFretEnd(end);
  }, []);

  // Piano keyboard range (indices into ALL_PIANO_NOTES)
  const [pianoRangeStart, setPianoRangeStart] = useState<number>(
    initialProgress.preferredPianoRangeStart ?? 0,
  );
  const [pianoRangeEnd, setPianoRangeEnd] = useState<number>(
    initialProgress.preferredPianoRangeEnd ?? ALL_PIANO_NOTES.length - 1,
  );

  // Middle drag-handle state & ref for piano range slider
  const pianoSliderWrapRef = useRef<HTMLDivElement>(null);
  const [pianoDraggingRange, setPianoDraggingRange] = useState(false);
  const pianoDragStateRef = useRef({ startX: 0, origStart: 0, origEnd: 0 });

  // Clamp piano range to ensure minimum visible range
  const clampedPianoStart = Math.max(0, Math.min(pianoRangeStart, ALL_PIANO_NOTES.length - 1 - MIN_PIANO_RANGE));
  const clampedPianoEnd = Math.max(
    clampedPianoStart + MIN_PIANO_RANGE,
    Math.min(pianoRangeEnd, ALL_PIANO_NOTES.length - 1),
  );

  const handlePianoRangeChange = useCallback((val: number[]) => {
    setPianoRangeStart(val[0]);
    setPianoRangeEnd(val[1]);
  }, []);

  // ---- Piano middle range-drag handlers ----
  const pianoMaxSlider = ALL_PIANO_NOTES.length - 1;

  const handlePianoRangeDragStart = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      pianoDragStateRef.current = { startX: clientX, origStart: clampedPianoStart, origEnd: clampedPianoEnd };
      setPianoDraggingRange(true);
    },
    [clampedPianoStart, clampedPianoEnd],
  );

  useEffect(() => {
    if (!pianoDraggingRange) return;

    const handleMove = (e: MouseEvent | TouchEvent) => {
      if ('touches' in e) e.preventDefault();
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const wrap = pianoSliderWrapRef.current;
      if (!wrap) return;

      const rail = wrap.querySelector('.ant-slider-rail') as HTMLElement;
      if (!rail) return;

      const railRect = rail.getBoundingClientRect();
      const totalPxDelta = clientX - pianoDragStateRef.current.startX;
      const valueDelta = Math.round((totalPxDelta / railRect.width) * pianoMaxSlider);

      const rangeLen = pianoDragStateRef.current.origEnd - pianoDragStateRef.current.origStart;
      let newStart = pianoDragStateRef.current.origStart + valueDelta;
      let newEnd = newStart + rangeLen;

      if (newStart < 0) { newStart = 0; newEnd = rangeLen; }
      if (newEnd > pianoMaxSlider) { newEnd = pianoMaxSlider; newStart = pianoMaxSlider - rangeLen; }

      setPianoRangeStart(newStart);
      setPianoRangeEnd(newEnd);
    };

    const handleEnd = () => setPianoDraggingRange(false);

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleEnd);
    document.addEventListener('touchmove', handleMove, { passive: false });
    document.addEventListener('touchend', handleEnd);

    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleEnd);
      document.removeEventListener('touchmove', handleMove);
      document.removeEventListener('touchend', handleEnd);
    };
  }, [pianoDraggingRange, pianoMaxSlider, clampedPianoStart, clampedPianoEnd, setPianoRangeStart, setPianoRangeEnd]);

  // Piano middle-handle position percentages
  const pianoRangeMidPercent = ((clampedPianoStart + clampedPianoEnd) / 2 / pianoMaxSlider) * 100;
  const pianoRangeWidthPercent = ((clampedPianoEnd - clampedPianoStart) / pianoMaxSlider) * 100;

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
  // When stage is 'instrument-range', the note pool comes from the instrument's visible range
  const questionPool = useMemo(() => {
    if (stage !== 'instrument-range') return effectivePool;
    let rangeNotes: string[];
    if (drillMode === 'piano' || drillMode === 'piano-no-labels') {
      rangeNotes = ALL_PIANO_NOTES.slice(clampedPianoStart, clampedPianoEnd + 1);
    } else {
      rangeNotes = getGuitarRangeNotes(fretStart, fretEnd);
    }
    // Keep only natural notes — accidentals are controlled by selectedAccidentals
    rangeNotes = rangeNotes.filter((n) => {
      const pc = n.replace(/\d+$/, '');
      return !pc.includes('#') && !pc.includes('b');
    });
    return applyKeyToPool(rangeNotes, keySignature);
  }, [stage, effectivePool, drillMode, keySignature, clampedPianoStart, clampedPianoEnd, fretStart, fretEnd]);

  /** Pool expanded with all possible accidental variants for progress display */
  const displayPool = useMemo(
    () => expandPoolWithAccidentals(questionPool, selectedAccidentals),
    [questionPool, selectedAccidentals],
  );

  const clef = useMemo(
    () => (currentNote ? getClefForNote(currentNote, stage) : 'treble'),
    [currentNote, stage],
  );
  // Keyboard range for piano mode (user-controlled via slider)
  const keyboardRange = useMemo(
    () => ({
      min: ALL_PIANO_NOTES[clampedPianoStart] ?? effectivePool[0],
      max: ALL_PIANO_NOTES[clampedPianoEnd] ?? effectivePool[effectivePool.length - 1],
    }),
    [clampedPianoStart, clampedPianoEnd, effectivePool],
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
      // (e.g. E♯→F, B♯→C, F♭→E, C♭→B).  When "自然音" (natural) is
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
      preferredFretStart: fretStart,
      preferredFretEnd: fretEnd,
      preferredPianoRangeStart: pianoRangeStart,
      preferredPianoRangeEnd: pianoRangeEnd,
    }));
  }, [stage, drillMode, keySignature, selectedAccidentals, fretStart, fretEnd, pianoRangeStart, pianoRangeEnd]);

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

      const { note, choices } = generateQuestion(questionPool, store.noteProgress, lastNote);
      setCurrentNote(note);
      setChoices(choices);
      setChosen(null);
      void playNote(note, NOTE_PLAY_DURATION);
    },
    [questionPool, store.noteProgress, playNote, generateQuestion],
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
        let targetPool: string[];
        if (s === 'instrument-range') {
          let rangeNotes: string[];
          if (drillMode === 'piano' || drillMode === 'piano-no-labels') {
            rangeNotes = ALL_PIANO_NOTES.slice(clampedPianoStart, clampedPianoEnd + 1);
          } else {
            rangeNotes = getGuitarRangeNotes(fretStart, fretEnd);
          }
          rangeNotes = rangeNotes.filter((n) => {
            const pc = n.replace(/\d+$/, '');
            return !pc.includes('#') && !pc.includes('b');
          });
          targetPool = applyKeyToPool(rangeNotes, keySignature);
        } else {
          targetPool = applyKeyToPool(DRILL_STAGE_NOTES[s], keySignature);
        }
        const { note, choices } = generateQuestion(targetPool, store.noteProgress);
        setCurrentNote(note);
        setChoices(choices);
        void playNote(note, NOTE_PLAY_DURATION);
      }, 0);
    },
    [store.noteProgress, playNote, keySignature, generateQuestion, drillMode, clampedPianoStart, clampedPianoEnd, fretStart, fretEnd],
  );

  // Initialize first question on mount
  useEffect(() => {
    let initialPool: string[];
    if (stage === 'instrument-range') {
      let rangeNotes: string[];
      if (drillMode === 'piano' || drillMode === 'piano-no-labels') {
        rangeNotes = ALL_PIANO_NOTES.slice(clampedPianoStart, clampedPianoEnd + 1);
      } else {
        rangeNotes = getGuitarRangeNotes(fretStart, fretEnd);
      }
      rangeNotes = rangeNotes.filter((n) => {
        const pc = n.replace(/\d+$/, '');
        return !pc.includes('#') && !pc.includes('b');
      });
      initialPool = applyKeyToPool(rangeNotes, keySignature);
    } else {
      initialPool = applyKeyToPool(pool, keySignature);
    }
    const { note, choices } = generateQuestion(initialPool, store.noteProgress);
    setCurrentNote(note);
    setChoices(choices);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Regenerate question when key signature or accidental selection changes
  useEffect(() => {
    if (currentNote === null) {
      let newPool: string[];
      if (stage === 'instrument-range') {
        let rangeNotes: string[];
        if (drillMode === 'piano' || drillMode === 'piano-no-labels') {
          rangeNotes = ALL_PIANO_NOTES.slice(clampedPianoStart, clampedPianoEnd + 1);
        } else {
          rangeNotes = getGuitarRangeNotes(fretStart, fretEnd);
        }
        rangeNotes = rangeNotes.filter((n) => {
          const pc = n.replace(/\d+$/, '');
          return !pc.includes('#') && !pc.includes('b');
        });
        newPool = applyKeyToPool(rangeNotes, keySignature);
      } else {
        newPool = applyKeyToPool(pool, keySignature);
      }
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
        Object.entries(store.noteProgress).filter(([k]) => !displayPool.includes(k)),
      ),
    };
    setStore(newStore);
    setChosen(null);
    const { note, choices } = generateQuestion(questionPool, newStore.noteProgress);
    setCurrentNote(note);
    setChoices(choices);
    setStreak(0);
  }, [store, questionPool, generateQuestion]);

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

  const masteredCount = displayPool.filter((n) => store.noteProgress[n]?.mastered).length;
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
                      {t('staffNotation.stageProgress', { done: masteredCount, total: displayPool.length })}
                    </Text>
                    <Progress
                      percent={Math.round((masteredCount / displayPool.length) * 100)}
                      size="small"
                      style={{ width: 120 }}
                      strokeColor={masteredCount === displayPool.length ? '#059669' : '#7c3aed'}
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
                            { value: 'guitar', label: t('staffNotation.trainingModeGuitar') },
                            { value: 'guitar-no-labels', label: t('staffNotation.trainingModeGuitarNoLabels') },
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
                          showInstrumentRange={drillMode !== 'note-name'}
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
                      pool={displayPool}
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
        {(drillMode === 'piano' || drillMode === 'piano-no-labels') && (
          <>
            {/* Range slider — controls the visible note range on the keyboard */}
            <div ref={pianoSliderWrapRef} style={{ position: 'relative' }}>
              <div style={{ padding: '0 40px 8px' }}>
                <Slider
                  range
                  min={0}
                  max={pianoMaxSlider}
                  value={[clampedPianoStart, clampedPianoEnd]}
                  onChange={handlePianoRangeChange}
                  tooltip={{
                    formatter: (v) => ALL_PIANO_NOTES[v ?? 0] ?? '',
                  }}
                  style={{ margin: 0 }}
                />
              </div>

              {/* Overlay that matches the Slider's area */}
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 40,
                  right: 40,
                  bottom: 8,
                  pointerEvents: 'none',
                }}
              >
                {/* Draggable range-grip */}
                <div
                  onMouseDown={handlePianoRangeDragStart}
                  onTouchStart={handlePianoRangeDragStart}
                  style={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    left: `${pianoRangeMidPercent}%`,
                    width: `${pianoRangeWidthPercent}%`,
                    transform: 'translateX(-50%)',
                    cursor: 'grab',
                    pointerEvents: 'auto',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  title="拖动整体移动范围"
                >
                  <div
                    style={{
                      width: 28,
                      height: 18,
                      borderRadius: 9,
                      background: pianoDraggingRange ? '#1677ff' : '#d9d9d9',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 2,
                      transition: 'background 0.15s',
                      boxShadow: pianoDraggingRange
                        ? '0 2px 6px rgba(22,119,255,0.35)'
                        : '0 1px 3px rgba(0,0,0,0.12)',
                    }}
                  >
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        style={{
                          width: 3,
                          height: 3,
                          borderRadius: '50%',
                          background: '#fff',
                          display: 'block',
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <PianoKeyboard
              onKeyPress={(_pc, note) => handleAnswer(note)}
              noteRange={keyboardRange}
              highlightKeys={keyboardHighlights}
              disabled={chosen !== null}
              showNoteLabels={drillMode === 'piano'}
              fillWidth={isSingleOctave}
              maxHeight={200}
              showRuler={false}
            />
          </>
        )}

        {/* Guitar fretboard (guitar modes) */}
        {(drillMode === 'guitar' || drillMode === 'guitar-no-labels') && (
          <GuitarFretboard
            onKeyPress={(_pc, note) => handleAnswer(note)}
            highlightKeys={keyboardHighlights}
            disabled={chosen !== null}
            showNoteLabels={drillMode === 'guitar'}
            fretStart={fretStart}
            fretEnd={fretEnd}
            onFretRangeChange={handleFretRangeChange}
          />
        )}

      </div>
    </div>
  );
}
