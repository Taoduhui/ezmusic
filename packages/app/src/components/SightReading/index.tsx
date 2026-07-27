/**
 * SightReading — staff note → play on guitar drill.
 *
 * A treble-clef staff note is displayed at the top and the user plays the
 * matching note on their guitar. A horizontal tuner-like dashboard at the
 * bottom shows the detected pitch in real time, and the recognised note
 * serves as the user's answer.
 *
 * A settings button (top-right) opens a drawer where the user can configure
 * the fret range and sound playback.
 */
import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  Button, Typography, Drawer, Select, Slider, Space, Grid, message, Card, Switch, Progress,
} from 'antd';
import {
  SettingOutlined, SoundOutlined, AudioOutlined, AudioMutedOutlined,
  MenuOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  useAudio,
  triggerOpenDrawer,
  playTonicWalk,
  buildTonicWalkSequence,
  detectPitchYIN,
  buildTunableNotes,
  findClosestNote,
  YIN_THRESHOLD,
  DEFAULT_MIN_FREQ_HZ,
  DEFAULT_MAX_FREQ_HZ,
  DBG,
  createDebugLogger,
  applyKeyToPool,
  COMMON_MAJOR_KEYS,
  respellNoteWithKey,
} from '@ezmusic/shared';
import type { TunableNote, YinOptions } from '@ezmusic/shared';
import { useSRDrill } from '@ezmusic/spaced-repetition';
import { StaffDisplay } from '@ezmusic/chapter-staff-notation';

const { Text } = Typography;
const { useBreakpoint } = Grid;

// ---------------------------------------------------------------------------
// Constants — note generation
// ---------------------------------------------------------------------------

/** Chromatic pitch classes (sharp form). */
const CHROMATIC_PC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Flat → sharp mapping for note parsing. */
const FLAT_TO_SHARP: Record<string, string> = {
  Bb: 'A#', Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#',
};

/** Natural pitch classes (no accidentals). */
const NATURAL_PC = new Set(['C', 'D', 'E', 'F', 'G', 'A', 'B']);

/** Standard guitar tuning from low (string 6) to high (string 1). */
const GUITAR_TUNING = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'];

const MAX_FRET = 24;
const DEFAULT_FRET_START = 0;
const DEFAULT_FRET_END = 5;

const DEFAULT_MIC_GAIN = 1.0;
const MIC_GAIN_MIN = 0.1;
const MIC_GAIN_MAX = 5.0;
const MIC_GAIN_STEP = 0.1;

const STORAGE_KEY = 'ezmusic-sight-reading-settings';

const NOTE_PLAY_DURATION = 0.8;
const WALK_NOTE_DURATION = 0.4;
const WALK_GAP_MS = 75;

// ---------------------------------------------------------------------------
// Constants — pitch detection
// ---------------------------------------------------------------------------

const TUNABLE_NOTES: TunableNote[] = buildTunableNotes(1, 6);

/** Hard minimum — signal must be at least this strong regardless of noise floor.
 *  Set to 0.002: after the 180 Hz high-pass filter removes bass energy,
 *  treble-note sustain on guitar can be as low as 0.002–0.004 RMS.
 *  False-trigger risk is minimal because the noise-floor-based threshold
 *  (3× ambient, typically ≥ 0.003) still dominates in quiet environments. */
const RMS_GATE_MIN = 0.002;
/** Signal must exceed noiseFloor × this to open the gate. */
const NOISE_MULTIPLIER = 3;
/** Noise-floor tracking: slow-rise time constant (per sample, ~2 s at 60 fps).
 *  Only applied while the gate is CLOSED so the note's own attack doesn't
 *  inflate the floor and reject its own sustain phase. */
const NOISE_ATTACK_COEFF = 0.008;
/** Noise-floor tracking: fast-fall time constant (~0.3 s at 60 fps). */
const NOISE_RELEASE_COEFF = 0.05;

// ---- High-pass filter to remove low-frequency rumble that masks treble notes ----
// 180 Hz 2nd-order BiquadFilter (Butterworth, Q=0.707, 12 dB/octave).
// This removes subsonic noise and handling rumble while preserving C2 and above.
const HIGH_PASS_CUTOFF_HZ = 180;
// When a target note is known, constrain the YIN lag search around the
// expected period (τ).  We use a ratio rather than a fixed semitone window
// so that the octave-below subharmonic (2×τ) is ALWAYS mechanically excluded
// regardless of sample rate.  A ratio of 1.8× allows ~10 semitones of flat
// detuning while keeping the search ceiling safely below 2×τ.
const TARGET_TAU_RATIO = 1.8;

// ---- Audio processing ----

const BUFFER_SIZE = 4096;
const FFT_SIZE = 8192;
const SMOOTHING_TIME_CONSTANT = 0;
const VOLUME_SCALE = 5;

// ---- Detection stability ----

/** Number of consecutive matching frames before accepting an answer. */
const STABILITY_FRAMES = 15;
/** Cooldown (ms) before accepting another answer after a wrong one. */
const WRONG_COOLDOWN_MS = 1200;

// ---- Dashboard layout ----

const DASHBOARD_HEIGHT = 150;
const DASHBOARD_CENTER_X = 400;
const DASHBOARD_X_RANGE = 160;
const DASHBOARD_WIDTH = 800;

// ---- Debug logger ----
const dbg = createDebugLogger('SR');

// ---------------------------------------------------------------------------
// Helpers — note theory
// ---------------------------------------------------------------------------

