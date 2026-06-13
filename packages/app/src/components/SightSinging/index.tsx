/**
 * SightSinging — staff note → solfège drill.
 *
 * A treble-clef staff note is displayed at the top and the user picks the
 * correct solfège syllable (唱名) from three options at the bottom.
 *
 * A settings button (top-right) opens a drawer where the user can configure
 * the note range (default E2–C5, displayed one octave below actual pitch).
 */
import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  Button, Typography, Drawer, Select, Space, Grid, message, Card, Switch,
} from 'antd';
import {
  SettingOutlined, SoundOutlined, CheckOutlined, CloseOutlined,
  MenuOutlined,
} from '@ant-design/icons';
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

const { Text } = Typography;
const { useBreakpoint } = Grid;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Chromatic pitch classes (sharp form). */
const CHROMATIC_PC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Flat → sharp mapping for note parsing. */
const FLAT_TO_SHARP: Record<string, string> = {
  Bb: 'A#', Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#',
};

/** Natural pitch classes (no accidentals). */
const NATURAL_PC = new Set(['C', 'D', 'E', 'F', 'G', 'A', 'B']);

/** Default note range (displayed values — one octave below actual pitch). */
const DEFAULT_FROM = 'E2';
const DEFAULT_TO = 'C5';

const STORAGE_KEY = 'ezmusic-sight-singing-settings';

const NOTE_PLAY_DURATION = 0.8;
const WALK_NOTE_DURATION = 0.4;
const WALK_GAP_MS = 75;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse a scientific note name into pitch-class and octave. */
function parseNote(note: string): { pc: string; octave: number } {
  const match = /^([A-G][#b]?)(\d+)$/.exec(note);
  if (!match) throw new Error(`Invalid note: ${note}`);
  const rawPc = match[1];
  const pc = FLAT_TO_SHARP[rawPc] ?? rawPc;
  return { pc, octave: parseInt(match[2], 10) };
}

/** Compute a linear index for a note (semitones from C0). */
function noteIndex(note: string): number {
  const { pc, octave } = parseNote(note);
  const pcIdx = CHROMATIC_PC.indexOf(pc);
  if (pcIdx === -1) return 0;
  return octave * 12 + pcIdx;
}

/** Generate all natural notes between two note names (inclusive). */
function generateNaturalNotes(from: string, to: string): string[] {
  const fromIdx = noteIndex(from);
  const toIdx = noteIndex(to);
  const start = Math.min(fromIdx, toIdx);
  const end = Math.max(fromIdx, toIdx);

  const notes: string[] = [];
  for (let i = start; i <= end; i++) {
    const pc = CHROMATIC_PC[i % 12];
    if (NATURAL_PC.has(pc)) {
      notes.push(`${pc}${Math.floor(i / 12)}`);
    }
  }
  return notes;
}

/** Shift a scientific note name by a number of octaves (e.g. E2 → E3 with delta=+1). */
function shiftOctave(note: string, delta: number): string {
  const match = /^([A-G][#b]?)(\d+)$/.exec(note);
  if (!match) return note;
  return `${match[1]}${parseInt(match[2], 10) + delta}`;
}

/** Build all possible chromatic note names for the range dropdowns.
 *  Displayed one octave below actual pitch (guitar-style octave transposition). */
function buildAllNoteOptions(): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  for (let octave = 1; octave <= 5; octave++) {
    for (let i = 0; i < CHROMATIC_PC.length; i++) {
      if (octave === 5 && i > 0) break; // stop at C5
      const pc = CHROMATIC_PC[i];
      options.push({ value: `${pc}${octave}`, label: `${pc}${octave}` });
    }
  }
  return options;
}

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

const ALL_NOTE_OPTIONS = buildAllNoteOptions();

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

interface SightSingingSettings {
  fromNote: string;
  toNote: string;
  playSound: boolean;
}

function loadSettings(): SightSingingSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SightSingingSettings>;
      return {
        fromNote: parsed.fromNote ?? DEFAULT_FROM,
        toNote: parsed.toNote ?? DEFAULT_TO,
        playSound: parsed.playSound ?? true,
      };
    }
  } catch { /* ignore corrupt data */ }
  return { fromNote: DEFAULT_FROM, toNote: DEFAULT_TO, playSound: true };
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
  const [fromNote, setFromNote] = useState(persisted.fromNote);
  const [toNote, setToNote] = useState(persisted.toNote);
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
    () => generateNaturalNotes(shiftOctave(fromNote, 1), shiftOctave(toNote, 1)),
    [fromNote, toNote],
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

  // Regenerate when note range changes
  useEffect(() => {
    if (autoAdvanceRef.current !== null) {
      window.clearTimeout(autoAdvanceRef.current);
      autoAdvanceRef.current = null;
    }
    nextQuestion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromNote, toNote]);

  // Persist settings whenever they change
  useEffect(() => {
    saveSettings({ fromNote, toNote, playSound });
  }, [fromNote, toNote, playSound]);

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
    // Regenerate question if range changed (handled by the useEffect on fromNote/toNote)
  }, []);

  // ---- Render ----

  const accuracy = sessionTotal > 0 ? Math.round((sessionCorrect / sessionTotal) * 100) : null;
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
              notes={currentNote}
              clef="treble"
              highlightNote={chosen !== null ? currentNote : undefined}
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
          {/* Note range */}
          <div>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>
              {t('sightSinging.noteRange')}
            </Text>
            <Space size={8}>
              <Select
                value={fromNote}
                onChange={(v) => {
                  setFromNote(v);
                  setChosen(null);
                  if (autoAdvanceRef.current !== null) {
                    window.clearTimeout(autoAdvanceRef.current);
                    autoAdvanceRef.current = null;
                  }
                }}
                options={ALL_NOTE_OPTIONS}
                style={{ width: 120 }}
                showSearch
                optionFilterProp="label"
                placeholder={t('sightSinging.from')}
              />
              <Text type="secondary">{t('sightSinging.to')}</Text>
              <Select
                value={toNote}
                onChange={(v) => {
                  setToNote(v);
                  setChosen(null);
                  if (autoAdvanceRef.current !== null) {
                    window.clearTimeout(autoAdvanceRef.current);
                    autoAdvanceRef.current = null;
                  }
                }}
                options={ALL_NOTE_OPTIONS}
                style={{ width: 120 }}
                showSearch
                optionFilterProp="label"
                placeholder={t('sightSinging.to')}
              />
            </Space>
            <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
              {t('sightSinging.noteRangeHint', { count: notePool.length })}
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
