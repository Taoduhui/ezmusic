/**
 * SightSinging — staff note → solfège drill.
 *
 * A treble-clef staff note is displayed at the top and the user picks the
 * correct solfège syllable (唱名) from three options at the bottom.
 *
 * A settings button (top-right) opens a drawer where the user can configure
 * the fret range and sound playback.
 */
import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  Button, Text, Drawer, Select, Space, useBreakpoint, message, Card, Switch,
  SettingOutlined, SoundOutlined, CheckOutlined, CloseOutlined, ChevronLeftIcon,
} from '@ezmusic/shared';
import { useTranslation } from 'react-i18next';
import {
  SOLFEGE_SYLLABLES,
  useAudio,
  playTonicWalk,
  buildTonicWalkSequence,
  triggerOpenDrawer,
  shuffleArray,
} from '@ezmusic/shared';
import { useSRDrill } from '@ezmusic/spaced-repetition';
import { StaffDisplay } from '@ezmusic/chapter-staff-notation';

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

const STORAGE_KEY = 'ezmusic-sight-singing-settings';

const NOTE_PLAY_DURATION = 0.8;
const WALK_NOTE_DURATION = 0.4;
const WALK_GAP_MS = 75;

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

/** Map a note's pitch class to its solfège syllable (C-major / fixed-Do). */
function getSolfege(note: string): string {
  const { pc } = parseNote(note);
  const naturalPc = pc[0]; // strip accidental
  const idx = ['C', 'D', 'E', 'F', 'G', 'A', 'B'].indexOf(naturalPc);
  if (idx === -1) return SOLFEGE_SYLLABLES[0];
  const base = SOLFEGE_SYLLABLES[idx];
  // Append accidental suffix if present
  const accidental = pc.slice(1);
  if (accidental) {
    const symbol = accidental === '#' ? '♯' : accidental === 'b' ? '♭' : accidental;
    return `${base}${symbol}`;
  }
  return base;
}

function getSolfegeDistractors(correctSolfege: string): string[] {
  const baseSolfege = correctSolfege.replace(/[♯♭#b].*$/, '');
  const correctIdx = (SOLFEGE_SYLLABLES as readonly string[]).indexOf(baseSolfege);

  const candidates: string[] = [];
  // Try increasing distance until we have 2
  const offsets = [1, -1, 2, -2, 3, -3];
  for (const offset of offsets) {
    if (candidates.length >= 2) break;
    const idx = ((correctIdx + offset) % 7 + 7) % 7;
    const solfege = SOLFEGE_SYLLABLES[idx];
    if (!candidates.includes(solfege)) {
      candidates.push(solfege);
    }
  }
  return candidates;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

interface SightSingingSettings {
  fretStart: number;
  fretEnd: number;
  playSound: boolean;
}

function loadSettings(): SightSingingSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SightSingingSettings>;
      return {
        fretStart: parsed.fretStart ?? DEFAULT_FRET_START,
        fretEnd: parsed.fretEnd ?? DEFAULT_FRET_END,
        playSound: parsed.playSound ?? true,
      };
    }
  } catch { /* ignore corrupt data */ }
  return { fretStart: DEFAULT_FRET_START, fretEnd: DEFAULT_FRET_END, playSound: true };
}

function saveSettings(settings: SightSingingSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch { /* ignore quota errors */ }
}

