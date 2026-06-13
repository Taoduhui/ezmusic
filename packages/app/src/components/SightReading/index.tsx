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
  Button, Typography, Drawer, Select, Space, Grid, message, Card, Switch, Progress,
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
} from '@ezmusic/shared';
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

const STORAGE_KEY = 'ezmusic-sight-reading-settings';

const NOTE_PLAY_DURATION = 0.8;
const WALK_NOTE_DURATION = 0.4;
const WALK_GAP_MS = 75;

// ---------------------------------------------------------------------------
// Constants — pitch detection
// ---------------------------------------------------------------------------

const A4_FREQ = 440;
const SEMITONE_RATIO = Math.pow(2, 1 / 12);
const C0_FREQ = A4_FREQ * Math.pow(SEMITONE_RATIO, -57);

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Build tunable note references from C1 to C6. */
function buildTunableNotes(): { label: string; freq: number }[] {
  const notes: { label: string; freq: number }[] = [];
  for (let octave = 1; octave <= 6; octave++) {
    for (let i = 0; i < 12; i++) {
      if (octave === 6 && i > 0) break;
      const semitonesFromC0 = octave * 12 + i;
      const freq = parseFloat(
        (C0_FREQ * Math.pow(SEMITONE_RATIO, semitonesFromC0)).toFixed(2),
      );
      notes.push({ label: `${NOTE_NAMES[i]}${octave}`, freq });
    }
  }
  return notes;
}

const TUNABLE_NOTES = buildTunableNotes();

// ---- YIN pitch detection ----

const YIN_THRESHOLD = 0.15;
/** Hard minimum — signal must be at least this strong regardless of noise floor. */
const RMS_GATE_MIN = 0.01;
/** Signal must exceed noiseFloor × this to open the gate. */
const NOISE_MULTIPLIER = 3;
/** Noise-floor tracking: slow-rise time constant (per sample, ~2 s at 60 fps). */
const NOISE_ATTACK_COEFF = 0.008;
/** Noise-floor tracking: fast-fall time constant (~0.3 s at 60 fps). */
const NOISE_RELEASE_COEFF = 0.05;
const MIN_FREQ_HZ = 40;
const MAX_FREQ_HZ = 2000;

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
// Helpers — pitch detection
// ---------------------------------------------------------------------------

/** YIN pitch detection. Returns frequency in Hz or null.
 *  NOTE: RMS gating is handled by the caller (hysteresis gate in processAudio). */
function detectPitch(buffer: Float32Array, sampleRate: number): number | null {
  const n = buffer.length;

  const maxLag = Math.min(n - 1, Math.floor(sampleRate / MIN_FREQ_HZ));
  const minLag = Math.max(1, Math.floor(sampleRate / MAX_FREQ_HZ));

  // Step 1: squared difference function
  const diff = new Float32Array(maxLag + 1);
  for (let tau = 0; tau <= maxLag; tau++) {
    let sum = 0;
    for (let j = 0; j < n - tau; j++) {
      const d = buffer[j] - buffer[j + tau];
      sum += d * d;
    }
    diff[tau] = sum;
  }

  // Step 2: cumulative-mean-normalised difference
  const cmnd = new Float32Array(maxLag + 1);
  cmnd[0] = 1;
  let cumSum = 0;
  for (let tau = 1; tau <= maxLag; tau++) {
    cumSum += diff[tau];
    cmnd[tau] = cumSum > 0 ? (diff[tau] * tau) / cumSum : 0;
  }

  // Step 3: absolute threshold — first deep dip
  let tauEstimate = -1;
  for (let tau = minLag; tau <= maxLag; tau++) {
    if (cmnd[tau] < YIN_THRESHOLD) {
      const halfWindow = Math.max(1, Math.floor(tau * 0.04));
      const lo = Math.max(minLag, tau - halfWindow);
      const hi = Math.min(maxLag, tau + halfWindow);
      let isLocalMin = true;
      for (let k = lo; k <= hi; k++) {
        if (cmnd[k] < cmnd[tau]) { isLocalMin = false; break; }
      }
      if (isLocalMin) { tauEstimate = tau; break; }
    }
  }

  // Fallback: global minimum of cmnd
  if (tauEstimate < 0) {
    let bestVal = Infinity;
    for (let tau = minLag; tau <= maxLag; tau++) {
      if (cmnd[tau] < bestVal) { bestVal = cmnd[tau]; tauEstimate = tau; }
    }
  }

  if (tauEstimate <= 0) return null;

  // Step 4: parabolic interpolation
  if (tauEstimate > minLag && tauEstimate < maxLag) {
    const y0 = cmnd[tauEstimate];
    const ym = cmnd[tauEstimate - 1];
    const yp = cmnd[tauEstimate + 1];
    const denom = ym - 2 * y0 + yp;
    if (denom > 0) {
      const delta = 0.5 * (ym - yp) / denom;
      if (Math.abs(delta) < 1) {
        return sampleRate / (tauEstimate + delta);
      }
    }
  }

  return sampleRate / tauEstimate;
}

