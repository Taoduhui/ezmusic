/**
 * FretboardMemorization2 — multi-note staff → fretboard position drill.
 *
 * A measure containing multiple consecutive notes of varying durations is
 * displayed on a treble-clef staff. The user identifies the fretboard position
 * of the current note (highlighted in blue) by tapping the matching position
 * on the guitar fretboard below.
 *
 * - Correct: note turns green, the matched fretboard position highlights green,
 *            advances to the next note in the measure.
 * - Wrong:   note turns red, the tapped position shows red and correct positions
 *            show purple, stays on the current note, and plays the tonic-walk
 *            so the user can hear the pitch.
 * - When all notes in the measure have been answered correctly, a new measure
 *   is generated.
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  Button, Typography, Drawer, Select, Space, Grid, message, Card, Switch,
} from 'antd';
import {
  SettingOutlined, SoundOutlined, MenuOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  GuitarFretboard,
  useAudio,
  triggerOpenDrawer,
  SOLFEGE_SYLLABLES,
  playTonicWalk,
  buildTonicWalkSequence,
} from '@ezmusic/shared';
import { useSRDrill } from '@ezmusic/spaced-repetition';
import { StaffDisplay } from '@ezmusic/chapter-staff-notation';
import type { KeyHighlight } from '@ezmusic/shared';

const { Text } = Typography;
const { useBreakpoint } = Grid;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Chromatic pitch classes (sharp form). */
const CHROMATIC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Natural pitch classes. */
const NATURAL_PC = new Set(['C', 'D', 'E', 'F', 'G', 'A', 'B']);

/** Flat → sharp mapping. */
const FLAT_TO_SHARP: Record<string, string> = {
  Bb: 'A#', Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#',
};

/** Standard guitar tuning from low (string 6) to high (string 1). */
const GUITAR_TUNING = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'];

const MAX_FRET = 24;
const DEFAULT_FRET_START = 0;
const DEFAULT_FRET_END = 5;

const STORAGE_KEY = 'ezmusic-fretboard-memo2-settings';

const NOTE_PLAY_DURATION = 0.8;
const WALK_NOTE_DURATION = 0.4;
const WALK_GAP_MS = 75;

/** Available note durations and their beat values (4/4 time). */
const DURATION_OPTIONS: { vf: string; beats: number }[] = [
  { vf: 'q', beats: 1 },   // quarter note
  { vf: 'h', beats: 2 },   // half note
  { vf: 'w', beats: 4 },   // whole note
  { vf: '8', beats: 0.5 }, // eighth note
  { vf: 'q.', beats: 1.5 },// dotted quarter
  { vf: 'h.', beats: 3 },  // dotted half
];

const BEATS_PER_MEASURE = 4;

/** Hint mode for the fretboard labels. */
type HintMode = 'none' | 'noteName' | 'solfege';