// ---------------------------------------------------------------------------
// Answer button sub-component
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
  let icon: React.ReactNode = null;

  if (state === 'correct') {
    bg = '#d1fae5'; border = '#059669'; color = '#065f46'; icon = <CheckOutlined />;
  } else if (state === 'wrong') {
    bg = '#fee2e2'; border = '#dc2626'; color = '#991b1b'; icon = <CloseOutlined />;
  } else if (state === 'reveal') {
    bg = '#ddd6fe'; border = '#7c3aed'; color = '#4c1d95';
  }

  return (
    <Button
      block
      size="large"
      disabled={disabled}
      onClick={onClick}
      icon={icon ?? undefined}
      style={{
        height: 56,
        fontWeight: 600,
        fontSize: 18,
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
// Main component
// ---------------------------------------------------------------------------

export default function SightSinging() {
  const { t } = useTranslation();
  const screens = useBreakpoint();
  const isDesktop = !!screens.lg;
  const { playNote } = useAudio();

  // ---- Spaced repetition ----
  const sr = useSRDrill({ storageKey: 'ezmusic-sight-singing-sr' });

  // ---- Settings state ----
  const [settingsOpen, setSettingsOpen] = useState(false);
  const persisted = useMemo(() => loadSettings(), []);
  const [fretStart, setFretStart] = useState(persisted.fretStart);
  const [fretEnd, setFretEnd] = useState(persisted.fretEnd);
  const [playSound, setPlaySound] = useState(persisted.playSound);

  // ---- Question state ----
  const [currentNote, setCurrentNote] = useState<string | null>(null);
  const [choices, setChoices] = useState<string[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
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

  /** Generate a new question using SR-weighted selection */
  const nextQuestion = useCallback(() => {
    if (autoAdvanceRef.current !== null) {
      window.clearTimeout(autoAdvanceRef.current);
      autoAdvanceRef.current = null;
    }

    if (notePool.length === 0) return;

    // SR-weighted selection: prefer notes due/overdue for review
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
    const correctSolfege = getSolfege(note);
    const distractors = getSolfegeDistractors(correctSolfege);
    const options = shuffleArray([correctSolfege, ...distractors]);

    setCurrentNote(note);
    setChoices(options);
    setChosen(null);

    if (playSound) {
      void playNote(note, NOTE_PLAY_DURATION);
    }
  }, [notePool, playNote, sr, currentNote, playSound]);

  // Initialize first question
  useEffect(() => {
    nextQuestion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Regenerate when fret range changes
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
    saveSettings({ fretStart, fretEnd, playSound });
  }, [fretStart, fretEnd, playSound]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (autoAdvanceRef.current !== null) {
        window.clearTimeout(autoAdvanceRef.current);
      }
    };
  }, []);

  // ---- Handlers ----

  const replayCurrentNote = useCallback(() => {
    if (!currentNote) return;
    void playNote(currentNote, NOTE_PLAY_DURATION);
  }, [currentNote, playNote]);

  const handleAnswer = useCallback(
    (answer: string) => {
      if (!currentNote || chosen !== null) return;

      if (autoAdvanceRef.current !== null) {
        window.clearTimeout(autoAdvanceRef.current);
        autoAdvanceRef.current = null;
      }

      setChosen(answer);
      setSessionTotal((n) => n + 1);

      const correctSolfege = getSolfege(currentNote);
      const isCorrect = answer === correctSolfege;

      // Record review in spaced-repetition system
      sr.recordReview(currentNote, isCorrect);

      // Always play the tonic walk, regardless of correctness.
      // The current (question) note plays at full duration; subsequent notes
      // play faster so the walk feels brisk.
      void playTonicWalk(playNote, currentNote, {
        startNoteDuration: NOTE_PLAY_DURATION,
        noteDuration: WALK_NOTE_DURATION,
      });

      if (isCorrect) {
        setSessionCorrect((n) => n + 1);
        setStreak((n) => n + 1);
        message.success(t('sightSinging.correct'));
      } else {
        setStreak(0);
        message.error(`${t('sightSinging.wrong')} ${correctSolfege}`);
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
    [currentNote, chosen, playNote, t, nextQuestion, sr.recordReview],
  );

  const getButtonState = useCallback(
    (option: string): 'idle' | 'correct' | 'wrong' | 'reveal' => {
      if (chosen === null) return 'idle';
      if (currentNote === null) return 'idle';
      const correctSolfege = getSolfege(currentNote);
      if (option === correctSolfege) return chosen === correctSolfege ? 'correct' : 'reveal';
      if (option === chosen) return 'wrong';
      return 'idle';
    },
    [chosen, currentNote],
  );

  const handleSettingsClose = useCallback(() => {
    setSettingsOpen(false);
    // Regenerate question if range changed (handled by the useEffect on fretStart/fretEnd)
  }, []);

  // ---- Render ----

  const accuracy = sessionTotal > 0 ? Math.round((sessionCorrect / sessionTotal) * 100) : null;
  const staffWidth = screens.xl ? 520 : screens.lg ? 440 : 360;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* ── Top area: staff display with settings button ── */}
      <Card
        title={
          <Space>
            <Button
              type="text"
              icon={<ChevronLeftIcon />}
              onClick={() => triggerOpenDrawer()}
              style={{ padding: 0 }}
              aria-label={t('nav.back')}
            />
            <span style={{ fontWeight: 600 }}>{t('sightSinging.title')}</span>
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
              {t('sightSinging.accuracy')}: {accuracy}%
            </Text>
          )}
          <Text type="secondary" style={{ fontSize: 13 }}>
            {t('sightSinging.poolCount', { count: notePool.length })}
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
            {t('sightSinging.questionPrompt')}
          </Text>
          {currentNote && (
            <StaffDisplay
              notes={shiftOctave(currentNote, 1)}
              clef="treble"
              highlightNote={chosen !== null ? shiftOctave(currentNote, 1) : undefined}
              width={staffWidth}
              height={210}
            />
          )}
          <Space style={{ marginTop: 8 }}>
            <SoundOutlined style={{ color: '#9ca3af', fontSize: 14 }} />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('sightSinging.clickToReplay')}
            </Text>
          </Space>
        </div>
      </Card>

      {/* ── Bottom answer area ── */}
      <div
        style={{
          flexShrink: 0,
          background: '#fff',
          borderTop: '1px solid #f0f0f0',
          padding: '12px 16px 16px',
        }}
      >
        <div style={{ display: 'flex', gap: 12 }}>
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
      </div>

      {/* ── Settings drawer ── */}
      <Drawer
        title={t('sightSinging.settings')}
        open={settingsOpen}
        onClose={handleSettingsClose}
        placement="right"
        width={isDesktop ? 320 : '100%'}
      >
        <Space direction="vertical" style={{ width: '100%' }} size={24}>
          {/* Fret range */}
          <div>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>
              {t('sightSinging.fretRange')}
            </Text>
            <Space size={8}>
              <Select
                value={fretStart}
                onChange={(v) => {
                  setFretStart(v);
                  if (v > fretEnd) setFretEnd(Math.min(v + 5, MAX_FRET));
                  setChosen(null);
                  if (autoAdvanceRef.current !== null) {
                    window.clearTimeout(autoAdvanceRef.current);
                    autoAdvanceRef.current = null;
                  }
                }}
                options={FRET_OPTIONS}
                style={{ width: 110 }}
                placeholder={t('sightSinging.from')}
              />
              <Text type="secondary">{t('sightSinging.to')}</Text>
              <Select
                value={fretEnd}
                onChange={(v) => {
                  setFretEnd(v);
                  if (v < fretStart) setFretStart(Math.max(v - 5, 0));
                  setChosen(null);
                  if (autoAdvanceRef.current !== null) {
                    window.clearTimeout(autoAdvanceRef.current);
                    autoAdvanceRef.current = null;
                  }
                }}
                options={FRET_OPTIONS}
                style={{ width: 110 }}
                placeholder={t('sightSinging.to')}
              />
            </Space>
            <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
              {t('sightSinging.fretRangeHint', { count: notePool.length })}
            </Text>
          </div>

          {/* Play sound toggle */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8 }}>
              <Text strong>{t('sightSinging.playSound')}</Text>
              <Switch checked={playSound} onChange={setPlaySound} />
            </div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('sightSinging.playSoundDesc')}
            </Text>
          </div>
        </Space>
      </Drawer>
    </div>
  );
}
