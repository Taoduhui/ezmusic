// ---------------------------------------------------------------------------
// Pitch detection — YIN algorithm (de Cheveigné & Kawahara, 2002)
// ---------------------------------------------------------------------------
// YIN uses a squared difference function with cumulative-mean normalisation
// to avoid subharmonic / octave errors. It is more accurate than plain
// autocorrelation, especially for low frequencies where fewer waveform
// periods fit into the analysis buffer.
// ---------------------------------------------------------------------------

// ---- Note & pitch reference ----

/** Standard concert pitch (Hz). */
export const A4_FREQ = 440;
/** Ratio between adjacent semitones in equal temperament. */
export const SEMITONE_RATIO = Math.pow(2, 1 / 12);
/** Frequency of C0 (≈ 16.35 Hz), the reference point for octave numbering. */
export const C0_FREQ = A4_FREQ * Math.pow(SEMITONE_RATIO, -57);
/** Chromatic pitch class names (sharp form). */
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// ---- YIN defaults ----

/** Threshold for the cumulative-mean-normalised difference function.
 *  Lower values → stricter detection (may miss quiet / noisy notes).
 *  Typical range: 0.10 – 0.20. */
export const YIN_THRESHOLD = 0.15;

/** Default minimum detectable frequency (Hz). */
export const DEFAULT_MIN_FREQ_HZ = 40;
/** Default maximum detectable frequency (Hz). */
export const DEFAULT_MAX_FREQ_HZ = 2000;

// ---- Types ----

export interface TunableNote {
  label: string;
  freq: number;
}

export interface YinOptions {
  /**
   * Override the YIN CMND threshold for detecting a dip.
   * @default YIN_THRESHOLD (0.15)
   */
  yinThreshold?: number;
  /**
   * Restrict the lag search to lags ≥ this value (inclusive).
   * Useful for excluding subharmonic periods when a target pitch is known.
   */
  searchMinLag?: number;
  /**
   * Restrict the lag search to lags ≤ this value (inclusive).
   */
  searchMaxLag?: number;
  /**
   * Minimum frequency to consider (determines the full-range maxLag for
   * CMND normalisation). Does NOT constrain the search.
   * @default DEFAULT_MIN_FREQ_HZ (40)
   */
  minFreqHz?: number;
  /**
   * Maximum frequency to consider (determines the full-range minLag).
   * @default DEFAULT_MAX_FREQ_HZ (2000)
   */
  maxFreqHz?: number;
  /**
   * Enable diagnostic console logging for this call.
   * Logs CMND values, threshold scan details, and fallback decisions.
   * @default false
   */
  debug?: boolean;
}

