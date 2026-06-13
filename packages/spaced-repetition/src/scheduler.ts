/**
 * Review scheduler — selects which cards to present based on SM-2 state.
 *
 * The scheduler integrates with the existing drill mechanics:
 * - Weighted random selection that favours overdue + unmastered cards
 * - Priority scoring for "next card" selection
 * - Session summary statistics
 */

import type { SM2Card, SM2Params } from './types';
import { shuffleArray } from './types';

// ---------------------------------------------------------------------------
// Due detection
// ---------------------------------------------------------------------------

/** Cards whose `nextReviewAt` is ≤ now. */
export function getDueCards(cards: SM2Card[], now: number = Date.now()): SM2Card[] {
  return cards.filter((c) => c.nextReviewAt <= now);
}

/** Cards that have never been reviewed. */
export function getNewCards(cards: SM2Card[]): SM2Card[] {
  return cards.filter((c) => c.totalReviews === 0);
}

/** Cards that have been reviewed at least once. */
export function getReviewedCards(cards: SM2Card[]): SM2Card[] {
  return cards.filter((c) => c.totalReviews > 0);
}

/**
 * Cards that are due for review, sorted by urgency (most overdue first).
 */
export function getDueCardsSorted(cards: SM2Card[], now: number = Date.now()): SM2Card[] {
  return getDueCards(cards, now).sort((a, b) => a.nextReviewAt - b.nextReviewAt);
}

// ---------------------------------------------------------------------------
// Priority scoring
// ---------------------------------------------------------------------------

/**
 * Compute a priority score for a single card.
 *
 * Higher score → should be reviewed sooner.
 *
 * Factors:
 * - Overdue-ness (how far past nextReviewAt we are)
 * - Low easiness factor (harder items need more practice)
 * - Fewer total reviews (newer items need more exposure)
 * - Lapsed items (consecutiveWrong > 0 → urgent)
 *
 * The score is additive so all factors contribute.
 */
export function cardPriority(card: SM2Card, now: number = Date.now()): number {
  let score = 0;

  // Overdue bonus: 0 if not due, up to ~100 if very overdue (1 week late)
  if (card.nextReviewAt <= now) {
    const overdueMs = now - card.nextReviewAt;
    // log-scale: 1 min = 1 pt, 1 h = 2 pt, 1 d = 3 pt, 1 wk = 4 pt
    const overdueMinutes = overdueMs / 60_000;
    score += Math.log2(Math.max(1, overdueMinutes)) * 10;
  } else {
    // Not yet due — negative score proportional to time remaining
    const remainingMs = card.nextReviewAt - now;
    const remainingMinutes = remainingMs / 60_000;
    // Penalty: -1 per log2(minutes remaining), encouraging leaving it alone
    score -= Math.log2(Math.max(1, remainingMinutes)) * 5;
  }

  // Easiness factor: lower EF → harder → higher priority
  // EF range [1.3, 2.5] → normalize to [0, 1] → [0, 20] points
  const efNormalized = (2.5 - card.easinessFactor) / (2.5 - 1.3);
  score += efNormalized * 20;

  // New card bonus: newer cards need more reviews
  if (card.totalReviews === 0) {
    score += 15;
  } else if (card.totalReviews < 3) {
    score += 8;
  }

  // Lapse penalty: consecutive wrong answers → urgent
  score += card.consecutiveWrong * 10;

  // Low repetition count bonus
  if (card.repetitions < 2) {
    score += 5;
  }

  return score;
}

// ---------------------------------------------------------------------------
// Card selection strategies
// ---------------------------------------------------------------------------

/**
 * Select the next card to review using weighted random selection.
 *
 * Weights are derived from `cardPriority`, with a floor so even low-priority
 * cards have a small chance of appearing (prevents complete neglect).
 *
 * When `excludeLast` is provided, that card's weight is set to 0 to avoid
 * back-to-back repetition (may be null for very small pools).
 *
 * Returns null only if the pool is empty.
 */
export function selectNextCard(
  pool: SM2Card[],
  now: number = Date.now(),
  excludeLastId?: string,
): SM2Card | null {
  if (pool.length === 0) return null;

  const rawScores = pool.map((c) => {
    if (c.id === excludeLastId && pool.length > 1) return 0;
    return cardPriority(c, now);
  });

  // Shift scores so minimum is ≥ 1 (every card gets at least weight 1)
  const minScore = Math.min(...rawScores);
  const shift = Math.max(0, 1 - minScore);
  const weights = rawScores.map((s) => s + shift);

  const total = weights.reduce((a, b) => a + b, 0);
  let rand = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    rand -= weights[i];
    if (rand <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

/**
 * Select up to `count` cards due for review, using weighted random selection
 * on the due subset. Falls back to new cards if not enough due cards exist.
 *
 * @returns At most `count` cards, ordered by priority (highest first).
 */
export function selectReviewBatch(
  cards: SM2Card[],
  count: number,
  now: number = Date.now(),
): SM2Card[] {
  if (cards.length === 0 || count <= 0) return [];

  const due = getDueCards(cards, now);
  const newCards = getNewCards(cards);

  // Priority: due cards first, then new
  const priorityPool = [
    ...due.sort((a, b) => cardPriority(b, now) - cardPriority(a, now)),
    ...shuffleArray(newCards),
  ];

  // Weighted selection without replacement
  const selected: SM2Card[] = [];
  const remaining = [...priorityPool];

  while (selected.length < count && remaining.length > 0) {
    const next = selectNextCard(remaining, now, selected[selected.length - 1]?.id);
    if (!next) break;
    selected.push(next);
    const idx = remaining.indexOf(next);
    if (idx !== -1) remaining.splice(idx, 1);
  }

  return selected;
}

// ---------------------------------------------------------------------------
// Session summary
// ---------------------------------------------------------------------------

/** Summary statistics for a deck of cards. */
export interface DeckStats {
  total: number;
  new: number;
  learning: number;   // reviewed but not yet "mature" (repetitions < 3)
  mature: number;     // repetitions ≥ 3
  due: number;        // cards whose nextReviewAt ≤ now
  averageEF: number;
  totalReviews: number;
}

export function computeDeckStats(cards: SM2Card[], now: number = Date.now()): DeckStats {
  const due = getDueCards(cards, now).length;
  const newCount = getNewCards(cards).length;
  const reviewed = cards.length - newCount;
  const mature = cards.filter((c) => c.repetitions >= 3).length;
  const learning = reviewed - mature;
  const totalReviews = cards.reduce((sum, c) => sum + c.totalReviews, 0);
  const averageEF =
    cards.length > 0
      ? cards.reduce((sum, c) => sum + c.easinessFactor, 0) / cards.length
      : 0;

  return {
    total: cards.length,
    new: newCount,
    learning,
    mature,
    due,
    averageEF: Math.round(averageEF * 100) / 100,
    totalReviews,
  };
}