const HINT_MODE_OPTIONS: { value: HintMode; label: string }[] = [
  { value: 'none', label: '无' },
  { value: 'noteName', label: '音名' },
  { value: 'solfege', label: '唱名' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse scientific note name into pitch-class and octave. */
function parseNote(note: string): { pc: string; octave: number } {
  const match = /^([A-G][#b]?)(\d+)$/.exec(note);
  if (!match) throw new Error(`Invalid note: ${note}`);
  const rawPc = match[1];
  const pc = FLAT_TO_SHARP[rawPc] ?? rawPc;
  return { pc, octave: parseInt(match[2], 10) };
}

/** Get the scientific note name at a given string index (0 = low E) and fret. */
function getFretNote(stringIdx: number, fret: number): string {
  const baseNote = GUITAR_TUNING[stringIdx];
  const { pc, octave } = parseNote(baseNote);
  const baseIdx = CHROMATIC.indexOf(pc);
  if (baseIdx === -1) return baseNote;

  const totalIdx = baseIdx + fret;
  const newOctave = octave + Math.floor(totalIdx / 12);
  const newPC = CHROMATIC[totalIdx % 12];
  return `${newPC}${newOctave}`;
}

/** Generate all unique *natural* notes found on the fretboard within [fretStart, fretEnd]. */
function generateFretboardNotes(fretStart: number, fretEnd: number): string[] {
  const seen = new Set<string>();
  const notes: string[] = [];
  for (let si = 0; si < GUITAR_TUNING.length; si++) {
    for (let f = fretStart; f <= fretEnd; f++) {
      const note = getFretNote(si, f);
      const { pc } = parseNote(note);
      if (NATURAL_PC.has(pc) && !seen.has(note)) {
        seen.add(note);
        notes.push(note);
      }
    }
  }
  return notes;
}

/** Map a note name to its solfège syllable (fixed-Do). */
function noteToSolfegeLabel(note: string): string {
  const { pc } = parseNote(note);
  const naturalPc = pc[0];
  const idx = ['C', 'D', 'E', 'F', 'G', 'A', 'B'].indexOf(naturalPc);
  if (idx === -1) return note;
  const base = SOLFEGE_SYLLABLES[idx];
  const accidental = pc.slice(1);
  if (accidental) {
    const symbol =
      accidental === '#' ? '♯' : accidental === 'b' ? '♭' : accidental;
    return `${base}${symbol}`;
  }
  return base;
}

/** Shift a scientific note name by a number of octaves (e.g. C4 → C5 with delta=1). */
function shiftOctave(note: string, delta: number): string {
  const match = /^([A-G][#b]?)(\d+)$/.exec(note);
  if (!match) return note;
  return `${match[1]}${parseInt(match[2], 10) + delta}`;
}

/** Build fret options for the dropdown: 0品 … 24品. */
function buildFretOptions(): { value: number; label: string }[] {
  const options: { value: number; label: string }[] = [];
  for (let i = 0; i <= MAX_FRET; i++) {
    options.push({
      value: i,
      label: i === 0 ? '空弦' : `${i} 品`,
    });
  }
  return options;
}

const FRET_OPTIONS = buildFretOptions();

/** Generate a random measure: an array of notes with durations summing to ~4 beats. */
function generateMeasure(notePool: string[], excludeNote?: string): Array<{ note: string; duration: string }> {
  const available = excludeNote && notePool.length > 1
    ? notePool.filter((n) => n !== excludeNote)
    : notePool;

  const result: Array<{ note: string; duration: string }> = [];
  let remaining = BEATS_PER_MEASURE;

  while (remaining > 0) {
    const fitting = DURATION_OPTIONS.filter((d) => d.beats <= remaining);
    const chosen = fitting[Math.floor(Math.random() * fitting.length)];

    const note = available[Math.floor(Math.random() * available.length)];

    result.push({ note, duration: chosen.vf });
    remaining -= chosen.beats;

    if (result.length > 16) break;
  }

  // Ensure at least 6 notes for a meaningful multi-note exercise.
  while (result.length < 6) {
    let maxIdx = 0;
    let maxBeats = 0;
    for (let i = 0; i < result.length; i++) {
      const dur = DURATION_OPTIONS.find((d) => d.vf === result[i].duration);
      const beats = dur ? dur.beats : 0;
      if (beats > maxBeats) {
        maxBeats = beats;
        maxIdx = i;
      }
    }

    if (maxBeats <= 0.5) break;

    const numEighths = Math.round(maxBeats / 0.5);
    const eighthNotes: Array<{ note: string; duration: string }> = [];
    for (let i = 0; i < numEighths; i++) {
      const note = available[Math.floor(Math.random() * available.length)];
      eighthNotes.push({ note, duration: '8' });
    }
    result.splice(maxIdx, 1, ...eighthNotes);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

interface FretboardMemo2Settings {
  fretStart: number;
  fretEnd: number;
  hintMode: HintMode;
  playSound: boolean;
}

function loadSettings(): FretboardMemo2Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<FretboardMemo2Settings>;
      return {
        fretStart: parsed.fretStart ?? DEFAULT_FRET_START,
        fretEnd: parsed.fretEnd ?? DEFAULT_FRET_END,
        hintMode: parsed.hintMode ?? 'noteName',
        playSound: parsed.playSound ?? true,
      };
    }
  } catch { /* ignore corrupt data */ }
  return {
    fretStart: DEFAULT_FRET_START,
    fretEnd: DEFAULT_FRET_END,
    hintMode: 'noteName',
    playSound: true,
  };
}

function saveSettings(settings: FretboardMemo2Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch { /* ignore quota errors */ }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function FretboardMemorization2() {
  const { t } = useTranslation();
  const screens = useBreakpoint();
  const isDesktop = !!screens.lg;
  const { playNote } = useAudio();

  // ---- Spaced repetition ----
  const sr = useSRDrill({ storageKey: 'ezmusic-fretboard-memo2-sr' });

  // ---- Settings state ----
  const [settingsOpen, setSettingsOpen] = useState(false);
  const persisted = useMemo(() => loadSettings(), []);
  const [fretStart, setFretStart] = useState(persisted.fretStart);
  const [fretEnd, setFretEnd] = useState(persisted.fretEnd);
  const [hintMode, setHintMode] = useState<HintMode>(persisted.hintMode);
  const [playSound, setPlaySound] = useState(persisted.playSound);

  // ---- Question state ----
  /** The current measure — array of {note, duration} */
  const [measureNotes, setMeasureNotes] = useState<Array<{ note: string; duration: string }>>([]);
  /** Index of the note the user is currently answering within the measure. */
  const [currentNoteIndex, setCurrentNoteIndex] = useState(0);
  /**
   * Per-note answer state:
   * - 'pending': not yet answered
   * - 'active':  currently being answered (blue)
   * - 'correct': answered correctly (green)
   * - 'wrong':   answered incorrectly (red) — transient, reverts to 'active'
   */
  const [noteStates, setNoteStates] = useState<Array<'pending' | 'active' | 'correct' | 'wrong'>>([]);
  /** The note the user tapped on the fretboard (null until they tap). */
  const [tappedNote, setTappedNote] = useState<string | null>(null);
  /** Session stats. */
  const [streak, setStreak] = useState(0);
  const [sessionCorrect, setSessionCorrect] = useState(0);
  const [sessionTotal, setSessionTotal] = useState(0);

  // Auto-advance / re-enable timeout ref
  const timeoutRef = useRef<number | null>(null);

  // ---- Derived ----
  const notePool = useMemo(
    () => generateFretboardNotes(fretStart, fretEnd),
    [fretStart, fretEnd],
  );

  // Ensure SR cards exist for all notes in the pool
  useEffect(() => {
    sr.ensureCards(notePool);
  }, [notePool, sr.ensureCards]);

  /** Generate a new measure and reset per-measure state. */
  const nextMeasure = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    if (notePool.length === 0) return;

    const measure = generateMeasure(notePool);
    const states: Array<'pending' | 'active' | 'correct' | 'wrong'> =
      measure.map((_, i) => (i === 0 ? 'active' : 'pending'));

    setMeasureNotes(measure);
    setCurrentNoteIndex(0);
    setNoteStates(states);
    setTappedNote(null);

    // Play the first note's sound
    if (playSound) {
      void playNote(measure[0].note, NOTE_PLAY_DURATION);
    }
  }, [notePool, playNote, playSound]);

  /** Advance to the next note within the current measure, or generate a new measure. */
  const advanceToNextNote = useCallback(
    (measure: Array<{ note: string; duration: string }>, currentIdx: number) => {
      const nextIdx = currentIdx + 1;

      if (nextIdx >= measure.length) {
        // All notes in this measure completed — load next measure
        nextMeasure();
      } else {
        // Move to next note in the current measure
        setCurrentNoteIndex(nextIdx);
        setNoteStates((prev) => {
          const next = [...prev];
          next[nextIdx] = 'active';
          return next;
        });
        setTappedNote(null);

        if (playSound) {
          void playNote(measure[nextIdx].note, NOTE_PLAY_DURATION);
        }
      }
    },
    [nextMeasure, playNote, playSound],
  );

  // Initialize first measure
  useEffect(() => {
    nextMeasure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Regenerate when fret range changes
  useEffect(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    nextMeasure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fretStart, fretEnd]);

  // Persist settings whenever they change
  useEffect(() => {
    saveSettings({ fretStart, fretEnd, hintMode, playSound });
  }, [fretStart, fretEnd, hintMode, playSound]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  // ---- Build fretboard highlight keys ----
  const highlightKeys: KeyHighlight[] = useMemo(() => {
    const current = measureNotes[currentNoteIndex];
    if (!current || tappedNote === null) return [];

    const noteStatesCopy = [...noteStates];
    const currentState = noteStatesCopy[currentNoteIndex];

    // Only show highlights after user has tapped (answered)
    if (currentState === 'active') return [];

    const result: KeyHighlight[] = [];

    if (currentState === 'correct') {
      // Highlight ALL matching positions as correct
      for (let si = 0; si < GUITAR_TUNING.length; si++) {
        for (let f = fretStart; f <= fretEnd; f++) {
          const note = getFretNote(si, f);
          if (note === current.note) {
            result.push({ note, state: 'correct' });
          }
        }
      }
    } else if (currentState === 'wrong') {
      // Highlight the wrong tap and reveal all correct positions
      if (tappedNote) {
        result.push({ note: tappedNote, state: 'wrong' });
      }
      for (let si = 0; si < GUITAR_TUNING.length; si++) {
        for (let f = fretStart; f <= fretEnd; f++) {
          const note = getFretNote(si, f);
          if (note === current.note) {
            result.push({ note, state: 'reveal' });
          }
        }
      }
    }

    return result;
  }, [measureNotes, currentNoteIndex, noteStates, tappedNote, fretStart, fretEnd]);

  // Highlight for previously completed notes (done in the measure)
  const completedHighlightKeys: KeyHighlight[] = useMemo(() => {
    const result: KeyHighlight[] = [];
    for (let i = 0; i < measureNotes.length; i++) {
      if (noteStates[i] === 'correct') {
        for (let si = 0; si < GUITAR_TUNING.length; si++) {
          for (let f = fretStart; f <= fretEnd; f++) {
            const note = getFretNote(si, f);
            if (note === measureNotes[i].note) {
              result.push({ note, state: 'correct' });
            }
          }
        }
      }
    }
    return result;
  }, [measureNotes, noteStates, fretStart, fretEnd]);

  // ---- getNoteLabel based on hint mode ----
  const getNoteLabel = useMemo(() => {
    if (hintMode === 'none') return undefined;
    if (hintMode === 'solfege')
      return (note: string) => noteToSolfegeLabel(note);
    // hintMode === 'noteName' — show note names (use GuitarFretboard default)
    return undefined;
  }, [hintMode]);

  const showNoteLabels = hintMode === 'noteName';

  // ---- Handlers ----

  const replayCurrentNote = useCallback(() => {
    const current = measureNotes[currentNoteIndex];
    if (!current) return;
    void playNote(current.note, NOTE_PLAY_DURATION);
  }, [measureNotes, currentNoteIndex, playNote]);

  const handleFretPress = useCallback(
    (_pitchClass: string, note: string) => {
      const current = measureNotes[currentNoteIndex];
      if (!current || tappedNote !== null) return;

      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      setTappedNote(note);
      setSessionTotal((n) => n + 1);

      const correct = note === current.note;

      // Record review in spaced-repetition system
      sr.recordReview(current.note, correct);

      if (correct) {
        // Correct: mark green and advance immediately
        setNoteStates((prev) => {
          const next = [...prev];
          next[currentNoteIndex] = 'correct';
          return next;
        });
        setSessionCorrect((n) => n + 1);
        setStreak((n) => n + 1);
        message.success(t('fretboardMemo.correct'));

        // Advance to next note after a brief delay so the user can see the feedback
        timeoutRef.current = window.setTimeout(() => {
          timeoutRef.current = null;
          advanceToNextNote(measureNotes, currentNoteIndex);
        }, 600);
      } else {
        // Wrong: play the tonic walk so the user hears the pitch context
        void playTonicWalk(playNote, current.note, {
          startNoteDuration: NOTE_PLAY_DURATION,
          noteDuration: WALK_NOTE_DURATION,
        });

        // Calculate playback duration from the tonic-walk length
        const seqLen = buildTonicWalkSequence(current.note).length;
        const playbackMs =
          seqLen === 1
            ? NOTE_PLAY_DURATION * 1000 + 400
            : (NOTE_PLAY_DURATION * 1000 + WALK_GAP_MS) +
              (seqLen - 2) * (WALK_NOTE_DURATION * 1000 + WALK_GAP_MS) +
              WALK_NOTE_DURATION * 1000 +
              400;

        // Mark current note as wrong (red) temporarily
        setNoteStates((prev) => {
          const next = [...prev];
          next[currentNoteIndex] = 'wrong';
          return next;
        });
        setStreak(0);
        const { pc, octave } = parseNote(current.note);
        message.error(
          `${t('fretboardMemo.wrong')} ${pc}${octave}`,
        );

        // After the tonic walk finishes, revert wrong → active so user can retry
        timeoutRef.current = window.setTimeout(() => {
          timeoutRef.current = null;
          setNoteStates((prev) => {
            const next = [...prev];
            if (next[currentNoteIndex] === 'wrong') {
              next[currentNoteIndex] = 'active';
            }
            return next;
          });
          setTappedNote(null);
        }, playbackMs);
      }
    },
    [
      measureNotes, currentNoteIndex, tappedNote, playNote, t,
      advanceToNextNote, sr.recordReview,
    ],
  );

  const handleSettingsClose = useCallback(() => {
    setSettingsOpen(false);
  }, []);

  // ---- Build note colors for StaffDisplay ----
  const staffNoteColors = useMemo(() => {
    return measureNotes.map((_, i) => {
      const state = noteStates[i];
      switch (state) {
        case 'active':
          return '#3b82f6'; // blue — current note to identify
        case 'correct':
          return '#22c55e'; // green — answered correctly
        case 'wrong':
          return '#ef4444'; // red — answered incorrectly
        case 'pending':
        default:
          return '#2c2c2c'; // dark — not yet addressed
      }
    });
  }, [measureNotes, noteStates]);

  // Build the EasyScore note strings with octave shift for treble clef display
  const staffNotes = useMemo(() => {
    return measureNotes.map(
      (mn) => `${shiftOctave(mn.note, 1)}/${mn.duration}`,
    );
  }, [measureNotes]);

  // Merge highlights: current note's feedback takes priority over completed notes
  const allHighlights = useMemo(() => {
    // If we have current-note feedback, show only that
    if (highlightKeys.length > 0) return highlightKeys;
    // Otherwise show completed notes' positions
    return completedHighlightKeys;
  }, [highlightKeys, completedHighlightKeys]);

  // Fretboard is "answering" when there's an active note and no tap yet
  const isAnswering = tappedNote === null;

  // ---- Render ----

  const accuracy = sessionTotal > 0 ? Math.round((sessionCorrect / sessionTotal) * 100) : null;
  const staffWidth = screens.xl ? 520 : screens.lg ? 440 : 360;
  const currentNote = measureNotes[currentNoteIndex];

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        overflow: 'hidden',
      }}
    >
      {/* ── Top area: staff display with settings button ── */}
      <Card
        title={
          <Space>
            {!isDesktop && (
              <Button
                type="text"
                icon={<MenuOutlined />}
                onClick={() => triggerOpenDrawer()}
                style={{ padding: 0 }}
              />
            )}
            <span style={{ fontWeight: 600 }}>{t('fretboardMemo2.title')}</span>
          </Space>
        }
        extra={
          <Button
            type="text"
            icon={<SettingOutlined />}
            onClick={() => setSettingsOpen(true)}
          />
        }
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          marginBottom: 0,
          minHeight: 0,
        }}
        styles={{ body: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' } }}
      >
        {/* Stats row */}
        <Space style={{ marginBottom: 12 }} size={16}>
          {streak >= 3 && (
            <Text style={{ color: '#dc2626', fontWeight: 600 }}>
              🔥 ×{streak}
            </Text>
          )}
          {accuracy !== null && (
            <Text type="secondary" style={{ fontSize: 13 }}>
              {t('fretboardMemo2.accuracy')}: {accuracy}%
            </Text>
          )}
          <Text type="secondary" style={{ fontSize: 13 }}>
            {t('fretboardMemo2.poolCount', { count: notePool.length })}
          </Text>
        </Space>

        {/* Staff display — click to replay current note */}
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
            minHeight: 240,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: currentNote ? 'pointer' : 'default',
            width: '100%',
            maxWidth: 600,
          }}
        >
          <Text type="secondary" style={{ fontSize: 13, marginBottom: 8 }}>
            {t('fretboardMemo2.questionPrompt')}
          </Text>
          {measureNotes.length > 0 && (
            <StaffDisplay
              notes={staffNotes}
              clef="treble"
              noteColors={staffNoteColors}
              width={staffWidth}
              height={210}
            />
          )}
          <Space style={{ marginTop: 8 }}>
            <SoundOutlined style={{ color: '#9ca3af', fontSize: 14 }} />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('fretboardMemo2.clickToReplay')}
            </Text>
          </Space>
        </div>
      </Card>

      {/* ── Bottom: guitar fretboard (pinned to bottom) ── */}
      <div
        style={{
          flexShrink: 0,
          overflow: 'hidden',
          background: '#fff',
          borderTop: '1px solid #f0f0f0',
        }}
      >
        <GuitarFretboard
          onKeyPress={handleFretPress}
          highlightKeys={allHighlights}
          disabled={!isAnswering}
          showNoteLabels={showNoteLabels}
          getNoteLabel={getNoteLabel}
          showRangeSlider={false}
          fretStart={fretStart}
          fretEnd={fretEnd}
        />
      </div>

      {/* ── Settings drawer ── */}
      <Drawer
        title={t('fretboardMemo2.settings')}
        open={settingsOpen}
        onClose={handleSettingsClose}
        placement="right"
        width={isDesktop ? 320 : '100%'}
      >
        <Space direction="vertical" style={{ width: '100%' }} size={24}>
          {/* Fret range */}
          <div>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>
              {t('fretboardMemo2.fretRange')}
            </Text>
            <Space size={8}>
              <Select
                value={fretStart}
                onChange={(v) => {
                  setFretStart(v);
                  if (v > fretEnd) setFretEnd(Math.min(v + 5, MAX_FRET));
                }}
                options={FRET_OPTIONS}
                style={{ width: 110 }}
                placeholder={t('fretboardMemo2.from')}
              />
              <Text type="secondary">{t('fretboardMemo2.to')}</Text>
              <Select
                value={fretEnd}
                onChange={(v) => {
                  setFretEnd(v);
                  if (v < fretStart) setFretStart(Math.max(v - 5, 0));
                }}
                options={FRET_OPTIONS}
                style={{ width: 110 }}
                placeholder={t('fretboardMemo2.to')}
              />
            </Space>
            <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
              {t('fretboardMemo2.fretRangeHint', { count: notePool.length })}
            </Text>
          </div>

          {/* Hint mode */}
          <div>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>
              {t('fretboardMemo2.hintMode')}
            </Text>
            <Select
              value={hintMode}
              onChange={(v) => setHintMode(v)}
              options={HINT_MODE_OPTIONS.map((opt) => ({
                value: opt.value,
                label: t(`fretboardMemo2.hintMode_${opt.value}`),
              }))}
              style={{ width: 160 }}
            />
          </div>

          {/* Play sound toggle */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8 }}>
              <Text strong>{t('fretboardMemo2.playSound')}</Text>
              <Switch checked={playSound} onChange={setPlaySound} />
            </div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('fretboardMemo2.playSoundDesc')}
            </Text>
          </div>
        </Space>
      </Drawer>
    </div>
  );
}