/** Find the closest standard note to a given frequency. */
function findClosestNote(freq: number): { label: string; freq: number } {
  let best = TUNABLE_NOTES[0];
  let bestCents = Math.abs(1200 * Math.log2(freq / best.freq));
  for (const note of TUNABLE_NOTES) {
    const c = Math.abs(1200 * Math.log2(freq / note.freq));
    if (c < bestCents) { bestCents = c; best = note; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

interface SightReadingSettings {
  fretStart: number;
  fretEnd: number;
  playSound: boolean;
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
        playSound: parsed.playSound ?? true,
        selectedDeviceId: parsed.selectedDeviceId ?? undefined,
      };
    }
  } catch { /* ignore corrupt data */ }
  return { fretStart: DEFAULT_FRET_START, fretEnd: DEFAULT_FRET_END, playSound: true, selectedDeviceId: undefined };
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
  const targetFreq = useMemo(() => {
    if (!targetNote) return null;
    const note = TUNABLE_NOTES.find((n) => n.label === targetNote);
    return note?.freq ?? null;
  }, [targetNote]);

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
  const [playSound, setPlaySound] = useState(persisted.playSound);

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

  // Stability tracking
  const stableFramesRef = useRef(0);
  const lastDetectedNoteRef = useRef<string | null>(null);
  const wrongCooldownRef = useRef(0);

  // ---- Derived ----
  /** The note pool derived from the fretboard within the configured fret range. */
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
    console.log(`[SR:question] new target=${note} pool=${notePool.length}notes playSound=${playSound}`);

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
    saveSettings({ fretStart, fretEnd, playSound, selectedDeviceId });
  }, [fretStart, fretEnd, playSound, selectedDeviceId]);

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

  // Debug: track recent detection history to diagnose flickering
  const debugFrameRef = useRef(0);
  const debugHistoryRef = useRef<string[]>([]); // last 20 detection results

  // Adaptive noise floor — tracks ambient noise level, rising slowly & falling quickly
  const noiseFloorRef = useRef(0.001);

  const processAudio = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;

    const buffer = bufferRef.current;
    analyser.getFloatTimeDomainData(buffer);

    // Compute volume (RMS)
    let sumSq = 0;
    for (let i = 0; i < buffer.length; i++) sumSq += buffer[i] * buffer[i];
    const rms = Math.sqrt(sumSq / buffer.length);
    setVolume(Math.min(1, rms * VOLUME_SCALE));

    // ── Adaptive noise gate ──
    // Noise floor tracks ambient level: slow to rise, fast to fall.
    // This prevents brief loud notes from inflating the floor permanently
    // while quickly re-adapting when the environment gets quieter.
    const prevNoiseFloor = noiseFloorRef.current;
    if (rms > prevNoiseFloor) {
      noiseFloorRef.current += (rms - prevNoiseFloor) * NOISE_ATTACK_COEFF;
    } else {
      noiseFloorRef.current += (rms - prevNoiseFloor) * NOISE_RELEASE_COEFF;
    }
    // Clamp noise floor to a sane minimum so it can't go to zero
    if (noiseFloorRef.current < 0.0005) noiseFloorRef.current = 0.0005;

    const threshold = Math.max(RMS_GATE_MIN, noiseFloorRef.current * NOISE_MULTIPLIER);
    const gateOpen = rms >= threshold;
    const frameN = debugFrameRef.current++;

    // Periodic diagnostic
    if (frameN % 60 === 0) {
      console.log(`[SR:gate] f=${frameN} rms=${rms.toFixed(4)} noiseFloor=${noiseFloorRef.current.toFixed(4)} threshold=${threshold.toFixed(4)} open=${gateOpen}`);
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

    const detected = detectPitch(buffer, analyser.context.sampleRate);

    if (detected !== null && detected >= MIN_FREQ_HZ && detected <= MAX_FREQ_HZ) {
      const closest = findClosestNote(detected);
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
            console.log(`[SR:stable] f=${frameN} note=${closest.label} target=${curNote} stable=${stableFramesRef.current}/${STABILITY_FRAMES} match=${closest.label === curNote} rms=${rms.toFixed(4)} freq=${detected.toFixed(1)}`);
          }
          if (stableFramesRef.current >= STABILITY_FRAMES) {
            const correct = closest.label === curNote;
            console.log(`[SR:SUBMIT] f=${frameN} detected=${closest.label} target=${curNote} correct=${correct} history=[${history.join(',')}]`);
            handleAnswerRef.current(correct, closest.label);
          }
        } else {
          // Note changed — log the flicker event with history
          console.log(`[SR:flicker] f=${frameN} ${prevDetected}→${closest.label} stable_was=${stableFramesRef.current} target=${curNote} rms=${rms.toFixed(4)} history=[${history.join(',')}]`);
          stableFramesRef.current = 0;
        }
        lastDetectedNoteRef.current = closest.label;
      }

      if (isListeningRef.current) setMatchState('listening');
    } else {
      // Signal lost — always log if we were building stability
      if (stableFramesRef.current > 0) {
        console.log(`[SR:lost] f=${frameN} rms=${rms.toFixed(4)} detected=${detected} stable_was=${stableFramesRef.current}`);
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
    console.log('[SR:mic] startListening called, requesting microphone...');
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
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = SMOOTHING_TIME_CONSTANT;
      source.connect(analyser);
      analyserRef.current = analyser;

      setIsListening(true);
      setMatchState('idle');
      console.log('[SR:mic] microphone acquired, sampleRate=' + audioCtx.sampleRate + 'Hz, starting RAF loop');
      animFrameRef.current = requestAnimationFrame(processAudioRef.current);

      // Refresh device list now that we have permission — labels become available
      enumerateDevices();
    } catch (err) {
      console.error('[SR:mic] microphone error:', err);
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
    console.log('[SR:mic] stopListening called');
    cancelAnimationFrame(animFrameRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    analyserRef.current = null;
    setIsListening(false);
    setDetectedNote(null);
    setDetectedFreq(null);
    setVolume(0);
    setMatchState('idle');
    stableFramesRef.current = 0;
    lastDetectedNoteRef.current = null;
    noiseFloorRef.current = 0.001;
  }, []);

  // ---- Answer handling ----

  const handleAnswer = useCallback(
    (correct: boolean, playedNote: string) => {
      console.log(`[SR:answer] called — played=${playedNote} correct=${correct} currentNote=${currentNote} answered=${answered}`);
      if (!currentNote || answered) {
        console.log(`[SR:answer] BLOCKED — currentNote=${currentNote} answered=${answered}`);
        return;
      }

      if (autoAdvanceRef.current !== null) {
        window.clearTimeout(autoAdvanceRef.current);
        autoAdvanceRef.current = null;
      }

      setAnswered(true);
      setIsCorrect(correct);
      setSessionTotal((n) => n + 1);

      // Record review in spaced-repetition system
      sr.recordReview(currentNote, correct);

      // Always play the tonic walk as feedback
      void playTonicWalk(playNote, currentNote, {
        startNoteDuration: NOTE_PLAY_DURATION,
        noteDuration: WALK_NOTE_DURATION,
      });

      if (correct) {
        setSessionCorrect((n) => n + 1);
        setStreak((n) => n + 1);
        setMatchState('correct');
        message.success(t('sightReading.correct'));
      } else {
        setStreak(0);
        setMatchState('wrong');
        message.error(`${t('sightReading.wrong')} ${currentNote}`);
        // Set cooldown so user can try again
        wrongCooldownRef.current = performance.now() + WRONG_COOLDOWN_MS;
        // Reset answer state after cooldown so user can retry
        setTimeout(() => {
          setAnswered(false);
          setMatchState('idle');
          stableFramesRef.current = 0;
          lastDetectedNoteRef.current = null;
        }, WRONG_COOLDOWN_MS);
        return; // Don't auto-advance on wrong answer
      }

      // Auto-advance after correct answer
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

  // Keep handleAnswer ref current (used by processAudio's RAF loop)
  const handleAnswerRef = useRef(handleAnswer);
  handleAnswerRef.current = handleAnswer;

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
              {t('sightReading.title')}
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