export interface YinResult {
  /** Detected frequency in Hz. */
  freq: number;
  /** The lag (in samples) at which the CMND dip was found. */
  tau: number;
  /** The CMND value at the detected lag. */
  cmndValue: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Calculate the cents difference between two frequencies.
 * 100 cents = 1 semitone.
 */
export function centsDiff(detectedHz: number, targetHz: number): number {
  return 1200 * Math.log2(detectedHz / targetHz);
}

/** Generate tunable note references for the given octave range. */
export function buildTunableNotes(
  startOctave: number,
  endOctave: number,
): TunableNote[] {
  const notes: TunableNote[] = [];
  for (let octave = startOctave; octave <= endOctave; octave++) {
    for (let i = 0; i < 12; i++) {
      if (octave === endOctave && i > 0) break; // stop at C of end octave
      const semitonesFromC0 = octave * 12 + i;
      const freq = parseFloat(
        (C0_FREQ * Math.pow(SEMITONE_RATIO, semitonesFromC0)).toFixed(2),
      );
      notes.push({ label: `${NOTE_NAMES[i]}${octave}`, freq });
    }
  }
  return notes;
}

/**
 * Find the closest standard note to a detected frequency.
 * Returns the note whose frequency is nearest in cents.
 */
export function findClosestNote(
  freq: number,
  noteList: TunableNote[],
): TunableNote {
  let best = noteList[0];
  let bestCents = Math.abs(centsDiff(freq, best.freq));
  for (const note of noteList) {
    const c = Math.abs(centsDiff(freq, note.freq));
    if (c < bestCents) {
      bestCents = c;
      best = note;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Fundamental period verification
// ---------------------------------------------------------------------------

/**
 * Verify that the YIN period estimate is the true fundamental and not a
 * harmonic multiple (octave / subharmonic error).
 *
 * Uses a two-tier check on each submultiple (τ/2, τ/3, … down to minLag):
 *
 *   Tier 1 – CMND comparison:
 *     If cmnd[τ/n] < cmnd[τ], the shorter lag is a *strictly* better
 *     period under YIN's own metric. This catches cases where the
 *     fundamental is already well-formed.
 *
 *   Tier 2 – Autocorrelation rescue:
 *     During the attack phase of a note the fundamental's CMND may be
 *     temporarily elevated by transient energy, even though the waveform
 *     IS genuinely periodic at the shorter lag. When the CMND values are
 *     close (within 50 %) AND the shorter lag shows strong normalised
 *     autocorrelation (≥ 0.5), we still prefer the shorter period —
 *     this prevents the visible "jump" from subharmonic → fundamental
 *     as the note settles.
 */
export function verifyFundamentalPeriod(
  cmnd: Float32Array,
  buffer: Float32Array,
  tauEstimate: number,
  minLag: number,
  maxLag: number,
): number {
  let bestLag = tauEstimate;
  let bestCmnd = cmnd[tauEstimate];

  // Normalised autocorrelation r(τ) ∈ [-1, 1] — computed lazily per candidate.
  const autoCorrAt = (lag: number): number => {
    const n = buffer.length - lag;
    if (n <= 0) return 0;
    let sumProd = 0;
    let sumSq1 = 0;
    let sumSq2 = 0;
    for (let j = 0; j < n; j++) {
      sumProd += buffer[j] * buffer[j + lag];
      sumSq1 += buffer[j] * buffer[j];
      sumSq2 += buffer[j + lag] * buffer[j + lag];
    }
    const denom = Math.sqrt(sumSq1 * sumSq2);
    return denom > 1e-9 ? sumProd / denom : 0;
  };

  for (let divisor = 2; divisor <= 8; divisor++) {
    const candidateLag = Math.round(tauEstimate / divisor);
    if (candidateLag < minLag) break;
    if (candidateLag > maxLag) continue;

    const candidateCmnd = cmnd[candidateLag];

    // Tier 1 — strictly lower CMND ⇒ objectively better period.
    if (candidateCmnd < bestCmnd) {
      bestCmnd = candidateCmnd;
      bestLag = candidateLag;
      continue;
    }

    // Tier 2 — CMND is close AND the shorter lag shows strong autocorrelation.
    if (candidateCmnd < bestCmnd * 1.5) {
      const corr = autoCorrAt(candidateLag);
      if (corr > 0.5) {
        bestCmnd = candidateCmnd;
        bestLag = candidateLag;
      }
    }
  }

  return bestLag;
}

// ---------------------------------------------------------------------------
// YIN pitch detection
// ---------------------------------------------------------------------------

/**
 * Detect fundamental frequency from a time-domain buffer using the YIN
 * algorithm. Returns a {@link YinResult} on success, or `null` if no clear
 * pitch is found.
 *
 * **Important:** This function does NOT apply an RMS gate — that is the
 * caller's responsibility. If the signal is too quiet, the YIN algorithm
 * may return an unreliable result.
 *
 * @param buffer      Time-domain audio samples (typically Float32Array from
 *                    AnalyserNode.getFloatTimeDomainData).
 * @param sampleRate  Audio context sample rate (e.g. 44100).
 * @param options     Optional configuration overrides.
 */
export function detectPitchYIN(
  buffer: Float32Array,
  sampleRate: number,
  options?: YinOptions,
): YinResult | null {
  const n = buffer.length;
  const yinThreshold = options?.yinThreshold ?? YIN_THRESHOLD;
  const minFreqHz = options?.minFreqHz ?? DEFAULT_MIN_FREQ_HZ;
  const maxFreqHz = options?.maxFreqHz ?? DEFAULT_MAX_FREQ_HZ;
  const debug = options?.debug ?? false;

  // ---- full-range lag bounds (for CMND normalisation) --------------------
  const fullMinLag = Math.max(1, Math.floor(sampleRate / maxFreqHz));
  const fullMaxLag = Math.min(n - 1, Math.floor(sampleRate / minFreqHz));

  // ---- constrained lag bounds (for the actual pitch search) --------------
  const minLag = options?.searchMinLag != null
    ? Math.max(fullMinLag, options.searchMinLag)
    : fullMinLag;
  const maxLag = options?.searchMaxLag != null
    ? Math.min(fullMaxLag, options.searchMaxLag)
    : fullMaxLag;

  // ---- Step 1: squared difference function d(τ) --------------------------
  // Compute over the FULL range so CMND normalisation has enough history.
  // d(τ) = Σ (x_j – x_{j+τ})²
  const diff = new Float32Array(fullMaxLag + 1);
  for (let tau = 0; tau <= fullMaxLag; tau++) {
    let sum = 0;
    for (let j = 0; j < n - tau; j++) {
      const d = buffer[j] - buffer[j + tau];
      sum += d * d;
    }
    diff[tau] = sum;
  }

  // ---- Step 2: cumulative-mean-normalised difference d'(τ) ---------------
  // d'(0) = 1;  d'(τ) = d(τ) / ((1/τ) · Σ_{j=1}^{τ} d(j))
  const cmnd = new Float32Array(fullMaxLag + 1);
  cmnd[0] = 1;
  let cumSum = 0;
  for (let tau = 1; tau <= fullMaxLag; tau++) {
    cumSum += diff[tau];
    cmnd[tau] = cumSum > 0 ? (diff[tau] * tau) / cumSum : 0;
  }

  if (debug) {
    // Survey CMND stats within the search range
    let minCmnd = Infinity;
    let minTau = -1;
    let maxCmnd = -Infinity;
    let belowThreshold = 0;
    for (let tau = minLag; tau <= maxLag; tau++) {
      if (cmnd[tau] < minCmnd) { minCmnd = cmnd[tau]; minTau = tau; }
      if (cmnd[tau] > maxCmnd) maxCmnd = cmnd[tau];
      if (cmnd[tau] < yinThreshold) belowThreshold++;
    }
    // Log CMND at a few representative lags in the search range
    const midLag = Math.round((minLag + maxLag) / 2);
    const q1Lag = Math.round((minLag + midLag) / 2);
    const q3Lag = Math.round((midLag + maxLag) / 2);
    console.log(
      `[YIN:dbg] range lag=[${minLag}..${maxLag}] (${(sampleRate/maxLag).toFixed(0)}–${(sampleRate/minLag).toFixed(0)}Hz) ` +
      `cmndStats min=${minCmnd.toFixed(4)}@τ=${minTau} max=${maxCmnd.toFixed(4)} belowThresh=${belowThreshold}/${maxLag - minLag + 1} ` +
      `cmnd@lag[${minLag} ${q1Lag} ${midLag} ${q3Lag} ${maxLag}]=` +
      `[${cmnd[minLag].toFixed(3)} ${cmnd[q1Lag].toFixed(3)} ${cmnd[midLag].toFixed(3)} ${cmnd[q3Lag].toFixed(3)} ${cmnd[maxLag].toFixed(3)}]`,
    );
  }

  // ---- Step 3: absolute threshold – first deep dip -----------------------
  // Search only within the constrained lag range so subharmonic periods
  // (2×, 3× the true period) are mechanically excluded.
  let tauEstimate = -1;

  for (let tau = minLag; tau <= maxLag; tau++) {
    if (cmnd[tau] < yinThreshold) {
      // Verify this is a local minimum in a small neighbourhood
      // so we don't latch onto a transient downward slope.
      const halfWindow = Math.max(1, Math.floor(tau * 0.04));
      const lo = Math.max(minLag, tau - halfWindow);
      const hi = Math.min(maxLag, tau + halfWindow);
      let isLocalMin = true;
      for (let k = lo; k <= hi; k++) {
        if (cmnd[k] < cmnd[tau]) {
          isLocalMin = false;
          break;
        }
      }
      if (isLocalMin) {
        tauEstimate = tau;
        if (debug) console.log(`[YIN:dbg] threshold scan HIT — first local-min dip τ=${tau} cmnd=${cmnd[tau].toFixed(4)} freq≈${(sampleRate/tau).toFixed(1)}Hz`);
        break;
      }
    }
  }

  // Fallback: no τ dipped below threshold → use global minimum of cmnd.
  // Apply a secondary quality gate (2× the primary threshold) so we don't
  // report garbage frequencies when the note attack hasn't settled yet.
  if (tauEstimate < 0) {
    let bestVal = Infinity;
    for (let tau = minLag; tau <= maxLag; tau++) {
      if (cmnd[tau] < bestVal) {
        bestVal = cmnd[tau];
        tauEstimate = tau;
      }
    }
    if (debug) {
      console.log(
        `[YIN:dbg] threshold scan MISS — global min τ=${tauEstimate} cmnd=${cmnd[tauEstimate].toFixed(4)} ` +
        `freq≈${(sampleRate/tauEstimate).toFixed(1)}Hz qualityGate=${(yinThreshold * 2).toFixed(3)} ` +
        `pass=${cmnd[tauEstimate] <= yinThreshold * 2}`,
      );
    }
    // If even the global minimum has a high CMND the detection is
    // unreliable — bail out.
    if (cmnd[tauEstimate] > yinThreshold * 2) {
      if (debug) console.log(`[YIN:dbg] BAIL — global min CMND ${cmnd[tauEstimate].toFixed(4)} > quality gate ${(yinThreshold * 2).toFixed(3)}`);
      return null;
    }
  }

  if (tauEstimate <= 0) return null;

  // ---- Step 3.5: verify we haven't locked onto a period multiple ----------
  // Use the constrained minLag here so the verification cannot walk
  // submultiples below the search floor — otherwise noise at very short
  // lags can win the CMND comparison.
  const verifiedLag = verifyFundamentalPeriod(cmnd, buffer, tauEstimate, minLag, fullMaxLag);
  if (debug && verifiedLag !== tauEstimate) {
    console.log(`[YIN:dbg] fundamental check: τ ${tauEstimate}→${verifiedLag} freq ${(sampleRate/tauEstimate).toFixed(1)}→${(sampleRate/verifiedLag).toFixed(1)}Hz`);
  }
  tauEstimate = verifiedLag;

  // ---- Step 4: parabolic interpolation around the minimum ----------------
  const cmndValue = cmnd[tauEstimate];
  if (tauEstimate > minLag && tauEstimate < maxLag) {
    const y0 = cmnd[tauEstimate];
    const ym = cmnd[tauEstimate - 1];
    const yp = cmnd[tauEstimate + 1];
    const denom = ym - 2 * y0 + yp;
    if (denom > 0) {
      // denom > 0 ensures the parabola opens upward (true minimum)
      const delta = 0.5 * (ym - yp) / denom;
      if (Math.abs(delta) < 1) {
        const refinedLag = tauEstimate + delta;
        if (debug) console.log(`[YIN:dbg] OK — τ=${refinedLag.toFixed(2)} freq=${(sampleRate/refinedLag).toFixed(1)}Hz cmnd=${cmndValue.toFixed(4)}`);
        return {
          freq: sampleRate / refinedLag,
          tau: refinedLag,
          cmndValue,
        };
      }
    }
  }

  if (debug) console.log(`[YIN:dbg] OK (no interp) — τ=${tauEstimate} freq=${(sampleRate/tauEstimate).toFixed(1)}Hz cmnd=${cmndValue.toFixed(4)}`);
  return {
    freq: sampleRate / tauEstimate,
    tau: tauEstimate,
    cmndValue,
  };
}