/** Parse a scientific note name into pitch-class and octave. */
function parseNote(note: string): { pc: string; octave: number } {
  const match = /^([A-G][#b]?)(\d+)$/.exec(note);
  if (!match) throw new Error(`Invalid note: ${note}`);
  const rawPc = match[1];
  const pc = FLAT_TO_SHARP[rawPc] ?? rawPc;
  return { pc, octave: parseInt(match[2], 10) };
}

/** Shift a scientific note name by a number of octaves. */
function shiftOctave(note: string, delta: number): string {
  const match = /^([A-G][#b]?)(\d+)$/.exec(note);
  if (!match) return note;
  return `${match[1]}${parseInt(match[2], 10) + delta}`;
}

/**
 * Get the scientific note name at a given string index (0 = low E) and fret.
 * Fret 0 = open string.
 */
function getFretNote(stringIdx: number, fret: number): string {
  const baseNote = GUITAR_TUNING[stringIdx];
  const { pc, octave } = parseNote(baseNote);
  const baseIdx = CHROMATIC_PC.indexOf(pc);
  if (baseIdx === -1) return baseNote;

  const totalIdx = baseIdx + fret;
  const newOctave = octave + Math.floor(totalIdx / 12);
  const newPC = CHROMATIC_PC[totalIdx % 12];
  return `${newPC}${newOctave}`;
}

/** Generate all unique natural notes found on the fretboard within [fretStart, fretEnd]. */
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
// Helpers — pitch detection (thin wrappers around shared YIN algorithm)
// ---------------------------------------------------------------------------

/**
 * Detect pitch with SightReading‑specific parameters.
 * RMS gating is handled by the caller (hysteresis gate in processAudio).
 * Delegates the YIN algorithm to {@link detectPitchYIN}.
 *
 * When `targetNoteLabel` is provided, the YIN lag search is constrained to
 * ±6 semitones around the target frequency.  This mechanically excludes
 * subharmonic lock (e.g. C5 → G#2, a 2.3‑octave drop) while tolerating
 * extreme detuning / pitch bends.
 */
function detectPitch(
  buffer: Float32Array,
  sampleRate: number,
  targetNoteLabel?: string | null,
  notes: TunableNote[] = TUNABLE_NOTES,
): number | null {
  const yinOpts: YinOptions = {
    // Use a more permissive threshold (0.25 vs default 0.15) because
    // SightReading has a target-constrained search range — the narrower
    // lag window means CMND normalisation has less history, which can
    // elevate CMND values.  The quality gate (2× = 0.50) still guards
    // against garbage detections.
    yinThreshold: 0.25,
    minFreqHz: DEFAULT_MIN_FREQ_HZ,
    maxFreqHz: DEFAULT_MAX_FREQ_HZ,
    debug: true,
  };

  if (targetNoteLabel) {
    const target = notes.find((n) => n.label === targetNoteLabel);
    if (target) {
      // Constrain the lag search around the EXPECTED period using a fixed
      // ratio.  This mechanically excludes the octave-below subharmonic
      // (2×τ) while allowing generous detuning headroom (~±10 semitones).
      const expectedTau = sampleRate / target.freq;
      yinOpts.searchMaxLag = Math.floor(expectedTau * TARGET_TAU_RATIO);
      yinOpts.searchMinLag = Math.ceil(expectedTau / TARGET_TAU_RATIO);
    }
  }

  const result = detectPitchYIN(buffer, sampleRate, yinOpts);
  return result?.freq ?? null;
}

/**
 * Find the closest standard note to a detected frequency.
 * Wraps the shared {@link findClosestNote} with the SightReading note list.
 */
function findClosestNoteForSR(freq: number, notes: TunableNote[] = TUNABLE_NOTES): TunableNote {
  return findClosestNote(freq, notes);
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

interface SightReadingSettings {
  fretStart: number;
  fretEnd: number;
  keySignature: string;
  playSound: boolean;
  playFeedback: boolean;
  micGain: number;
  selectedDeviceId: string | undefined;
}

function loadSettings(): SightReadingSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SightReadingSettings>;
      return {
        fretStart: parsed.fretStart ?? DEFAULT_FRET_START,
        fretEnd: parsed.fretEnd ?? DEFAULT_FRET_END,
        keySignature: parsed.keySignature ?? 'C',
        playSound: parsed.playSound ?? true,
        playFeedback: parsed.playFeedback ?? true,
        micGain: parsed.micGain ?? DEFAULT_MIC_GAIN,
        selectedDeviceId: parsed.selectedDeviceId ?? undefined,
      };
    }
  } catch { /* ignore corrupt data */ }
  return { fretStart: DEFAULT_FRET_START, fretEnd: DEFAULT_FRET_END, keySignature: 'C', playSound: true, playFeedback: true, micGain: DEFAULT_MIC_GAIN, selectedDeviceId: undefined };
}

function saveSettings(settings: SightReadingSettings): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Dashboard sub-component (horizontal tuner-like display)
// ---------------------------------------------------------------------------

interface DashboardProps {
  isListening: boolean;
  detectedNote: string | null;
  detectedFreq: number | null;
  targetNote: string | null;
  keySignature: string;
  volume: number;
  matchState: 'idle' | 'listening' | 'correct' | 'wrong';
  onStart: () => void;
  onStop: () => void;
  isDesktop: boolean;
}

function Dashboard({
  isListening,
  detectedNote,
  detectedFreq,
  targetNote,
  keySignature,
  volume,
  matchState,
  onStart,
  onStop,
  isDesktop,
}: DashboardProps) {
  const { t } = useTranslation();

  const statusColor = useMemo(() => {
    switch (matchState) {
      case 'correct': return '#22c55e';
      case 'wrong': return '#ef4444';
      case 'listening': return '#7c3aed';
      default: return '#6b7280';
    }
  }, [matchState]);

  const detectedLabel = detectedNote ?? '—';
  // Respell the sharp-form TUNABLE_NOTES to the active key so the target
  // note's label (e.g. "Bb4" in F major) can be found for cents display.
  const targetFreq = useMemo(() => {
    if (!targetNote) return null;
    const note = TUNABLE_NOTES.find(
      (n) => respellNoteWithKey(n.label, keySignature) === targetNote,
    );
    return note?.freq ?? null;
  }, [targetNote, keySignature]);

  // Cents deviation from target
  const centsOff = useMemo(() => {
    if (detectedFreq === null || targetFreq === null) return null;
    return 1200 * Math.log2(detectedFreq / targetFreq);
  }, [detectedFreq, targetFreq]);

  // Horizontal meter position: -DASHBOARD_X_RANGE .. +DASHBOARD_X_RANGE maps to ±50 cents
  const meterX = useMemo(() => {
    if (centsOff === null) return DASHBOARD_CENTER_X;
    const clamped = Math.max(-50, Math.min(50, centsOff));
    return DASHBOARD_CENTER_X + (clamped / 50) * DASHBOARD_X_RANGE;
  }, [centsOff]);

  const viewBoxW = DASHBOARD_WIDTH;
  const viewBoxH = DASHBOARD_HEIGHT;

  return (
    <div
      style={{
        flexShrink: 0,
        background:
          'linear-gradient(180deg, #1a1d23 0%, #14161a 100%)',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        padding: isDesktop ? '8px 24px 12px' : '6px 12px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      {/* Top row: detected note + controls */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <Space size={12}>
          <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12 }}>
            {t('sightReading.detectedNote')}
          </Text>
          <Text
            strong
            style={{
              color: statusColor,
              fontSize: isDesktop ? 28 : 22,
              fontVariantNumeric: 'tabular-nums',
              minWidth: 48,
              transition: 'color 0.2s',
            }}
          >
            {detectedLabel}
          </Text>
          {detectedFreq !== null && (
            <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>
              {detectedFreq.toFixed(1)} Hz
            </Text>
          )}
        </Space>

        <Space size={8}>
          <Button
            type={isListening ? 'default' : 'primary'}
            size="small"
            danger={isListening}
            icon={isListening ? <AudioMutedOutlined /> : <AudioOutlined />}
            onClick={isListening ? onStop : onStart}
          >
            {isListening ? t('sightReading.stop') : t('sightReading.start')}
          </Button>
        </Space>
      </div>

      {/* SVG horizontal meter */}
      <svg
        viewBox={`0 0 ${viewBoxW} ${viewBoxH}`}
        style={{
          display: 'block',
          width: '100%',
          height: isDesktop ? 76 : 56,
        }}
        role="img"
        aria-label={t('sightReading.title')}
      >
        <defs>
          <linearGradient id="sr-meter-bg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(255,255,255,0.04)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0.01)" />
          </linearGradient>
        </defs>

        {/* Background */}
        <rect
          x={0}
          y={0}
          width={viewBoxW}
          height={viewBoxH}
          fill="url(#sr-meter-bg)"
          rx={6}
        />

        {/* Center marker line */}
        <line
          x1={DASHBOARD_CENTER_X}
          x2={DASHBOARD_CENTER_X}
          y1={12}
          y2={viewBoxH - 4}
          stroke="rgba(255,255,255,0.12)"
          strokeWidth={1.5}
          strokeDasharray="4 4"
        />

        {/* Horizontal track bar */}
        <rect
          x={DASHBOARD_CENTER_X - DASHBOARD_X_RANGE}
          y={viewBoxH / 2 - 4}
          width={DASHBOARD_X_RANGE * 2}
          height={8}
          rx={4}
          fill="rgba(255,255,255,0.08)"
        />

        {/* Tick marks */}
        {[-40, -20, 0, 20, 40].map((cents) => {
          const tx = DASHBOARD_CENTER_X + (cents / 50) * DASHBOARD_X_RANGE;
          return (
            <g key={cents}>
              <line
                x1={tx} x2={tx}
                y1={viewBoxH / 2 - 12}
                y2={viewBoxH / 2 + 12}
                stroke="rgba(255,255,255,0.18)"
                strokeWidth={cents === 0 ? 1 : 0.6}
              />
              {cents !== 0 && (
                <text
                  x={tx}
                  y={viewBoxH / 2 + 24}
                  textAnchor="middle"
                  fill="rgba(255,255,255,0.25)"
                  fontSize={9}
                >
                  {cents > 0 ? '+' : ''}{cents}
                </text>
              )}
            </g>
          );
        })}

        {/* Flat / Sharp labels */}
        <text
          x={DASHBOARD_CENTER_X - DASHBOARD_X_RANGE - 10}
          y={viewBoxH / 2 + 5}
          textAnchor="end"
          fill="rgba(255,255,255,0.35)"
          fontSize={18}
          fontWeight={600}
        >
          ♭
        </text>
        <text
          x={DASHBOARD_CENTER_X + DASHBOARD_X_RANGE + 10}
          y={viewBoxH / 2 + 5}
          textAnchor="start"
          fill="rgba(255,255,255,0.35)"
          fontSize={18}
          fontWeight={600}
        >
          ♯
        </text>

        {/* Moving indicator dot */}
        {detectedFreq !== null && (
          <>
            <circle
              cx={meterX}
              cy={viewBoxH / 2}
              r={10}
              fill="none"
              stroke={statusColor}
              strokeWidth={2.5}
              style={{ transition: 'cx 0.08s linear' }}
            />
            <circle
              cx={meterX}
              cy={viewBoxH / 2}
              r={4}
              fill={statusColor}
              style={{ transition: 'cx 0.08s linear' }}
            />
          </>
        )}
      </svg>

      {/* Bottom row: volume + status */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 100, flex: 1, maxWidth: 200 }}>
          <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, whiteSpace: 'nowrap' }}>
            {t('sightReading.inputLevel')}
          </Text>
          <Progress
            percent={Math.round(volume * 100)}
            size="small"
            showInfo={false}
            strokeColor={
              volume < 0.1 ? '#ef4444' : volume < 0.3 ? '#f59e0b' : '#22c55e'
            }
            style={{ flex: 1, minWidth: 40 }}
          />
        </div>

        <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11 }}>
          {isListening
            ? matchState === 'correct'
              ? t('sightReading.statusCorrect')
              : matchState === 'wrong'
                ? t('sightReading.statusWrong')
                : t('sightReading.listening')
            : t('sightReading.notListening')}
        </Text>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function SightReading() {
  const { t } = useTranslation();
  const screens = useBreakpoint();
  const isDesktop = !!screens.lg;
  const { playNote } = useAudio();

  // ---- Spaced repetition ----
  const sr = useSRDrill({ storageKey: 'ezmusic-sight-reading-sr' });

  // ---- Settings state ----
  const [settingsOpen, setSettingsOpen] = useState(false);
  const persisted = useMemo(() => loadSettings(), []);
  const [fretStart, setFretStart] = useState(persisted.fretStart);
  const [fretEnd, setFretEnd] = useState(persisted.fretEnd);
  const [keySignature, setKeySignature] = useState(persisted.keySignature);
  const [playSound, setPlaySound] = useState(persisted.playSound);
  const [playFeedback, setPlayFeedback] = useState(persisted.playFeedback);
  const [micGain, setMicGain] = useState(persisted.micGain);

  // ---- Question state ----
  const [currentNote, setCurrentNote] = useState<string | null>(null);
  const [answered, setAnswered] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [streak, setStreak] = useState(0);
  const [sessionCorrect, setSessionCorrect] = useState(0);
  const [sessionTotal, setSessionTotal] = useState(0);

  // Auto-advance timeout ref
  const autoAdvanceRef = useRef<number | null>(null);

  // ---- Audio / pitch detection state ----
  const [isListening, setIsListening] = useState(false);
  const [detectedNote, setDetectedNote] = useState<string | null>(null);
  const [detectedFreq, setDetectedFreq] = useState<number | null>(null);
  const [volume, setVolume] = useState(0);
  const [matchState, setMatchState] = useState<'idle' | 'listening' | 'correct' | 'wrong'>('idle');
  const [micError, setMicError] = useState<string | null>(null);

  // ---- Audio device selection ----
  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | undefined>(
    persisted.selectedDeviceId,
  );

  const enumerateDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter((d) => d.kind === 'audioinput');
      setAudioInputDevices(inputs);
      // If the currently selected device is no longer available, fall back to default
      if (
        inputs.length > 0 &&
        selectedDeviceId &&
        !inputs.find((d) => d.deviceId === selectedDeviceId)
      ) {
        setSelectedDeviceId(undefined);
      }
    } catch {
      // Silently ignore — enumerateDevices may fail if permissions aren't granted yet
    }
  }, [selectedDeviceId]);

  // Populate device list on mount and listen for device changes
  useEffect(() => {
    enumerateDevices();
    navigator.mediaDevices?.addEventListener('devicechange', enumerateDevices);
    return () => {
      navigator.mediaDevices?.removeEventListener('devicechange', enumerateDevices);
    };
  }, [enumerateDevices]);

  const handleDeviceChange = useCallback((deviceId: string) => {
    setSelectedDeviceId(deviceId || undefined);
  }, []);

  // Audio refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number>(0);
  const bufferRef = useRef<Float32Array<ArrayBuffer>>(
    new Float32Array(new ArrayBuffer(BUFFER_SIZE * Float32Array.BYTES_PER_ELEMENT)),
  );
  const highPassRef = useRef<BiquadFilterNode | null>(null);

  // Stability tracking
  const stableFramesRef = useRef(0);
  const lastDetectedNoteRef = useRef<string | null>(null);
  const wrongCooldownRef = useRef(0);

  // ---- Derived ----
  /** The note pool derived from the fretboard within the configured fret range,
   *  transformed by the selected key signature. */
  const notePool = useMemo(
    () => {
      const natural = generateFretboardNotes(fretStart, fretEnd);
      return [...new Set(applyKeyToPool(natural, keySignature))];
    },
    [fretStart, fretEnd, keySignature],
  );

  /** Key-aware tunable note list: labels respelled to the selected key's
   *  spelling convention (e.g. A# → Bb in F major) so pitch-detection
   *  output matches the notePool's labels. Frequencies are unchanged. */
  const tunableNotes = useMemo(
    () => TUNABLE_NOTES.map((n) => ({ ...n, label: respellNoteWithKey(n.label, keySignature) })),
    [keySignature],
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
        const available =
          notePool.length > 1 && currentNote
            ? notePool.filter((n) => n !== currentNote)
            : notePool;
        return available[Math.floor(Math.random() * available.length)];
      })();

    setCurrentNote(note);
    setAnswered(false);
    setIsCorrect(false);
    setMatchState('idle');
    stableFramesRef.current = 0;
    lastDetectedNoteRef.current = null;
    dbg.info(`[question] new target=${note} pool=${notePool.length}notes playSound=${playSound}`);

    if (playSound) {
      void playNote(note, NOTE_PLAY_DURATION);
    }
  }, [notePool, playNote, sr, currentNote, playSound]);

  // Initialize first question
  useEffect(() => {
    nextQuestion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Regenerate when fret range or key signature changes
  useEffect(() => {
    if (autoAdvanceRef.current !== null) {
      window.clearTimeout(autoAdvanceRef.current);
      autoAdvanceRef.current = null;
    }
    nextQuestion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fretStart, fretEnd, keySignature]);

  // Persist settings whenever they change
  useEffect(() => {
    saveSettings({ fretStart, fretEnd, keySignature, playSound, playFeedback, micGain, selectedDeviceId });
  }, [fretStart, fretEnd, keySignature, playSound, playFeedback, micGain, selectedDeviceId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (autoAdvanceRef.current !== null) {
        window.clearTimeout(autoAdvanceRef.current);
      }
      cancelAnimationFrame(animFrameRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      audioCtxRef.current?.close();
    };
  }, []);

  // ---- Pitch detection logic ----

  // Refs to avoid stale closures in the RAF loop
  const answeredRef = useRef(answered);
  answeredRef.current = answered;
  const currentNoteRef = useRef(currentNote);
  currentNoteRef.current = currentNote;
  const isListeningRef = useRef(isListening);
  isListeningRef.current = isListening;
  const micGainRef = useRef(micGain);
  micGainRef.current = micGain;
  const tunableNotesRef = useRef(tunableNotes);
  tunableNotesRef.current = tunableNotes;

  // Debug: track recent detection history to diagnose flickering
  const debugFrameRef = useRef(0);
  const debugHistoryRef = useRef<string[]>([]); // last 20 detection results

  // Adaptive noise floor — tracks ambient noise level, rising slowly & falling quickly
  const noiseFloorRef = useRef(0.001);
  // Track whether the gate was open on the PREVIOUS frame.
  // When true, noise-floor updates are frozen to prevent the note's own
  // attack from inflating the floor and rejecting its quieter sustain phase.
  const gateWasOpenRef = useRef(false);

  const processAudio = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;

    const buffer = bufferRef.current;
    analyser.getFloatTimeDomainData(buffer);

    // Apply digital microphone gain
    const gain = micGainRef.current;
    if (gain !== 1.0) {
      for (let i = 0; i < buffer.length; i++) buffer[i] *= gain;
    }

    // Compute volume (RMS)
    let sumSq = 0;
    for (let i = 0; i < buffer.length; i++) sumSq += buffer[i] * buffer[i];
    const rms = Math.sqrt(sumSq / buffer.length);
    setVolume(Math.min(1, rms * VOLUME_SCALE));

    // ── Adaptive noise gate ──
    // Noise floor tracks ambient level: slow to rise, fast to fall.
    // CRITICAL: only update the noise floor when the gate was CLOSED on the
    // previous frame.  Otherwise a note's own attack transient inflates the
    // floor, which then rejects the (quieter) sustain phase — the note
    // "self-rejects" after a single frame of detection.
    const prevNoiseFloor = noiseFloorRef.current;
    const prevGateOpen = gateWasOpenRef.current;
    if (!prevGateOpen) {
      if (rms > prevNoiseFloor) {
        noiseFloorRef.current += (rms - prevNoiseFloor) * NOISE_ATTACK_COEFF;
      } else {
        noiseFloorRef.current += (rms - prevNoiseFloor) * NOISE_RELEASE_COEFF;
      }
      // Clamp noise floor to a sane minimum so it can't go to zero
      if (noiseFloorRef.current < 0.0005) noiseFloorRef.current = 0.0005;
    }

    const threshold = Math.max(RMS_GATE_MIN, noiseFloorRef.current * NOISE_MULTIPLIER);
    const gateOpen = rms >= threshold;
    gateWasOpenRef.current = gateOpen;
    const frameN = debugFrameRef.current++;

    // Periodic diagnostic
    if (frameN % 60 === 0) {
      dbg.debug(`[gate] f=${frameN} rms=${rms.toFixed(4)} noiseFloor=${noiseFloorRef.current.toFixed(4)} threshold=${threshold.toFixed(4)} open=${gateOpen}`);
    }

    if (!gateOpen) {
      // Below threshold — skip YIN, treat as silence
      stableFramesRef.current = 0;
      lastDetectedNoteRef.current = null;
      debugHistoryRef.current = [];
      if (!answeredRef.current && isListeningRef.current) setMatchState('idle');
      animFrameRef.current = requestAnimationFrame(processAudio);
      return;
    }

    // Log YIN input context on every frame so YIN:dbg lines can be correlated
    // with gate state.  Use a brief log to keep the console readable.
    if (frameN % 5 === 0) {
      dbg.debug(`[yin-call] f=${frameN} rms=${rms.toFixed(4)} gate=open → calling YIN`);
    }
    const detected = detectPitch(buffer, analyser.context.sampleRate, currentNoteRef.current, tunableNotesRef.current);

    if (detected !== null && detected >= DEFAULT_MIN_FREQ_HZ && detected <= DEFAULT_MAX_FREQ_HZ) {
      const closest = findClosestNoteForSR(detected, tunableNotesRef.current);
      setDetectedFreq(parseFloat(detected.toFixed(2)));
      setDetectedNote(closest.label);

      // Track recent history for diagnostics
      const history = debugHistoryRef.current;
      history.push(closest.label);
      if (history.length > 20) history.shift();

      // Stability check for answer evaluation (use refs for latest values)
      const curAnswered = answeredRef.current;
      const curNote = currentNoteRef.current;

      if (!curAnswered && curNote && performance.now() > wrongCooldownRef.current) {
        const prevDetected = lastDetectedNoteRef.current;
        if (closest.label === prevDetected) {
          stableFramesRef.current++;
          // Log every frame during early stability, then every 5
          if (stableFramesRef.current <= 5 || stableFramesRef.current % 5 === 0) {
            dbg.debug(`[stable] f=${frameN} note=${closest.label} target=${curNote} stable=${stableFramesRef.current}/${STABILITY_FRAMES} match=${closest.label === curNote} rms=${rms.toFixed(4)} freq=${detected.toFixed(1)}`);
          }
          if (stableFramesRef.current >= STABILITY_FRAMES) {
            const correct = closest.label === curNote;
            dbg.info(`[SUBMIT] f=${frameN} detected=${closest.label} target=${curNote} correct=${correct} history=[${history.join(',')}]`);
            handleAnswerRef.current(correct, closest.label);
          }
        } else {
          // Note changed — log the flicker event with history
          dbg.debug(`[flicker] f=${frameN} ${prevDetected}→${closest.label} stable_was=${stableFramesRef.current} target=${curNote} rms=${rms.toFixed(4)} history=[${history.join(',')}]`);
          stableFramesRef.current = 0;
        }
        lastDetectedNoteRef.current = closest.label;
      }

      if (isListeningRef.current) setMatchState('listening');
    } else {
      // Signal lost — always log if we were building stability
      if (stableFramesRef.current > 0) {
        dbg.debug(`[lost] f=${frameN} rms=${rms.toFixed(4)} detected=${detected} stable_was=${stableFramesRef.current}`);
      }
      stableFramesRef.current = 0;
      lastDetectedNoteRef.current = null;
      debugHistoryRef.current = [];
      if (!answeredRef.current && isListeningRef.current) setMatchState('idle');
    }

    animFrameRef.current = requestAnimationFrame(processAudio);
  }, []);

  // Keep processAudio ref current (used by startListening)
  const processAudioRef = useRef(processAudio);
  processAudioRef.current = processAudio;

  // ---- Audio start / stop ----

  const startListening = useCallback(async () => {
    dbg.info('[mic] startListening called, requesting microphone...');
    setMicError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          ...(selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : {}),
        },
      });
      streamRef.current = stream;

      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);

      // High-pass filter: remove low-frequency rumble that masks treble notes.
      // 2nd-order BiquadFilter (Butterworth, Q=0.707, 12 dB/octave).
      const highPass = audioCtx.createBiquadFilter();
      highPass.type = 'highpass';
      highPass.frequency.value = HIGH_PASS_CUTOFF_HZ;
      highPass.Q.value = 0.707;
      highPassRef.current = highPass;

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = SMOOTHING_TIME_CONSTANT;
      source.connect(highPass);
      highPass.connect(analyser);
      analyserRef.current = analyser;

      setIsListening(true);
      setMatchState('idle');
      dbg.info('[mic] microphone acquired, sampleRate=' + audioCtx.sampleRate + 'Hz, starting RAF loop');
      animFrameRef.current = requestAnimationFrame(processAudioRef.current);

      // Refresh device list now that we have permission — labels become available
      enumerateDevices();
    } catch (err) {
      dbg.error('[mic] microphone error:', err);
      const message =
        err instanceof DOMException
          ? err.name === 'NotAllowedError'
            ? t('sightReading.micDenied')
            : err.name === 'NotFoundError'
              ? t('sightReading.micNotFound')
              : t('sightReading.micError')
          : t('sightReading.micError');
      setMicError(message);
    }
  }, [t, selectedDeviceId, enumerateDevices]);

  const stopListening = useCallback(() => {
    dbg.info('[mic] stopListening called');
    cancelAnimationFrame(animFrameRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    analyserRef.current = null;
    highPassRef.current = null;
    setIsListening(false);
    setDetectedNote(null);
    setDetectedFreq(null);
    setVolume(0);
    setMatchState('idle');
    stableFramesRef.current = 0;
    lastDetectedNoteRef.current = null;
    noiseFloorRef.current = 0.001;
    gateWasOpenRef.current = false;
  }, []);

  // ---- Answer handling ----

  const handleAnswer = useCallback(
    (correct: boolean, playedNote: string) => {
      dbg.info(`[answer] called — played=${playedNote} correct=${correct} currentNote=${currentNote} answered=${answered}`);
      if (!currentNote || answered) {
        dbg.debug(`[answer] BLOCKED — currentNote=${currentNote} answered=${answered}`);
        return;
      }

      if (autoAdvanceRef.current !== null) {
        window.clearTimeout(autoAdvanceRef.current);
        autoAdvanceRef.current = null;
      }

      // Record review in spaced-repetition system
      sr.recordReview(currentNote, correct);

      if (correct) {
        setAnswered(true);
        setIsCorrect(true);
        setSessionTotal((n) => n + 1);
        setSessionCorrect((n) => n + 1);
        setStreak((n) => n + 1);
        setMatchState('correct');

        // Play the tonic walk as feedback for correct answers (respect setting)
        if (playFeedback) {
          void playTonicWalk(playNote, currentNote, {
            startNoteDuration: NOTE_PLAY_DURATION,
            noteDuration: WALK_NOTE_DURATION,
          });
        }

        message.success(t('sightReading.correct'));

        // Auto-advance after correct answer
        const seqLen = buildTonicWalkSequence(currentNote).length;
        const playbackMs = playFeedback
          ? seqLen === 1
            ? NOTE_PLAY_DURATION * 1000 + 400
            : (NOTE_PLAY_DURATION * 1000 + WALK_GAP_MS) +
              (seqLen - 2) * (WALK_NOTE_DURATION * 1000 + WALK_GAP_MS) +
              WALK_NOTE_DURATION * 1000 +
              400
          : 400;

        autoAdvanceRef.current = window.setTimeout(() => {
          autoAdvanceRef.current = null;
          nextQuestion();
        }, playbackMs);
      } else {
        // Wrong answer: completely silent — no playback, no hint, no visual feedback
        setSessionTotal((n) => n + 1);
        setStreak(0);
        // Reset stability tracking to avoid immediate re-trigger after cooldown
        stableFramesRef.current = 0;
        lastDetectedNoteRef.current = null;
        // Set cooldown so user can try again
        wrongCooldownRef.current = performance.now() + WRONG_COOLDOWN_MS;
        // Don't set answered=true / matchState='wrong' — keeps the UI neutral
        return;
      }
    },
    [currentNote, answered, playNote, sr.recordReview, t, nextQuestion, playFeedback],
  );

  const handleAnswerRef = useRef(handleAnswer);
  handleAnswerRef.current = handleAnswer;
  const playFeedbackRef = useRef(playFeedback);
  playFeedbackRef.current = playFeedback;

  // ---- Skip (give up on current question) ----
  const handleSkip = useCallback(() => {
    if (!currentNote || answered) return;

    if (autoAdvanceRef.current !== null) {
      window.clearTimeout(autoAdvanceRef.current);
      autoAdvanceRef.current = null;
    }

    setAnswered(true);
    setIsCorrect(false);
    setSessionTotal((n) => n + 1);
    setStreak(0);
    setMatchState('wrong');

    // Record as wrong in spaced-repetition system
    sr.recordReview(currentNote, false);

    // Play the tonic walk as feedback so the user hears the correct note (respect setting)
    if (playFeedback) {
      void playTonicWalk(playNote, currentNote, {
        startNoteDuration: NOTE_PLAY_DURATION,
        noteDuration: WALK_NOTE_DURATION,
      });
    }

    // Show the correct note name
    message.error(`${t('sightReading.wrong')} ${currentNote}`);

    // Auto-advance after feedback playback
    const seqLen = buildTonicWalkSequence(currentNote).length;
    const playbackMs = playFeedback
      ? seqLen === 1
        ? NOTE_PLAY_DURATION * 1000 + 400
        : (NOTE_PLAY_DURATION * 1000 + WALK_GAP_MS) +
          (seqLen - 2) * (WALK_NOTE_DURATION * 1000 + WALK_GAP_MS) +
          WALK_NOTE_DURATION * 1000 +
          400
      : 400;

    autoAdvanceRef.current = window.setTimeout(() => {
      autoAdvanceRef.current = null;
      nextQuestion();
    }, playbackMs);
  }, [currentNote, answered, playNote, sr.recordReview, t, nextQuestion, playFeedback]);

  // ---- Handlers ----

  const replayCurrentNote = useCallback(() => {
    if (!currentNote) return;
    void playNote(currentNote, NOTE_PLAY_DURATION);
  }, [currentNote, playNote]);

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
        height: '100%',
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
              {t('sightReading.title')}
            </span>
          </Space>
        }
        extra={
          <Space size={4}>
            {currentNote && !(answered && isCorrect) && (
              <Button
                type="text"
                size="small"
                onClick={handleSkip}
              >
                {t('sightReading.skip')}
              </Button>
            )}
            <Button
              type="text"
              icon={<SettingOutlined />}
              onClick={() => setSettingsOpen(true)}
            />
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
              {t('sightReading.accuracy')}: {accuracy}%
            </Text>
          )}
          <Text type="secondary" style={{ fontSize: 13 }}>
            {t('sightReading.poolCount', { count: notePool.length })}
          </Text>
        </Space>

        {/* Mic permission hint */}
        {!isListening && !micError && (
          <Text
            type="secondary"
            style={{ fontSize: 12, marginBottom: 8, textAlign: 'center' }}
          >
            {t('sightReading.micHint')}
          </Text>
        )}
        {micError && (
          <Text
            type="danger"
            style={{ fontSize: 12, marginBottom: 8, textAlign: 'center' }}
          >
            {micError}
          </Text>
        )}

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
            border: `1px solid ${answered ? (isCorrect ? '#22c55e' : '#ef4444') : '#f0f0f0'}`,
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
            transition: 'border-color 0.3s',
          }}
        >
          <Text type="secondary" style={{ fontSize: 13, marginBottom: 4 }}>
            {t('sightReading.questionPrompt')}
          </Text>
          {currentNote && (
            <>
              <StaffDisplay
                notes={shiftOctave(currentNote, 1)}
                clef="treble"
                highlightNote={answered ? shiftOctave(currentNote, 1) : undefined}
                accentColor={isCorrect ? '#22c55e' : '#ef4444'}
                keySignature={keySignature !== 'C' ? keySignature : undefined}
                width={staffWidth}
                height={180}
              />
              {/* Show what the user played when wrong */}
              {answered && !isCorrect && detectedNote && (
                <Text
                  type="danger"
                  style={{ fontSize: 13, marginTop: 4 }}
                >
                  {t('sightReading.youPlayed')}: {detectedNote}
                </Text>
              )}
            </>
          )}
          <Space style={{ marginTop: 4 }}>
            <SoundOutlined style={{ color: '#9ca3af', fontSize: 14 }} />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('sightReading.clickToReplay')}
            </Text>
          </Space>
        </div>
      </Card>

      {/* ── Bottom: horizontal tuner-like dashboard ── */}
      <Dashboard
        isListening={isListening}
        detectedNote={detectedNote}
        detectedFreq={detectedFreq}
        targetNote={currentNote}
        keySignature={keySignature}
        volume={volume}
        matchState={matchState}
        onStart={startListening}
        onStop={stopListening}
        isDesktop={isDesktop}
      />

      {/* ── Settings drawer ── */}
      <Drawer
        title={t('sightReading.settings')}
        open={settingsOpen}
        onClose={handleSettingsClose}
        placement="right"
        width={isDesktop ? 320 : '100%'}
      >
        <Space direction="vertical" style={{ width: '100%' }} size={24}>
          {/* Fret range */}
          <div>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>
              {t('sightReading.fretRange')}
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
                placeholder={t('sightReading.from')}
              />
              <Text type="secondary">{t('sightReading.to')}</Text>
              <Select
                value={fretEnd}
                onChange={(v) => {
                  setFretEnd(v);
                  if (v < fretStart) setFretStart(Math.max(v - 5, 0));
                }}
                options={FRET_OPTIONS}
                style={{ width: 110 }}
                placeholder={t('sightReading.to')}
              />
            </Space>
            <Text
              type="secondary"
              style={{ display: 'block', marginTop: 8, fontSize: 12 }}
            >
              {t('sightReading.fretRangeHint', { count: notePool.length })}
            </Text>
          </div>

          {/* Key signature */}
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                marginBottom: 8,
              }}
            >
              <Text strong>{t('sightReading.keySignature')}</Text>
              <Select
                value={keySignature}
                onChange={setKeySignature}
                options={[...COMMON_MAJOR_KEYS].map((k) => ({
                  value: k,
                  label: k,
                }))}
                style={{ minWidth: 100 }}
                size="small"
              />
            </div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('sightReading.keySignatureDesc')}
            </Text>
          </div>

          {/* Play sound toggle */}
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                marginBottom: 8,
              }}
            >
              <Text strong>{t('sightReading.playSound')}</Text>
              <Switch checked={playSound} onChange={setPlaySound} />
            </div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('sightReading.playSoundDesc')}
            </Text>
          </div>

          {/* Play feedback toggle */}
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                marginBottom: 8,
              }}
            >
              <Text strong>{t('sightReading.playFeedback')}</Text>
              <Switch checked={playFeedback} onChange={setPlayFeedback} />
            </div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('sightReading.playFeedbackDesc')}
            </Text>
          </div>

          {/* Microphone gain */}
          <div>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>
              {t('sightReading.micGain')}
            </Text>
            <Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
              {t('sightReading.micGainDesc')}
            </Text>
            <Slider
              min={MIC_GAIN_MIN}
              max={MIC_GAIN_MAX}
              step={MIC_GAIN_STEP}
              value={micGain}
              onChange={setMicGain}
              tooltip={{
                formatter: (v) => `${v?.toFixed(1)}×`,
              }}
              marks={{
                [MIC_GAIN_MIN]: `${MIC_GAIN_MIN}×`,
                1.0: '1×',
                [MIC_GAIN_MAX]: `${MIC_GAIN_MAX}×`,
              }}
              style={{ marginBottom: 0 }}
            />
          </div>

          {/* Audio device selector */}
          <div>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>
              {t('sightReading.audioDevice')}
            </Text>
            <Select
              value={selectedDeviceId ?? ''}
              onChange={handleDeviceChange}
              style={{ width: '100%' }}
              disabled={isListening}
              options={[
                { value: '', label: t('sightReading.defaultDevice') },
                ...audioInputDevices.map((d) => ({
                  value: d.deviceId,
                  label:
                    d.label ||
                    `${t('sightReading.audioDevice')} (${d.deviceId.slice(0, 8)}…)`,
                })),
              ]}
              placeholder={
                audioInputDevices.length === 0
                  ? t('sightReading.noDevice')
                  : undefined
              }
            />
            {isListening && (
              <Text type="secondary" style={{ display: 'block', marginTop: 4, fontSize: 12 }}>
                {t('sightReading.deviceLockedHint')}
              </Text>
            )}
          </div>

          {/* Usage hint */}
          <div>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>
              {t('sightReading.howToUse')}
            </Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('sightReading.howToUseDesc')}
            </Text>
          </div>
        </Space>
      </Drawer>
    </div>
  );
}
