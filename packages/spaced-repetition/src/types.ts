/**
 * Spaced Repetition — core types.
 *
 * Based on the SM-2 algorithm (SuperMemo 2) adapted for music drill
 * intervals measured in minutes/hours rather than days.
 */

// ---------------------------------------------------------------------------
// Recall quality
// ---------------------------------------------------------------------------

/**
 * Recall quality rating (SM-2 scale).
 *
 * 0 – Complete blackout (no recall at all)
 * 1 – Incorrect; the correct answer was recognized when revealed
 * 2 – Incorrect; the correct answer seemed easy / familiar once revealed
 * 3 – Correct but recalled with serious difficulty (slow, uncertain)
 * 4 – Correct after slight hesitation
 * 5 – Perfect, immediate, effortless recall
 */
export type RecallQuality = 0 | 1 | 2 | 3 | 4 | 5;

/** Valid recall quality values for runtime validation */
export const RECALL_QUALITY_VALUES: readonly RecallQuality[] = [0, 1, 2, 3, 4, 5];

// ---------------------------------------------------------------------------
// SM-2 card
// ---------------------------------------------------------------------------

/** Arbitrary metadata attached to a memory card (e.g. note name, interval). */
export type CardContent = Record<string, unknown>;

/**
 * A single memory card tracked by the SM-2 algorithm.
 *
 * Fields are designed to be JSON-serializable for localStorage persistence.
 */
export interface SM2Card {
  /** Unique identifier — typically the "item key" (e.g. "C4", "interval-3") */
  id: string;

  // ── SM-2 core ──────────────────────────────────────────────────────────
  /** Easiness factor, clamped to [params.minEF, params.maxEF] (typically [1.3, 2.5]) */
  easinessFactor: number;
  /** Current inter-review interval in **milliseconds** */
  interval: number;
  /** Number of consecutive successful repetitions (q ≥ 3) */
  repetitions: number;
  /** Unix-ms timestamp when this card becomes due for next review */
  nextReviewAt: number;
  /** Unix-ms timestamp of the most recent review, or null if never reviewed */
  lastReviewedAt: number | null;

  // ── Statistics ─────────────────────────────────────────────────────────
  /** Total number of times this card has been reviewed */
  totalReviews: number;
  /** Total number of correct answers */
  totalCorrect: number;
  /** Current streak of consecutive correct answers */
  consecutiveCorrect: number;
  /** Current streak of consecutive wrong answers */
  consecutiveWrong: number;

  // ── Metadata ───────────────────────────────────────────────────────────
  /** Arbitrary content payload (note name, interval distance, solfège, …) */
  content: CardContent;
  /** Optional tags for grouping / filtering */
  tags: string[];
  /** Unix-ms creation timestamp */
  createdAt: number;
}

// ---------------------------------------------------------------------------
// SM-2 parameters
// ---------------------------------------------------------------------------

/**
 * Tunable parameters for the SM-2 algorithm.
 *
 * Defaults are tuned for **music drill** use where sessions last 10-30 minutes
 * and the minimum interval is measured in minutes, not days.
 */
export interface SM2Params {
  /** Minimum easiness factor (default 1.3) */
  minEF: number;
  /** Maximum easiness factor (default 2.5) */
  maxEF: number;
  /** Easiness factor assigned to new cards (default 2.5) */
  initialEF: number;

  /**
   * First interval after the first successful recall (q ≥ 3).
   * Default: 5 minutes (300_000 ms).
   */
  baseInterval: number;
  /**
   * Multiplier applied to baseInterval for the **second** successful recall.
   * Default: 6 → second interval = 6 × 5 min = 30 min.
   */
  intervalMultiplier1: number;

  /**
   * Interval assigned after a lapse (q < 3).
   * Default: 5 minutes (300_000 ms).
   */
  lapseInterval: number;

  /** Hard floor for any computed interval (default: 5 min = 300_000 ms) */
  minimumInterval: number;

  /** Maximum interval cap in ms (default: 365 days = one year) */
  maxInterval: number;
}

/**
 * Default SM-2 parameters tuned for music education drills.
 *
 * Intervals grow: 5 min → 30 min → 2 h → 5 h → 14 h → 1.5 d → 4 d → …
 * which is appropriate for daily practice sessions.
 */
export const DEFAULT_SM2_PARAMS: SM2Params = {
  minEF: 1.3,
  maxEF: 2.5,
  initialEF: 2.5,
  baseInterval: 5 * 60 * 1000,           // 5 minutes
  intervalMultiplier1: 6,                 // → 30 minutes
  lapseInterval: 5 * 60 * 1000,           // 5 minutes after lapse
  minimumInterval: 5 * 60 * 1000,         // 5 minutes floor
  maxInterval: 365 * 24 * 60 * 60 * 1000, // 1 year cap
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Clamp a number to [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Validate that a value is a valid RecallQuality.
 * Returns the clamped quality value.
 */
export function validateQuality(value: number): RecallQuality {
  return clamp(Math.round(value), 0, 5) as RecallQuality;
}

/** Create a fresh SM2Card with the given id, content, tags, and params. */
export function createCard(
  id: string,
  content: CardContent = {},
  tags: string[] = [],
  params: SM2Params = DEFAULT_SM2_PARAMS,
  now: number = Date.now(),
): SM2Card {
  return {
    id,
    easinessFactor: params.initialEF,
    interval: params.baseInterval,
    repetitions: 0,
    nextReviewAt: now, // immediately due
    lastReviewedAt: null,
    totalReviews: 0,
    totalCorrect: 0,
    consecutiveCorrect: 0,
    consecutiveWrong: 0,
    content,
    tags,
    createdAt: now,
  };
}

/**
 * Shuffle an array in-place (Fisher-Yates).
 * Returns the same array reference.
 */
export function shuffleArray<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
