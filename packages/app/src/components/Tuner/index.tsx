import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  Card,
  Select,
  Button,
  Text,
  Space,
  Tag,
  Progress,
  theme,
  useBreakpoint,
  AudioOutlined,
  AudioMutedOutlined,
  ChevronLeftIcon,
} from '@ezmusic/shared';
import { useTranslation } from 'react-i18next';
import { triggerOpenDrawer, detectPitchYIN, buildTunableNotes, findClosestNote, centsDiff, DEFAULT_MIN_FREQ_HZ, DEFAULT_MAX_FREQ_HZ, YIN_THRESHOLD, A4_FREQ, NOTE_NAMES, SEMITONE_RATIO, C0_FREQ, DBG, createDebugLogger } from '@ezmusic/shared';
import type { TunableNote, YinOptions } from '@ezmusic/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PitchTracePoint {
  id: number;
  hzDiff: number | null;
  status: 'active' | 'hold' | 'silent';
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// ---- Tunable note range ----
const NOTE_START_OCTAVE = 2;
const NOTE_END_OCTAVE = 6;

// ---- Pitch detection ----
// Reduced from 0.02 to 0.005: with the 180 Hz high‑pass filter removing
// low‑frequency noise, the remaining (periodic) signal is quieter but
// much cleaner — YIN needs less RMS to find a good CMND dip.
const MIN_RMS_THRESHOLD = 0.005;

// ---- High-pass filter to remove low-frequency rumble that masks treble notes ----
// Cutoff at 180 Hz: attenuates subsonic/bass noise while preserving C2 (~65 Hz)
// enough for detection given the user reports bass input is already very high.
// 2nd-order BiquadFilter with 12 dB/octave roll-off.
const HIGH_PASS_CUTOFF_HZ = 180;
/** When a target note is selected, restrict the YIN lag search to ±0.5 octave
 *  (≈ ±6 semitones) around the target.  This mechanically excludes the octave
 *  below (2× period) and above (½× period) — the most common YIN octave
 *  errors — while still allowing up to 6 semitones of detuning, which is
 *  more than enough for any practical tuning scenario. */
const TARGET_RANGE_OCTAVES = 0.5;

// ---- diagnostic logging (module-level throttle) ----
const dbgDetect = createDebugLogger('Tuner:detect');
const dbg = createDebugLogger('Tuner');
let detectLogCounter = 0;
const DETECT_LOG_EVERY_N = 30;

// ---- Audio processing ----
const BUFFER_SIZE = 4096;
const FFT_SIZE = 8192;
const SMOOTHING_TIME_CONSTANT = 0;
const VOLUME_SCALE = 5;

// ---- Spectrum analysis (frequency band energy for diagnostics) ----
// getFloatFrequencyData fills fftSize elements, but only the first fftSize/2
// (0 … Nyquist) hold unique magnitude data; the upper half is the FFT mirror.
// Bin width: sampleRate / fftSize Hz.  At 44100/8192 ≈ 5.38 Hz/bin.
// Bass:   bins covering   0 –  250 Hz  → indices  0 – 46
// Mid:    bins covering 250 – 1000 Hz  → indices 47 – 185
// High:   bins covering 1000 – Nyquist → indices 186 – fftSize/2
const SPECTRUM_BASS_END_HZ = 250;
const SPECTRUM_MID_END_HZ = 1000;

// ---- high-note diagnostic threshold ----
// Log more aggressively when the target note is at or above this octave.
const HIGH_NOTE_DIAG_OCTAVE = 5; // C5 and above trigger per-frame diagnostics
const HIGH_NOTE_DIAG_LOG_INTERVAL = 5; // log every N frames for high notes (lower = more frequent)

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

const TUNABLE_NOTES = buildTunableNotes(NOTE_START_OCTAVE, NOTE_END_OCTAVE);

