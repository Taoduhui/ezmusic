/**
 * SM-2 algorithm — core review logic adapted from SuperMemo 2.
 *
 * Reference: P.A. Wozniak, "Optimization of learning" (1990)
 *   https://www.supermemo.com/en/archives1990-2015/english/ol/sm2
 *
 * This adaptation uses millisecond-based intervals (instead of days)
 * so the scheduler works for music drill sessions that last minutes to hours.
 */

import type { SM2Card, SM2Params, RecallQuality } from './types';
import { clamp } from './types';

// ---------------------------------------------------------------------------
// Core SM-2 update
// ---------------------------------------------------------------------------

/**
 * Result of applying the SM-2 algorithm to a card.
 *
 * The returned card is a **new object** — the input card is never mutated.
 */
export interface SM2UpdateResult {
  card: SM2Card;
  /** True when the card was "lapsed" (q < 3 → repetitions reset). */
  wasLapse: boolean;
  /** True when the easy factor changed. */
  efChanged: boolean;
}

/**
 * Apply the SM-2 algorithm to a card after a review.
 *
 * @param card    The card being reviewed.
 * @param quality The user's self-assessed recall quality (0–5).
 * @param params  Algorithm parameters.
 * @param now     Current timestamp in ms (default: Date.now()).
 */
export function sm2Update(
  card: SM2Card,
  quality: RecallQuality,
  params: SM2Params,
  now: number = Date.now(),
): SM2UpdateResult {
  const q = clamp(Math.round(quality), 0, 5);
  let { easinessFactor, interval, repetitions } = card;

  const prevEF = easinessFactor;

  // ── Update easiness factor ─────────────────────────────────────────────
  // EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
  easinessFactor += 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02);
  easinessFactor = clamp(easinessFactor, params.minEF, params.maxEF);
  const efChanged = easinessFactor !== prevEF;

  let wasLapse = false;

  if (q < 3) {
    // ── Lapse ────────────────────────────────────────────────────────────
    repetitions = 0;
    interval = params.lapseInterval;
    wasLapse = true;
  } else {
    // ── Successful recall ────────────────────────────────────────────────
    if (repetitions === 0) {
      interval = params.baseInterval;
    } else if (repetitions === 1) {
      interval = params.baseInterval * params.intervalMultiplier1;
    } else {
      interval = Math.round(interval * easinessFactor);
    }
    repetitions += 1;
  }

  // ── Clamp ──────────────────────────────────────────────────────────────
  interval = clamp(interval, params.minimumInterval, params.maxInterval);

  const nextReviewAt = now + interval;

  const updated: SM2Card = {
    ...card,
    easinessFactor,
    interval,
    repetitions,
    nextReviewAt,
    lastReviewedAt: now,
    totalReviews: card.totalReviews + 1,
    totalCorrect: card.totalCorrect + (q >= 3 ? 1 : 0),
    consecutiveCorrect: q >= 3 ? card.consecutiveCorrect + 1 : 0,
    consecutiveWrong: q < 3 ? card.consecutiveWrong + 1 : 0,
  };

  return { card: updated, wasLapse, efChanged };
}

// ---------------------------------------------------------------------------
// Utility: map binary (correct/wrong) answer → quality
// ---------------------------------------------------------------------------

/**
 * Map a simple correct/wrong outcome to a RecallQuality.
 *
 * This is useful when the drill UI only exposes a binary result
 * (e.g. answer button → instant check) without a self-assessment step.
 *
 * Mapping:
 * - correct → 4 (correct after hesitation — conservative default)
 * - wrong   → 1 (incorrect; answer recognized when revealed)
 *
 * For better results, consider measuring response time and adjusting:
 * - fast + correct → 5
 * - slow + correct → 3 or 4
 */
export function binaryToQuality(isCorrect: boolean): RecallQuality {
  return isCorrect ? 4 : 1;
}

/**
 * Map a correct/wrong outcome + response time (ms) to a RecallQuality.
 *
 * Heuristic thresholds (tune per exercise type):
 * - correct + fast (< 2 s)   → 5 (perfect)
 * - correct + medium (2–5 s) → 4 (hesitation)
 * - correct + slow (> 5 s)   → 3 (difficulty)
 * - wrong + slow (> 5 s)     → 2 (answer seemed familiar)
 * - wrong + fast (< 5 s)     → 1 (no recognition)
 * - wrong + immediate (< 1 s)→ 0 (complete blackout — random guess)
 *
 * @param isCorrect     Whether the answer was correct.
 * @param responseTimeMs Response time in milliseconds.
 * @param fastThreshold  Below this is "fast" (default 2000 ms).
 * @param slowThreshold  Above this is "slow" (default 5000 ms).
 */
export function timedToQuality(
  isCorrect: boolean,
  responseTimeMs: number,
  fastThreshold: number = 2000,
  slowThreshold: number = 5000,
): RecallQuality {
  if (isCorrect) {
    if (responseTimeMs < fastThreshold) return 5;
    if (responseTimeMs < slowThreshold) return 4;
    return 3;
  }
  // Wrong
  if (responseTimeMs < 1000) return 0;
  if (responseTimeMs < slowThreshold) return 1;
  return 2;
}

// ---------------------------------------------------------------------------
// Interval display helpers
// ---------------------------------------------------------------------------

/** Format a millisecond interval for human-readable display. */
export function formatInterval(ms: number): string {
  const minutes = ms / 60_000;
  if (minutes < 60) {
    return `${Math.round(minutes)} 分钟`;
  }
  const hours = minutes / 60;
  if (hours < 24) {
    return `${Math.round(hours)} 小时`;
  }
  const days = hours / 24;
  if (days < 30) {
    return `${Math.round(days)} 天`;
  }
  const months = days / 30;
  if (months < 12) {
    return `${Math.round(months)} 月`;
  }
  const years = months / 12;
  return `${Math.round(years * 10) / 10} 年`;
}

/**
 * Compute the predicted interval progression for a card,
 * given consecutive successful reviews at a fixed quality level.
 *
 * Useful for debugging / visualization.
 */
export function predictIntervals(
  initialEF: number,
  baseInterval: number,
  intervalMultiplier1: number,
  quality: RecallQuality,
  count: number,
): number[] {
  let ef = initialEF;
  let interval = baseInterval;
  let reps = 0;
  const result: number[] = [];

  for (let i = 0; i < count; i++) {
    // Update EF
    ef += 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02);
    ef = clamp(ef, 1.3, 2.5);

    if (quality < 3) {
      reps = 0;
      interval = baseInterval; // lapse
    } else {
      if (reps === 0) interval = baseInterval;
      else if (reps === 1) interval = baseInterval * intervalMultiplier1;
      else interval = Math.round(interval * ef);
      reps += 1;
    }

    result.push(interval);
  }

  return result;
}
