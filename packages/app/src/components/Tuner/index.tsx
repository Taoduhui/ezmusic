import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  Card,
  Select,
  Button,
  Typography,
  Space,
  Tag,
  Progress,
  theme,
} from 'antd';
import {
  AudioOutlined,
  AudioMutedOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

const { Title, Text } = Typography;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TunableNote {
  label: string;
  freq: number;
}

interface PitchTracePoint {
  id: number;
  hzDiff: number | null;
  status: 'active' | 'hold' | 'silent';
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// ---- Note & pitch reference ----
const A4_FREQ = 440;
const SEMITONE_RATIO = Math.pow(2, 1 / 12);
const C0_FREQ = A4_FREQ * Math.pow(SEMITONE_RATIO, -57); // C0 ≈ 16.35 Hz
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// ---- Tunable note range ----
const NOTE_START_OCTAVE = 2;
const NOTE_END_OCTAVE = 6;

// ---- Pitch detection ----
const MIN_RMS_THRESHOLD = 0.02;
const MIN_FREQ_HZ = 40;
const MAX_FREQ_HZ = 2000;

// ---- Audio processing ----
const BUFFER_SIZE = 4096;
const FFT_SIZE = 8192;
const SMOOTHING_TIME_CONSTANT = 0;
const VOLUME_SCALE = 5;

// ---- UI behaviour ----
const TRACE_LIMIT = 900; // 15s × 60fps
const HOLD_MS = 800;
const SMOOTH_WINDOW = 64;
const IN_TUNE_THRESHOLD_HZ = 1;
const CLOSE_THRESHOLD_HZ = 4;
const VOLUME_LOW_THRESHOLD = 0.1;
const VOLUME_MID_THRESHOLD = 0.3;

// ---- Adjacent note labels ----
const ADJ_NATURAL_COUNT = 3;

// ---- Meter layout ----
const METER_WIDTH = 320;
const METER_HEIGHT = 360;
const METER_CENTER_X = METER_WIDTH / 2;
const METER_HEAD_Y = 50;
const METER_TARGET_Y = 150;
const METER_TRACE_START_Y = 184;
const METER_BOTTOM_MARGIN = 18;
const METER_X_RANGE = 92; // max horizontal deflection from center, in SVG units
const METER_TRACE_HEIGHT = METER_HEIGHT - METER_BOTTOM_MARGIN - METER_TRACE_START_Y;
const METER_TRACE_STEP_Y = METER_TRACE_HEIGHT / TRACE_LIMIT;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function mapDiffToMeterX(hzDiff: number, diffRangeHz: number): number {
  const clamped = clamp(hzDiff, -diffRangeHz, diffRangeHz);
  return METER_CENTER_X + (clamped / diffRangeHz) * METER_X_RANGE;
}

function formatSignedHz(hzDiff: number): string {
  const rounded = parseFloat(hzDiff.toFixed(4));
  return `${rounded > 0 ? '+' : ''}${rounded}`;
}

/** Generate tunable notes from C2 to C6 */
function buildNoteOptions(): TunableNote[] {
  const notes: TunableNote[] = [];
  for (let octave = NOTE_START_OCTAVE; octave <= NOTE_END_OCTAVE; octave++) {
    for (let i = 0; i < 12; i++) {
      if (octave === NOTE_END_OCTAVE && i > 0) break; // stop at C of end octave
      const semitonesFromC0 = octave * 12 + i;
      const freq = parseFloat((C0_FREQ * Math.pow(SEMITONE_RATIO, semitonesFromC0)).toFixed(2));
      notes.push({ label: `${NOTE_NAMES[i]}${octave}`, freq });
    }
  }
  return notes;
}

const TUNABLE_NOTES = buildNoteOptions();

// ---------------------------------------------------------------------------
// Pitch detection via autocorrelation
// ---------------------------------------------------------------------------

/**
 * Detect fundamental frequency from a time-domain buffer using autocorrelation.
 * Returns the detected frequency in Hz, or null if no clear pitch is found.
 */
function detectPitch(buffer: Float32Array, sampleRate: number): number | null {
  const n = buffer.length;

  // Compute RMS to check signal level
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    sumSq += buffer[i] * buffer[i];
  }
  const rms = Math.sqrt(sumSq / n);
  // Threshold: signal too quiet → no pitch
  if (rms < MIN_RMS_THRESHOLD) return null;

  // Autocorrelation
  const maxLag = Math.min(n - 1, Math.floor(sampleRate / MIN_FREQ_HZ));
  const minLag = Math.max(1, Math.floor(sampleRate / MAX_FREQ_HZ));

  let bestLag = -1;
  let bestCorr = -Infinity;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    for (let i = 0; i < n - lag; i++) {
      corr += buffer[i] * buffer[i + lag];
    }
    // Normalize by the number of terms so longer lags aren't penalized
    corr /= n - lag;

    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  if (bestLag <= 0) return null;

  // Parabolic interpolation around the peak for better accuracy
  const lag = bestLag;
  if (lag > 0 && lag < n - 1) {
    const c0 = autocorrAt(buffer, lag);
    const cm = autocorrAt(buffer, lag - 1);
    const cp = autocorrAt(buffer, lag + 1);
    const delta = 0.5 * (cm - cp) / (cm - 2 * c0 + cp);
    if (Math.abs(delta) < 1) {
      const refinedLag = lag - delta;
      return sampleRate / refinedLag;
    }
  }

  return sampleRate / bestLag;
}

function autocorrAt(buffer: Float32Array, lag: number): number {
  let sum = 0;
  for (let i = 0; i < buffer.length - lag; i++) {
    sum += buffer[i] * buffer[i + lag];
  }
  return sum / (buffer.length - lag);
}

// ---------------------------------------------------------------------------
// Cents calculation
// ---------------------------------------------------------------------------

/** Calculate cents difference between detected and target frequency. */
function centsDiff(detected: number, target: number): number {
  return 1200 * Math.log2(detected / target);
}

// ---------------------------------------------------------------------------
// Closest note finder
// ---------------------------------------------------------------------------

function findClosestNote(freq: number): TunableNote {
  let best = TUNABLE_NOTES[0];
  let bestCents = Math.abs(centsDiff(freq, best.freq));
  for (const note of TUNABLE_NOTES) {
    const c = Math.abs(centsDiff(freq, note.freq));
    if (c < bestCents) {
      bestCents = c;
      best = note;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Tuner() {
  const { t } = useTranslation();
  const { token } = theme.useToken();

  const [isListening, setIsListening] = useState(false);
  const [targetNote, setTargetNote] = useState<string>('A4');
  const [detectedFreq, setDetectedFreq] = useState<number | null>(null);
  const [hzDiff, setHzDiff] = useState<number | null>(null);
  const [activeNote, setActiveNote] = useState<string | null>(null);
  const [tracePoints, setTracePoints] = useState<PitchTracePoint[]>([]);
  const [volume, setVolume] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | undefined>(undefined);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number>(0);
  const bufferRef = useRef<Float32Array<ArrayBuffer>>(
    new Float32Array(new ArrayBuffer(BUFFER_SIZE * Float32Array.BYTES_PER_ELEMENT)),
  );

  // ---- hold: keep last reading alive for a grace period when signal drops ----
  const lastGoodDetectedRef = useRef<number | null>(null);
  const lastGoodHzDiffRef = useRef<number | null>(null);
  const lastGoodActiveNoteRef = useRef<string | null>(null);
  const lastGoodVolumeRef = useRef<number>(0);
  const signalLostAtRef = useRef<number>(0);
  const traceIdRef = useRef(0);

  const targetFreq = useMemo(() => {
    const note = TUNABLE_NOTES.find((n) => n.label === targetNote);
    return note?.freq ?? A4_FREQ;
  }, [targetNote]);

  // Keep targetFreq in a ref so processAudio always reads the latest value,
  // even when an old callback is still on the rAF queue after a target switch.
  const targetFreqRef = useRef(targetFreq);
  targetFreqRef.current = targetFreq;

  // Smooth the Hz diff value to reduce jitter
  const hzHistoryRef = useRef<number[]>([]);

  const handleTargetChange = useCallback(
    (val: string) => {
      setTargetNote(val);
      // Synchronously update ref + clear history so queued rAF frames
      // never compute with a stale target frequency.
      const note = TUNABLE_NOTES.find((n) => n.label === val);
      if (note) {
        targetFreqRef.current = note.freq;
      }
      hzHistoryRef.current = [];
      lastGoodDetectedRef.current = null;
      lastGoodHzDiffRef.current = null;
      signalLostAtRef.current = 0;
      traceIdRef.current = 0;
      setTracePoints([]);
    },
    [],
  );

  const smoothHz = useCallback((rawDiff: number): number => {
    const history = hzHistoryRef.current;
    history.push(rawDiff);
    if (history.length > SMOOTH_WINDOW) history.shift();
    return history.reduce((a, b) => a + b, 0) / history.length;
  }, []);

  const flushUiState = useCallback(() => {
    const now = performance.now();

    const held = lastGoodDetectedRef.current;
    const diffHeld = lastGoodHzDiffRef.current;
    const activeNoteHeld = lastGoodActiveNoteRef.current;
    const vol = lastGoodVolumeRef.current;
    let nextDetected: number | null = null;
    let nextHzDiff: number | null = null;
    let nextActiveNote: string | null = null;
    let nextTraceStatus: PitchTracePoint['status'] = 'silent';

    // Check hold: if signal has been lost for < HOLD_MS, keep showing last value
    if (held === null || diffHeld === null) {
      // Never had a reading — still show volume
      nextDetected = null;
      nextHzDiff = null;
    } else if (signalLostAtRef.current === 0) {
      // Signal is alive: push latest
      nextDetected = held;
      nextHzDiff = diffHeld;
      nextActiveNote = activeNoteHeld;
      nextTraceStatus = 'active';
    } else if (now - signalLostAtRef.current < HOLD_MS) {
      // Within hold window: keep showing last known value
      nextDetected = held;
      nextHzDiff = diffHeld;
      nextActiveNote = activeNoteHeld;
      nextTraceStatus = 'hold';
    } else {
      // Hold expired
      lastGoodDetectedRef.current = null;
      lastGoodHzDiffRef.current = null;
    }

    setDetectedFreq(nextDetected);
    setHzDiff(nextHzDiff);
    setActiveNote(nextActiveNote);
    setVolume(vol);
    setTracePoints((prev) => {
      const nextPoint: PitchTracePoint = {
        id: traceIdRef.current++,
        hzDiff: nextHzDiff,
        status: nextTraceStatus,
      };
      return [...prev, nextPoint].slice(-TRACE_LIMIT);
    });
  }, []);

  const processAudio = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;

    const buffer = bufferRef.current;
    analyser.getFloatTimeDomainData(buffer);

    // Compute volume (RMS)
    let sumSq = 0;
    for (let i = 0; i < buffer.length; i++) {
      sumSq += buffer[i] * buffer[i];
    }
    const rms = Math.sqrt(sumSq / buffer.length);
    lastGoodVolumeRef.current = Math.min(1, rms * VOLUME_SCALE);

    const detected = detectPitch(buffer, analyser.context.sampleRate);
    if (detected !== null && detected >= MIN_FREQ_HZ && detected <= MAX_FREQ_HZ) {
      // Find the closest standard note and measure deviation from it,
      // so the meter always shows how in-tune the *actual* played note is.
      const closestNote = findClosestNote(detected);
      lastGoodDetectedRef.current = parseFloat(detected.toFixed(4));
      const rawDiff = detected - closestNote.freq;
      lastGoodHzDiffRef.current = parseFloat(smoothHz(rawDiff).toFixed(4));
      lastGoodActiveNoteRef.current = closestNote.label;
      signalLostAtRef.current = 0;
    } else {
      // Mark when signal was lost (only on first silent frame)
      if (signalLostAtRef.current === 0) {
        signalLostAtRef.current = performance.now();
      }
      hzHistoryRef.current = [];
    }

    flushUiState();
    animFrameRef.current = requestAnimationFrame(processAudio);
  }, [smoothHz, flushUiState]);

  // ---- Audio device enumeration ----

  const enumerateDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter((d) => d.kind === 'audioinput');
      setAudioInputDevices(inputs);
      // If the currently selected device is no longer available, fall back to default
      if (inputs.length > 0 && selectedDeviceId && !inputs.find((d) => d.deviceId === selectedDeviceId)) {
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

  const startListening = useCallback(async () => {
    setError(null);
    try {
      const constraints: MediaStreamConstraints = {
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          ...(selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : {}),
        },
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = SMOOTHING_TIME_CONSTANT;
      source.connect(analyser);
      // Don't connect to destination — we don't want feedback
      analyserRef.current = analyser;

      setIsListening(true);
      animFrameRef.current = requestAnimationFrame(processAudio);
    } catch (err) {
      const message =
        err instanceof DOMException
          ? err.name === 'NotAllowedError'
            ? t('tuner.micDenied')
            : err.name === 'NotFoundError'
              ? t('tuner.micNotFound')
              : t('tuner.micError')
          : t('tuner.micError');
      setError(message);
    }
  }, [processAudio, t, selectedDeviceId]);

  const stopListening = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    analyserRef.current = null;
    setIsListening(false);
    setDetectedFreq(null);
    setHzDiff(null);
    setActiveNote(null);
    setTracePoints([]);
    setVolume(0);
    hzHistoryRef.current = [];
    lastGoodDetectedRef.current = null;
    lastGoodHzDiffRef.current = null;
    lastGoodActiveNoteRef.current = null;
    lastGoodVolumeRef.current = 0;
    signalLostAtRef.current = 0;
    traceIdRef.current = 0;
  }, []);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animFrameRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      audioCtxRef.current?.close();
      lastGoodDetectedRef.current = null;
      lastGoodHzDiffRef.current = null;
      lastGoodActiveNoteRef.current = null;
      signalLostAtRef.current = 0;
    };
  }, []);

  // ---- Render helpers ----

  const tunerStatus = useMemo(() => {
    if (hzDiff === null) return 'idle';
    if (Math.abs(hzDiff) < IN_TUNE_THRESHOLD_HZ) return 'inTune';
    if (Math.abs(hzDiff) < CLOSE_THRESHOLD_HZ) return 'close';
    return 'off';
  }, [hzDiff]);

  const statusColor = useMemo(() => {
    switch (tunerStatus) {
      case 'inTune':
        return token.colorSuccess;
      case 'close':
        return token.colorWarning;
      case 'off':
        return token.colorError;
      default:
        return token.colorTextQuaternary;
    }
  }, [tunerStatus, token]);

  // The frequency of the auto-detected note (or target as fallback).
  // This is the reference point for the meter — deviation is measured
  // against the closest standard note to the played pitch.
  const activeNoteFreq = useMemo(() => {
    if (activeNote) {
      const note = TUNABLE_NOTES.find((n) => n.label === activeNote);
      if (note) return note.freq;
    }
    return targetFreq;
  }, [activeNote, targetFreq]);

  // Find adjacent natural notes on either side of the target note
  // (distance controlled by ADJ_NATURAL_COUNT).
  const { leftAdjLabel, rightAdjLabel, leftAdjFreq, rightAdjFreq } = useMemo(() => {
    const match = targetNote.match(/^([A-G]#?)(\d+)$/);
    if (!match) return { leftAdjLabel: '', rightAdjLabel: '', leftAdjFreq: 0, rightAdjFreq: 0 };
    const [, name, octStr] = match;
    const oct = Number(octStr);
    const idx = NOTE_NAMES.indexOf(name);
    if (idx < 0) return { leftAdjLabel: '', rightAdjLabel: '', leftAdjFreq: 0, rightAdjFreq: 0 };

    // Natural note indices in NOTE_NAMES: C=0, D=2, E=4, F=5, G=7, A=9, B=11
    const NATURAL_INDICES = new Set([0, 2, 4, 5, 7, 9, 11]);

    // Find lower adjacent natural (skip ADJ_NATURAL_COUNT naturals)
    let lowerOct = oct;
    let lowerIdx = idx;
    let naturalsFound = 0;
    while (naturalsFound < ADJ_NATURAL_COUNT) {
      lowerIdx--;
      if (lowerIdx < 0) { lowerIdx = 11; lowerOct--; }
      if (NATURAL_INDICES.has(lowerIdx)) naturalsFound++;
    }
    const leftLabel = `${NOTE_NAMES[lowerIdx]}${lowerOct}`;
    const leftSemitones = lowerOct * 12 + lowerIdx;
    const leftFreq = parseFloat((C0_FREQ * Math.pow(SEMITONE_RATIO, leftSemitones)).toFixed(2));

    // Find higher adjacent natural (skip ADJ_NATURAL_COUNT naturals)
    let higherOct = oct;
    let higherIdx = idx;
    naturalsFound = 0;
    while (naturalsFound < ADJ_NATURAL_COUNT) {
      higherIdx++;
      if (higherIdx > 11) { higherIdx = 0; higherOct++; }
      if (NATURAL_INDICES.has(higherIdx)) naturalsFound++;
    }
    const rightLabel = `${NOTE_NAMES[higherIdx]}${higherOct}`;
    const rightSemitones = higherOct * 12 + higherIdx;
    const rightFreq = parseFloat((C0_FREQ * Math.pow(SEMITONE_RATIO, rightSemitones)).toFixed(2));

    return {
      leftAdjLabel: leftLabel,
      rightAdjLabel: rightLabel,
      leftAdjFreq: leftFreq,
      rightAdjFreq: rightFreq,
    };
  }, [targetNote]);

  const diffRangeHz = useMemo(
    () => Math.max(targetFreq - leftAdjFreq, rightAdjFreq - targetFreq),
    [targetFreq, leftAdjFreq, rightAdjFreq],
  );

  const currentMeterX = useMemo(() => {
    if (hzDiff === null) return METER_CENTER_X;
    return mapDiffToMeterX(hzDiff, diffRangeHz);
  }, [hzDiff, diffRangeHz]);

  const currentDiffLabel = useMemo(() => {
    if (hzDiff === null) return null;
    return formatSignedHz(hzDiff);
  }, [hzDiff]);

  const traceSegments = useMemo(() => {
    const ordered = [...tracePoints].reverse();
    const segments: string[] = [];
    let currentSegment: string[] = [];

    ordered.forEach((point, index) => {
      if (point.hzDiff === null) {
        if (currentSegment.length > 1) {
          segments.push(currentSegment.join(' '));
        }
        currentSegment = [];
        return;
      }

      const x = mapDiffToMeterX(point.hzDiff, diffRangeHz);
      const y = METER_TRACE_START_Y + index * METER_TRACE_STEP_Y;
      if (y > METER_HEIGHT - METER_BOTTOM_MARGIN) {
        return;
      }

      if (currentSegment.length === 0) {
        currentSegment.push(`M ${x} ${y}`);
      } else {
        currentSegment.push(`L ${x} ${y}`);
      }
    });

    if (currentSegment.length > 1) {
      segments.push(currentSegment.join(' '));
    }

    return segments;
  }, [tracePoints, diffRangeHz]);

  const latestTracePoint = useMemo(() => {
    return tracePoints[tracePoints.length - 1] ?? null;
  }, [tracePoints]);

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: '24px 16px' }}>
      <Title level={3} style={{ textAlign: 'center', marginBottom: 8 }}>
        {t('tuner.title')}
      </Title>
      <Text
        type="secondary"
        style={{ display: 'block', textAlign: 'center', marginBottom: 24 }}
      >
        {t('tuner.hint')}
      </Text>

      {/* Audio device selector */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <Text strong>{t('tuner.audioDevice')}</Text>
          <Select
            value={selectedDeviceId ?? ''}
            onChange={handleDeviceChange}
            style={{ width: '100%' }}
            disabled={isListening}
            options={[
              { value: '', label: t('tuner.defaultDevice') },
              ...audioInputDevices.map((d) => ({
                value: d.deviceId,
                label: d.label || `${t('tuner.audioDevice')} (${d.deviceId.slice(0, 8)}…)`,
              })),
            ]}
            placeholder={audioInputDevices.length === 0 ? t('tuner.noDevice') : undefined}
          />
        </Space>
      </Card>

      {/* Target note selector */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <Text strong>{t('tuner.targetNote')}</Text>
          <Select
            value={targetNote}
            onChange={handleTargetChange}
            style={{ width: '100%' }}
            showSearch
            optionFilterProp="label"
            options={TUNABLE_NOTES.map((n) => ({
              value: n.label,
              label: `${n.label} (${n.freq} Hz)`,
            }))}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('tuner.targetFreq')}: {targetFreq} Hz
          </Text>
        </Space>
      </Card>

      {/* Tuning meter */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <div
          style={{
            borderRadius: 16,
            overflow: 'hidden',
            background:
              'radial-gradient(circle at top, rgba(27, 175, 116, 0.18), transparent 30%), linear-gradient(180deg, #20252b 0%, #171b20 100%)',
            border: '1px solid rgba(255,255,255,0.06)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
          }}
        >
          <svg
            viewBox={`0 0 ${METER_WIDTH} ${METER_HEIGHT}`}
            style={{ display: 'block', width: '100%', height: 360 }}
            role="img"
            aria-label={t('tuner.title')}
          >
            <defs>
              <pattern id="tuner-grid" width="18" height="18" patternUnits="userSpaceOnUse">
                <path d="M 18 0 L 0 0 0 18" fill="none" stroke="rgba(255,255,255,0.045)" strokeWidth="1" />
              </pattern>
              <linearGradient id="tuner-trace" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#68f0a5" stopOpacity="0.95" />
                <stop offset="100%" stopColor="#1daa78" stopOpacity="0.2" />
              </linearGradient>
            </defs>

            <rect x="0" y="0" width={METER_WIDTH} height={METER_HEIGHT} fill="url(#tuner-grid)" />

            <text x="20" y="34" fill="rgba(255,255,255,0.72)" fontSize="24" fontWeight="700">
              ♭
            </text>
            <text x={METER_WIDTH - 30} y="34" fill="rgba(255,255,255,0.72)" fontSize="24" fontWeight="700">
              ♯
            </text>

            <line
              x1={METER_CENTER_X}
              x2={METER_CENTER_X}
              y1="12"
              y2={METER_HEIGHT - 12}
              stroke="rgba(40, 226, 143, 0.9)"
              strokeWidth="2"
            />

            {traceSegments.map((segment, index) => (
              <path
                key={index}
                d={segment}
                fill="none"
                stroke="url(#tuner-trace)"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}

            {hzDiff !== null && currentDiffLabel !== null && (
              <>
                <line
                  x1={currentMeterX}
                  x2={METER_CENTER_X}
                  y1={METER_HEAD_Y + 22}
                  y2={METER_TARGET_Y - 34}
                  stroke="rgba(104, 240, 165, 0.95)"
                  strokeWidth="2"
                />
                <circle
                  cx={currentMeterX}
                  cy={METER_HEAD_Y}
                  r="23"
                  fill="#26322d"
                  stroke={statusColor}
                  strokeWidth="3"
                />
                <text
                  x={currentMeterX}
                  y={METER_HEAD_Y + 7}
                  textAnchor="middle"
                  fill="#f5fffa"
                  fontSize="20"
                  fontWeight="700"
                >
                  {currentDiffLabel}
                </text>
              </>
            )}

            <circle
              cx={METER_CENTER_X}
              cy={METER_TARGET_Y}
              r="31"
              fill="#1f242a"
              stroke="rgba(255,255,255,0.08)"
              strokeWidth="3"
            />
            <text
              x={METER_CENTER_X}
              y={METER_TARGET_Y + 10}
              textAnchor="middle"
              fill="#31d992"
              fontSize="28"
              fontWeight="500"
            >
              {activeNote ?? targetNote}
            </text>

            {latestTracePoint?.status === 'hold' && (
              <text
                x={METER_CENTER_X}
                y={METER_HEIGHT - 14}
                textAnchor="middle"
                fill="rgba(255,255,255,0.52)"
                fontSize="11"
              >
                HOLD
              </text>
            )}
          </svg>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {leftAdjLabel}
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {targetNote}
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {rightAdjLabel}
          </Text>
        </div>

        <div style={{ textAlign: 'center', marginTop: 12 }}>
          {hzDiff !== null ? (
            <Text
              strong
              style={{
                fontSize: 32,
                color: statusColor,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {hzDiff > 0 ? '+' : ''}
              {hzDiff} Hz
            </Text>
          ) : (
            <Text type="secondary" style={{ fontSize: 18 }}>
              {isListening ? t('tuner.listening') : t('tuner.notListening')}
            </Text>
          )}
        </div>
      </Card>

      {/* Detection info */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <div
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <Text type="secondary">{t('tuner.detectedFreq')}</Text>
            <Text strong style={{ fontVariantNumeric: 'tabular-nums' }}>
              {detectedFreq !== null ? `${detectedFreq} Hz` : '—'}
            </Text>
          </div>
          <div
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <Text type="secondary">{t('tuner.closestNote')}</Text>
            <Text strong>
              {activeNote ? `${activeNote} (${activeNoteFreq} Hz)` : '—'}
            </Text>
          </div>
          <div
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <Text type="secondary">{t('tuner.status')}</Text>
            <Tag color={tunerStatus === 'inTune' ? 'success' : tunerStatus === 'close' ? 'warning' : tunerStatus === 'off' ? 'error' : 'default'}>
              {tunerStatus === 'inTune'
                ? t('tuner.inTune')
                : tunerStatus === 'close'
                  ? t('tuner.close')
                  : tunerStatus === 'off'
                    ? t('tuner.off')
                    : '—'}
            </Tag>
          </div>
          <div style={{ marginTop: 4 }}>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
              {t('tuner.inputLevel')}
            </Text>
            <Progress
              percent={Math.round(volume * 100)}
              size="small"
              showInfo={false}
              strokeColor={
                volume < VOLUME_LOW_THRESHOLD
                  ? token.colorError
                  : volume < VOLUME_MID_THRESHOLD
                    ? token.colorWarning
                    : token.colorSuccess
              }
            />
          </div>
        </Space>
      </Card>

      {/* Start/Stop + error */}
      <div style={{ textAlign: 'center' }}>
        <Button
          type={isListening ? 'default' : 'primary'}
          danger={isListening}
          icon={isListening ? <AudioMutedOutlined /> : <AudioOutlined />}
          size="large"
          onClick={isListening ? stopListening : startListening}
        >
          {isListening ? t('tuner.stop') : t('tuner.start')}
        </Button>
        {error && (
          <Text type="danger" style={{ display: 'block', marginTop: 12 }}>
            {error}
          </Text>
        )}
      </div>
    </div>
  );
}