// ---------------------------------------------------------------------------
// Pitch detection — thin wrapper around shared YIN algorithm
// ---------------------------------------------------------------------------
// The heavy lifting (difference function, CMND, interpolation, fundamental
// verification) lives in @ezmusic/shared → detectPitchYIN.  This wrapper
// adds the Tuner‑specific RMS gate and diagnostic logging.
// ---------------------------------------------------------------------------

/**
 * Detect pitch with Tuner‑specific RMS gating and diagnostics.
 * Delegates the YIN algorithm to {@link detectPitchYIN}.
 */
function detectPitch(
  buffer: Float32Array,
  sampleRate: number,
  searchMinLag?: number,
  searchMaxLag?: number,
): number | null {
  const n = buffer.length;

  // ---- RMS gate (Tuner‑specific threshold) --------------------------------
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    sumSq += buffer[i] * buffer[i];
  }
  const rms = Math.sqrt(sumSq / n);
  if (rms < MIN_RMS_THRESHOLD) {
    detectLogCounter++;
    if (detectLogCounter % DETECT_LOG_EVERY_N === 0) {
      dbgDetect.debug(
        '%c🔇 RMS gate: %s < %s — returning null',
        'color:#ff6b6b',
        rms.toFixed(6),
        MIN_RMS_THRESHOLD.toString(),
      );
    }
    return null;
  }

  // ---- delegate to shared YIN --------------------------------------------
  const yinOpts: YinOptions = {
    yinThreshold: YIN_THRESHOLD,
    searchMinLag,
    searchMaxLag,
  };
  const result = detectPitchYIN(buffer, sampleRate, yinOpts);

  if (result === null) {
    // The shared function already handles the CMND quality gate internally.
    // Log a throttled note so the console shows when YIN rejects a frame
    // even after the RMS gate passed.
    detectLogCounter++;
    if (detectLogCounter % DETECT_LOG_EVERY_N === 0) {
      const expectedLag = Math.round(sampleRate / (searchMinLag != null
        ? sampleRate / ((searchMinLag + (searchMaxLag ?? searchMinLag)) / 2)
        : 440));
      dbgDetect.debug(
        '%c📉 YIN reject — RMS passed (%s ≥ %s) but CMND quality gate failed. searchLag=[%s,%s]',
        'color:#ff6b6b',
        rms.toFixed(5),
        MIN_RMS_THRESHOLD.toString(),
        searchMinLag ?? '-',
        searchMaxLag ?? '-',
      );
    }
    return null;
  }

  // ---- diagnostic logging (throttled) ------------------------------------
  detectLogCounter++;
  if (detectLogCounter % DETECT_LOG_EVERY_N === 0) {
    dbgDetect.debug(
      '%c🔍 YIN detectPitch #%d',
      'color:#f5a623;font-weight:bold',
      detectLogCounter,
    );
    dbgDetect.debug('  sampleRate:', sampleRate);
    dbgDetect.debug('  tau:', result.tau.toFixed(4));
    dbgDetect.debug('  cmnd at tau:', result.cmndValue.toFixed(6));
    dbgDetect.debug('  freq:', result.freq.toFixed(4), 'Hz');
  }

  return result.freq;
}

/**
 * Find the closest standard note to a detected frequency.
 * Wraps the shared {@link findClosestNote} with the Tuner's note list.
 */
