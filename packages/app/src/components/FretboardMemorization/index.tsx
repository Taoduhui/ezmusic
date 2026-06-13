/**
 * FretboardMemorization — staff note → fretboard position drill.
 *
 * A treble-clef staff note is displayed at the top and the user taps the
 * matching position on the guitar fretboard below.
 *
 * A settings button (top-right) opens a drawer where the user can configure
 * the fret range and the fretboard hint mode (none / note names / solfège).
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

const STORAGE_KEY = 'ezmusic-fretboard-memo-settings';

const NOTE_PLAY_DURATION = 0.8;
const WALK_NOTE_DURATION = 0.4;
const WALK_GAP_MS = 75;

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

/**
 * Get the scientific note name at a given string index (0 = low E) and fret.
 * Fret 0 = open string.
 */
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

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

interface FretboardMemoSettings {
  fretStart: number;
  fretEnd: number;
  hintMode: HintMode;
  playSound: boolean;
}

function loadSettings(): FretboardMemoSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<FretboardMemoSettings>;
      return {
        fretStart: parsed.fretStart ?? DEFAULT_FRET_START,
        fretEnd: parsed.fretEnd ?? DEFAULT_FRET_END,
        hintMode: parsed.hintMode ?? 'noteName',
        playSound: parsed.playSound ?? true,
      };
    }
  } catch {
    /* ignore corrupt data */
  }
  return {
    fretStart: DEFAULT_FRET_START,
    fretEnd: DEFAULT_FRET_END,
    hintMode: 'noteName',
    playSound: true,
  };
}