function findClosestNoteForTuner(freq: number): TunableNote {
  return findClosestNote(freq, TUNABLE_NOTES);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Tuner() {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const screens = useBreakpoint();
  const isDesktop = !!screens.lg;

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
  const highPassRef = useRef<BiquadFilterNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number>(0);
  const bufferRef = useRef<Float32Array<ArrayBuffer>>(
    new Float32Array(new ArrayBuffer(BUFFER_SIZE * Float32Array.BYTES_PER_ELEMENT)),
  );
  // Frequency‑domain buffer for spectral diagnostics
  const freqDataRef = useRef<Float32Array<ArrayBuffer>>(
    new Float32Array(new ArrayBuffer(FFT_SIZE * Float32Array.BYTES_PER_ELEMENT)),
  );

  // ---- hold: keep last reading alive for a grace period when signal drops ----
  const lastGoodDetectedRef = useRef<number | null>(null);
  const lastGoodHzDiffRef = useRef<number | null>(null);
  const lastGoodActiveNoteRef = useRef<string | null>(null);
  const lastGoodVolumeRef = useRef<number>(0);
  const signalLostAtRef = useRef<number>(0);
  const traceIdRef = useRef(0);

  // ---- diagnostic logging ----
  const logCounterRef = useRef(0);
  const LOG_EVERY_N_FRAMES = 30; // log roughly every 0.5 s at 60 fps
  /** Burst-log the first N frames after each signal (re)onset to capture the
   *  exact frame-by-frame behaviour that causes visible trace jumps. */
  const BURST_LOG_FRAMES = 15;
  const burstLogRemainingRef = useRef(0);
  /** Snapshot of state at the start of a burst for context. */
  const burstSnapshotRef = useRef<{
    prevSmoothedDiff: number | null;
    historyLen: number;
    reason: string;
  } | null>(null);

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

  // Ref to keep targetNote label current in the rAF closure for diagnostic logs
  const targetNoteRef = useRef(targetNote);
  targetNoteRef.current = targetNote;

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

  const smoothHz = useCallback((rawDiff: number): { value: number; didReset: boolean; prevAvg: number | null } => {
    const history = hzHistoryRef.current;
    let didReset = false;
    let prevAvg: number | null = null;

    // Guard: if the new raw value is wildly different from the current
    // smoothed average, the history likely contains stale values from a
    // previous target-note selection.  Reset the history so the meter
    // converges immediately instead of drifting over many frames.
    if (history.length > 0) {
      prevAvg = history.reduce((a, b) => a + b, 0) / history.length;
      if (Math.abs(rawDiff - prevAvg) > 50) {
        history.length = 0;
        didReset = true;
      }
    }

    history.push(rawDiff);
    if (history.length > SMOOTH_WINDOW) history.shift();
    return { value: history.reduce((a, b) => a + b, 0) / history.length, didReset, prevAvg };
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
      // Hold expired — reset everything so the next note starts fresh
      lastGoodDetectedRef.current = null;
      lastGoodHzDiffRef.current = null;
      hzHistoryRef.current.length = 0;
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

    // Compute volume (RMS) and peak amplitude
    let sumSq = 0;
    let peakAbs = 0;
    for (let i = 0; i < buffer.length; i++) {
      const v = buffer[i];
      sumSq += v * v;
      const av = Math.abs(v);
      if (av > peakAbs) peakAbs = av;
    }
    const rms = Math.sqrt(sumSq / buffer.length);
    lastGoodVolumeRef.current = Math.min(1, rms * VOLUME_SCALE);

    // ---- spectral energy per band (for diagnostics) ----
    const freqData = freqDataRef.current;
    analyser.getFloatFrequencyData(freqData);
    // getFloatFrequencyData fills all fftSize bins, but only the first
    // fftSize/2 (0 … Nyquist) contain unique magnitude data.
    // Bin width: sampleRate / fftSize Hz.
    const nyquistBinCount = analyser.fftSize / 2;
    const binWidthHz = analyser.context.sampleRate / analyser.fftSize;
    const bassEndBin = Math.floor(SPECTRUM_BASS_END_HZ / binWidthHz);
    const midEndBin = Math.floor(SPECTRUM_MID_END_HZ / binWidthHz);
    // Convert dB to linear power per bin, then sum (first half only)
    let bassPowerLin = 0, midPowerLin = 0, highPowerLin = 0;
    for (let i = 0; i < nyquistBinCount; i++) {
      // freqData[i] is in dB (max 0 dBFS). Convert to linear power: 10^(dB/10)
      // Guard: -Infinity or very negative values → 0 power.
      const db = freqData[i];
      if (db < -120) continue; // noise floor, skip
      const lin = Math.pow(10, db / 10);
      if (i <= bassEndBin) bassPowerLin += lin;
      else if (i <= midEndBin) midPowerLin += lin;
      else highPowerLin += lin;
    }
    const totalBandPower = bassPowerLin + midPowerLin + highPowerLin;
    const bassRatio = totalBandPower > 0 ? bassPowerLin / totalBandPower : 0;
    const midRatio = totalBandPower > 0 ? midPowerLin / totalBandPower : 0;
    const highRatio = totalBandPower > 0 ? highPowerLin / totalBandPower : 0;

    // Constrain the YIN lag search to ±1 octave around the target note.
    // This mechanically excludes subharmonic periods (e.g. τ=443 for
    // 108 Hz when the target is E4 at 329.63 Hz) that cause the visible
    // "jump" during note attack.
    const sampleRate = analyser.context.sampleRate;
    const curTargetFreq = targetFreqRef.current;
    const rangeLowHz = curTargetFreq / (2 ** TARGET_RANGE_OCTAVES);
    const rangeHighHz = curTargetFreq * (2 ** TARGET_RANGE_OCTAVES);
    const searchMinLag = Math.max(1, Math.floor(sampleRate / rangeHighHz));
    const searchMaxLag = Math.min(buffer.length - 1, Math.ceil(sampleRate / rangeLowHz));

    const detected = detectPitch(buffer, sampleRate, searchMinLag, searchMaxLag);

    // ---- high‑note diagnostic: log on every detection miss for notes ≥ C5 ----
    const curTargetOctave = parseInt(targetNoteRef.current.match(/\d+$/)?.[0] ?? '0', 10);
    const isHighNote = curTargetOctave >= HIGH_NOTE_DIAG_OCTAVE;
    if (isHighNote) {
      logCounterRef.current++;
      if (detected === null || logCounterRef.current % HIGH_NOTE_DIAG_LOG_INTERVAL === 0) {
        const expectedLag = Math.round(sampleRate / curTargetFreq);
        dbg.group(
          `🔬 High-Note Diag #${logCounterRef.current} target=${targetNoteRef.current} (${curTargetFreq} Hz)`,
          detected === null ? 'color:#ff6b6b;font-weight:bold' : 'color:#68f0a5',
        );
        dbg.debug('RMS:', rms.toFixed(6), '| threshold:', MIN_RMS_THRESHOLD.toFixed(2), '| passes:', rms >= MIN_RMS_THRESHOLD);
        dbg.debug('peak:', peakAbs.toFixed(6), '| crest factor:', rms > 0 ? (peakAbs / rms).toFixed(2) : '∞');
        dbg.debug('volume (UI):', (rms * VOLUME_SCALE).toFixed(4));
        dbg.debug('band power — bass:', (bassRatio * 100).toFixed(1) + '%',
          'mid:', (midRatio * 100).toFixed(1) + '%',
          'high:', (highRatio * 100).toFixed(1) + '%');
        dbg.debug('searchMinLag:', searchMinLag, '| searchMaxLag:', searchMaxLag,
          '| expectedLag:', expectedLag,
          '| expectedFreq:', (sampleRate / expectedLag).toFixed(2), 'Hz');
        if (detected !== null) {
          dbg.debug('%cdetected: %c%s Hz',
            '', 'color:#f5a623;font-weight:bold', detected.toFixed(2));
        } else {
          dbg.debug('%c❌ detectPitch returned NULL — signal lost or pitch undetectable',
            'color:#ff6b6b;font-weight:bold');
        }
        dbg.groupEnd();
      }
    }

    if (detected !== null && detected >= DEFAULT_MIN_FREQ_HZ && detected <= DEFAULT_MAX_FREQ_HZ) {
      // Find the closest standard note for display, but measure
      // deviation from the *target* note so the meter and status
      // reflect how far the played pitch is from the intended note.
      const closestNote = findClosestNoteForTuner(detected);
      lastGoodDetectedRef.current = parseFloat(detected.toFixed(4));
      const rawDiff = detected - targetFreqRef.current;
      const smoothResult = smoothHz(rawDiff);
      lastGoodHzDiffRef.current = parseFloat(smoothResult.value.toFixed(4));
      lastGoodActiveNoteRef.current = closestNote.label;
      const wasSignalLost = signalLostAtRef.current !== 0;
      signalLostAtRef.current = 0;

      // ---- burst logging: capture EVERY frame for BURST_LOG_FRAMES after ----
      // ---- signal (re)onset or a smoothing reset, to see the exact trace  ----
      if (wasSignalLost || smoothResult.didReset) {
        burstLogRemainingRef.current = BURST_LOG_FRAMES;
        burstSnapshotRef.current = {
          prevSmoothedDiff: lastGoodHzDiffRef.current,
          historyLen: hzHistoryRef.current.length,
          reason: wasSignalLost ? 'signal onset' : 'smoothing reset',
        };
      }

      if (burstLogRemainingRef.current > 0) {
        burstLogRemainingRef.current--;
        const snap = burstSnapshotRef.current;
        dbg.group(
          `⚡ Burst #${BURST_LOG_FRAMES - burstLogRemainingRef.current}/${BURST_LOG_FRAMES}`,
          'color:#ff9f43;font-weight:bold',
          DBG.TRACE,
        );
        if (snap) {
          dbg.trace('trigger:', snap.reason);
        }
        dbg.trace('frame#:', logCounterRef.current + 1);
        dbg.trace('detectedFreq:', detected.toFixed(4), 'Hz');
        dbg.trace('rawDiff:', rawDiff.toFixed(4), 'Hz');
        dbg.trace('smoothResult:', smoothResult.value.toFixed(4), 'Hz');
        if (smoothResult.didReset) {
          dbg.trace(
            '%c⚠ RESET: rawDiff %.2f jumped from avg %.2f (delta=%.2f > 50)',
            'color:#ff6b6b;font-weight:bold',
            rawDiff,
            smoothResult.prevAvg ?? 0,
            Math.abs(rawDiff - (smoothResult.prevAvg ?? 0)),
          );
        }
        dbg.trace('smoothed history size:', hzHistoryRef.current.length);
        dbg.trace('closestNote:', closestNote.label);
        dbg.groupEnd();
      }

      // ---- diagnostic logging (throttled) ----
      logCounterRef.current++;
      if (logCounterRef.current % LOG_EVERY_N_FRAMES === 0) {
        const curTargetFreq = targetFreqRef.current;
        const diffFromTarget = detected - curTargetFreq;
        const centsFromClosest = centsDiff(detected, closestNote.freq);
        const centsFromTarget = centsDiff(detected, curTargetFreq);
        dbg.group(
          `🎵 Tuner Debug #${logCounterRef.current}`,
          'color:#68f0a5;font-weight:bold',
        );
        dbg.debug('sampleRate:', analyser.context.sampleRate, 'Hz');
        dbg.debug('buffer length:', buffer.length);
        dbg.debug('RMS:', rms.toFixed(4));
        dbg.debug(
          '%cdetectedFreq: %c%s Hz',
          '',
          'color:#f5a623;font-weight:bold',
          detected.toFixed(4),
        );
        dbg.debug('closestNote:', closestNote.label, `(${closestNote.freq} Hz)`);
        dbg.debug('rawDiff (detected - target):', rawDiff.toFixed(4), 'Hz');
        dbg.debug(
          'smoothedDiff:',
          lastGoodHzDiffRef.current?.toFixed(4),
          'Hz',
        );
        dbg.debug('targetNote:', targetNoteRef.current, `(${curTargetFreq} Hz)`);
        dbg.debug('diffFromTarget:', diffFromTarget.toFixed(4), 'Hz');
        dbg.debug(
          'centsFromClosest:',
          centsFromClosest.toFixed(2),
          'cents',
        );
        dbg.debug(
          'centsFromTarget:',
          centsFromTarget.toFixed(2),
          'cents',
        );
        dbg.debug('meterX (target):', mapDiffToMeterX(rawDiff, diffRangeHz).toFixed(1));
        // Also log what meterX would be if measured from target instead of closest
        const diffRangeHzAlt = Math.max(
          curTargetFreq - leftAdjFreq,
          rightAdjFreq - curTargetFreq,
        );
        dbg.debug(
          'meterX (if diff-from-target):',
          mapDiffToMeterX(diffFromTarget, diffRangeHzAlt).toFixed(1),
        );
        dbg.debug('diffRangeHz:', diffRangeHz.toFixed(2));
        dbg.debug(
          `leftAdj: ${leftAdjLabel}(${leftAdjFreq}Hz)  ` +
            `target: ${targetNoteRef.current}(${curTargetFreq}Hz)  ` +
            `rightAdj: ${rightAdjLabel}(${rightAdjFreq}Hz)`,
        );
        dbg.debug('smoothed history size:', hzHistoryRef.current.length);
        dbg.debug('volume:', volume.toFixed(3));
        dbg.groupEnd();
      }
    } else {
      // Mark when signal was lost (only on first silent frame).
      // Don't clear the smoothing history immediately — a brief gate
      // closure between notes shouldn't reset the meter's convergence.
      if (signalLostAtRef.current === 0) {
        signalLostAtRef.current = performance.now();
        // On first silent frame, emit a one‑shot diagnostic explaining why
        dbg.debug(
          '%c🔇 Signal lost — RMS: %s (threshold: %s), peak: %s, band power bass/mid/high: %s/%s/%s%',
          'color:#ff6b6b',
          rms.toFixed(6),
          MIN_RMS_THRESHOLD.toString(),
          peakAbs.toFixed(6),
          (bassRatio * 100).toFixed(0),
          (midRatio * 100).toFixed(0),
          (highRatio * 100).toFixed(0),
        );
      }
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

      // High‑pass filter: attenuates low‑frequency noise (room rumble,
      // handling noise, proximity effect) that masks treble fundamentals.
      // 2nd‑order BiquadFilter, 12 dB/octave roll‑off.
      const highPass = audioCtx.createBiquadFilter();
      highPass.type = 'highpass';
      highPass.frequency.value = HIGH_PASS_CUTOFF_HZ;
      highPass.Q.value = 0.707; // Butterworth — maximally flat passband
      highPassRef.current = highPass;

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = SMOOTHING_TIME_CONSTANT;
      source.connect(highPass);
      highPass.connect(analyser);
      // Don't connect to destination — we don't want feedback
      analyserRef.current = analyser;

      setIsListening(true);
      animFrameRef.current = requestAnimationFrame(processAudio);

      // Refresh device list now that we have permission — labels become available
      enumerateDevices();
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
  }, [processAudio, t, selectedDeviceId, enumerateDevices]);

  const stopListening = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    analyserRef.current = null;
    highPassRef.current = null;
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
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      <Card
        title={
          <Space>
            <Button
              type="text"
              icon={<ChevronLeftIcon />}
              onClick={() => triggerOpenDrawer()}
              aria-label={t('nav.back')}
            />
            <span style={{ fontWeight: 600 }}>{t('tuner.title')}</span>
          </Space>
        }
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          minHeight: 0,
        }}
        styles={{ body: { flex: 1, overflowY: 'auto', padding: '24px 16px' } }}
      >
        <div style={{ maxWidth: 480, margin: '0 auto' }}>
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
    </Card>
  </div>
  );
}