function saveSettings(settings: FretboardMemoSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* ignore quota errors */
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function FretboardMemorization() {
  const { t } = useTranslation();
  const screens = useBreakpoint();
  const isDesktop = !!screens.lg;
  const { playNote } = useAudio();

  // ---- Spaced repetition ----
  const sr = useSRDrill({ storageKey: 'ezmusic-fretboard-memo-sr' });

  // ---- Settings state ----
  const [settingsOpen, setSettingsOpen] = useState(false);
  const persisted = useMemo(() => loadSettings(), []);
  const [fretStart, setFretStart] = useState(persisted.fretStart);
  const [fretEnd, setFretEnd] = useState(persisted.fretEnd);
  const [hintMode, setHintMode] = useState<HintMode>(persisted.hintMode);
  const [playSound, setPlaySound] = useState(persisted.playSound);

  // ---- Question state ----
  const [currentNote, setCurrentNote] = useState<string | null>(null);
  const [answered, setAnswered] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [tappedNote, setTappedNote] = useState<string | null>(null);
  const [streak, setStreak] = useState(0);
  const [sessionCorrect, setSessionCorrect] = useState(0);
  const [sessionTotal, setSessionTotal] = useState(0);

  // Auto-advance timeout ref
  const autoAdvanceRef = useRef<number | null>(null);

  // ---- Derived ----
  const notePool = useMemo(
    () => generateFretboardNotes(fretStart, fretEnd),
    [fretStart, fretEnd],
  );

  // Ensure SR cards exist for all notes in the pool
  useEffect(() => {
    sr.ensureCards(notePool);
  }, [notePool, sr.ensureCards]);

  /** Generate a new question using SR-weighted selection. */
  const nextQuestion = useCallback(() => {
    if (autoAdvanceRef.current !== null) {
      window.clearTimeout(autoAdvanceRef.current);
      autoAdvanceRef.current = null;
    }

    if (notePool.length === 0) return;

    const selectedId = sr.pickNext(notePool, currentNote ?? undefined);
    const note =
      selectedId ??
      (() => {
        // Fallback: random pick, excluding currentNote when pool has alternatives
        const available =
          notePool.length > 1 && currentNote
            ? notePool.filter((n) => n !== currentNote)
            : notePool;
        return available[Math.floor(Math.random() * available.length)];
      })();

    setCurrentNote(note);
    setAnswered(false);
    setIsCorrect(false);
    setTappedNote(null);

    if (playSound) {
      void playNote(note, NOTE_PLAY_DURATION);
    }
  }, [notePool, playNote, sr, currentNote, playSound]);

  // Initialize first question
  useEffect(() => {
    nextQuestion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Regenerate when settings change
  useEffect(() => {
    if (autoAdvanceRef.current !== null) {
      window.clearTimeout(autoAdvanceRef.current);
      autoAdvanceRef.current = null;
    }
    nextQuestion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fretStart, fretEnd]);

  // Persist settings whenever they change
  useEffect(() => {
    saveSettings({ fretStart, fretEnd, hintMode, playSound });
  }, [fretStart, fretEnd, hintMode, playSound]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (autoAdvanceRef.current !== null) {
        window.clearTimeout(autoAdvanceRef.current);
      }
    };
  }, []);

  // ---- Build highlight keys ----
  const highlightKeys: KeyHighlight[] = useMemo(() => {
    if (!currentNote || !answered) return [];
    const result: KeyHighlight[] = [];

    if (isCorrect) {
      // Highlight ALL matching positions as correct
      for (let si = 0; si < GUITAR_TUNING.length; si++) {
        for (let f = fretStart; f <= fretEnd; f++) {
          const note = getFretNote(si, f);
          if (note === currentNote) {
            result.push({ note, state: 'correct' });
          }
        }
      }
    } else {
      // Highlight the wrong tap and reveal all correct positions
      if (tappedNote) {
        result.push({ note: tappedNote, state: 'wrong' });
      }
      for (let si = 0; si < GUITAR_TUNING.length; si++) {
        for (let f = fretStart; f <= fretEnd; f++) {
          const note = getFretNote(si, f);
          if (note === currentNote) {
            result.push({ note, state: 'reveal' });
          }
        }
      }
    }

    return result;
  }, [currentNote, answered, isCorrect, tappedNote, fretStart, fretEnd]);

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
    if (!currentNote) return;
    void playNote(currentNote, NOTE_PLAY_DURATION);
  }, [currentNote, playNote]);

  const handleFretPress = useCallback(
    (_pitchClass: string, note: string) => {
      if (!currentNote || answered) return;

      if (autoAdvanceRef.current !== null) {
        window.clearTimeout(autoAdvanceRef.current);
        autoAdvanceRef.current = null;
      }

      setTappedNote(note);
      setAnswered(true);
      setSessionTotal((n) => n + 1);

      const correct = note === currentNote;
      setIsCorrect(correct);

      // Record review in spaced-repetition system
      sr.recordReview(currentNote, correct);

      // Always play the tonic walk, regardless of correctness.
      // The current (question) note plays at full duration; subsequent notes
      // play faster so the walk feels brisk.
      void playTonicWalk(playNote, currentNote, {
        startNoteDuration: NOTE_PLAY_DURATION,
        noteDuration: WALK_NOTE_DURATION,
      });

      if (correct) {
        setSessionCorrect((n) => n + 1);
        setStreak((n) => n + 1);
        message.success(t('fretboardMemo.correct'));
      } else {
        setStreak(0);
        const { pc, octave } = parseNote(currentNote);
        message.error(
          `${t('fretboardMemo.wrong')} ${pc}${octave}`,
        );
      }

      // Auto-advance: delay calculated from tonic-walk length so the
      // sequence finishes sounding before the next question appears.
      // First note uses NOTE_PLAY_DURATION; subsequent notes use WALK_NOTE_DURATION.
      const seqLen = buildTonicWalkSequence(currentNote).length;
      const playbackMs =
        seqLen === 1
          ? NOTE_PLAY_DURATION * 1000 + 400
          : (NOTE_PLAY_DURATION * 1000 + WALK_GAP_MS) +
            (seqLen - 2) * (WALK_NOTE_DURATION * 1000 + WALK_GAP_MS) +
            WALK_NOTE_DURATION * 1000 +
            400;

      autoAdvanceRef.current = window.setTimeout(() => {
        autoAdvanceRef.current = null;
        nextQuestion();
      }, playbackMs);
    },
    [currentNote, answered, playNote, sr.recordReview, t, nextQuestion],
  );

  const handleSettingsClose = useCallback(() => {
    setSettingsOpen(false);
  }, []);

  // ---- Render ----

  const accuracy =
    sessionTotal > 0
      ? Math.round((sessionCorrect / sessionTotal) * 100)
      : null;
  const staffWidth = screens.xl ? 520 : screens.lg ? 440 : 360;

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
            <span style={{ fontWeight: 600 }}>
              {t('fretboardMemo.title')}
            </span>
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
        styles={{
          body: {
            flex: 1,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '12px 16px',
          },
        }}
      >
        {/* Stats row */}
        <Space style={{ marginBottom: 8 }} size={16}>
          {streak >= 3 && (
            <Text style={{ color: '#dc2626', fontWeight: 600 }}>
              🔥 ×{streak}
            </Text>
          )}
          {accuracy !== null && (
            <Text type="secondary" style={{ fontSize: 13 }}>
              {t('fretboardMemo.accuracy')}: {accuracy}%
            </Text>
          )}
          <Text type="secondary" style={{ fontSize: 13 }}>
            {t('fretboardMemo.poolCount', { count: notePool.length })}
          </Text>
        </Space>

        {/* Staff display — click to replay */}
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
            padding: '12px 8px',
            textAlign: 'center',
            minHeight: 200,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: currentNote ? 'pointer' : 'default',
            width: '100%',
            maxWidth: 600,
          }}
        >
          <Text type="secondary" style={{ fontSize: 13, marginBottom: 4 }}>
            {t('fretboardMemo.questionPrompt')}
          </Text>
          {currentNote && (
            <StaffDisplay
              notes={shiftOctave(currentNote, 1)}
              clef="treble"
              highlightNote={answered ? shiftOctave(currentNote, 1) : undefined}
              width={staffWidth}
              height={180}
            />
          )}
          <Space style={{ marginTop: 4 }}>
            <SoundOutlined style={{ color: '#9ca3af', fontSize: 14 }} />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('fretboardMemo.clickToReplay')}
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
          highlightKeys={highlightKeys}
          disabled={false}
          showNoteLabels={showNoteLabels}
          getNoteLabel={getNoteLabel}
          showRangeSlider={false}
          fretStart={fretStart}
          fretEnd={fretEnd}
        />
      </div>

      {/* ── Settings drawer ── */}
      <Drawer
        title={t('fretboardMemo.settings')}
        open={settingsOpen}
        onClose={handleSettingsClose}
        placement="right"
        width={isDesktop ? 320 : '100%'}
      >
        <Space direction="vertical" style={{ width: '100%' }} size={24}>
          {/* Fret range */}
          <div>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>
              {t('fretboardMemo.fretRange')}
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
                placeholder={t('fretboardMemo.from')}
              />
              <Text type="secondary">{t('fretboardMemo.to')}</Text>
              <Select
                value={fretEnd}
                onChange={(v) => {
                  setFretEnd(v);
                  if (v < fretStart)
                    setFretStart(Math.max(v - 5, 0));
                }}
                options={FRET_OPTIONS}
                style={{ width: 110 }}
                placeholder={t('fretboardMemo.to')}
              />
            </Space>
            <Text
              type="secondary"
              style={{ display: 'block', marginTop: 8, fontSize: 12 }}
            >
              {t('fretboardMemo.fretRangeHint', { count: notePool.length })}
            </Text>
          </div>

          {/* Hint mode */}
          <div>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>
              {t('fretboardMemo.hintMode')}
            </Text>
            <Select
              value={hintMode}
              onChange={(v) => setHintMode(v)}
              options={HINT_MODE_OPTIONS.map((opt) => ({
                value: opt.value,
                label: t(`fretboardMemo.hintMode_${opt.value}`),
              }))}
              style={{ width: 160 }}
            />
          </div>

          {/* Play sound toggle */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8 }}>
              <Text strong>{t('fretboardMemo.playSound')}</Text>
              <Switch checked={playSound} onChange={setPlaySound} />
            </div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('fretboardMemo.playSoundDesc')}
            </Text>
          </div>
        </Space>
      </Drawer>
    </div>
  );
}
