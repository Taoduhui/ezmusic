/**
 * React hooks for spaced repetition.
 *
 * Provides `useSpacedRepetition` — a high-level hook that manages
 * the full SR lifecycle (load, review, select, persist) inside React state.
 *
 * Also provides `useSRDrill` — a specialised hook for music drill components
 * that integrates SR card selection with the existing question-generation flow.
 */

import { useRef, useCallback, useMemo, useEffect, useState } from 'react';
import type { SM2Card, SM2Params, CardContent, RecallQuality } from './types';
import { DEFAULT_SM2_PARAMS } from './types';
import { createSRStore } from './store';
import type { SRStore } from './store';
import {
  getDueCards,
  getDueCardsSorted,
  selectNextCard,
  computeDeckStats,
} from './scheduler';
import type { DeckStats } from './scheduler';

// ---------------------------------------------------------------------------
// Main SR hook
// ---------------------------------------------------------------------------

export interface UseSROptions {
  /** localStorage key for persistence. */
  storageKey: string;
  /** Override default SM-2 parameters. */
  params?: Partial<SM2Params>;
}

export interface UseSRReturn {
  /** All cards as an array. */
  cards: SM2Card[];
  /** Cards that are currently due for review. */
  dueCards: SM2Card[];
  /** New (never-reviewed) cards. */
  newCards: SM2Card[];
  /** Deck statistics. */
  stats: DeckStats;

  /** Ensure cards exist for the given ids. Idempotent — existing cards are kept. */
  ensureCards: (ids: string[], contentFactory?: (id: string) => CardContent, tags?: string[]) => void;
  /** Review a card by id with the given recall quality. Returns the updated card. */
  review: (id: string, quality: RecallQuality) => SM2Card | null;
  /**
   * Review a card with a binary correct/wrong outcome.
   * correct → quality 4, wrong → quality 1.
   */
  reviewBinary: (id: string, isCorrect: boolean) => SM2Card | null;
  /** Select the best next card to review. Returns null if the pool is empty. */
  selectNext: (previousCardId?: string) => SM2Card | null;
  /** Reset all cards to initial SM-2 state. */
  resetAll: () => void;
  /** Get a single card by id. */
  getCard: (id: string) => SM2Card | undefined;
}

/**
 * Core spaced-repetition React hook.
 *
 * Manages an SM-2 deck backed by localStorage.  The store is created once
 * (useRef) and React state is updated on each mutation so the component
 * tree re-renders.
 */
export function useSpacedRepetition(options: UseSROptions): UseSRReturn {
  const { storageKey, params: paramsOverride } = options;

  // Stable store ref (never recreated)
  const storeRef = useRef<SRStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = createSRStore(storageKey, paramsOverride);
  }
  const store = storeRef.current;

  // React state mirror of the store's card map
  const [cardMap, setCardMap] = useState<Record<string, SM2Card>>(store.cards);

  // Recompute due/new/stats whenever cardMap changes
  const cardsArray = useMemo(() => Object.values(cardMap), [cardMap]);
  const dueCards = useMemo(() => getDueCardsSorted(cardsArray), [cardsArray]);
  const newCards = useMemo(() => cardsArray.filter((c) => c.totalReviews === 0), [cardsArray]);
  const stats = useMemo(() => computeDeckStats(cardsArray), [cardsArray]);

  // ── Actions ────────────────────────────────────────────────────────────

  const ensureCards = useCallback(
    (ids: string[], contentFactory?: (id: string) => CardContent, tags?: string[]) => {
      store.ensureCards(ids, contentFactory, tags);
      setCardMap({ ...store.cards });
    },
    [store],
  );

  const review = useCallback(
    (id: string, quality: RecallQuality): SM2Card | null => {
      const updated = store.review(id, quality);
      if (updated) {
        setCardMap({ ...store.cards });
      }
      return updated;
    },
    [store],
  );

  const reviewBinary = useCallback(
    (id: string, isCorrect: boolean): SM2Card | null => {
      const quality: RecallQuality = isCorrect ? 4 : 1;
      return review(id, quality);
    },
    [review],
  );

  const selectNext = useCallback(
    (previousCardId?: string): SM2Card | null => {
      return selectNextCard(cardsArray, Date.now(), previousCardId);
    },
    [cardsArray],
  );

  const resetAll = useCallback(() => {
    store.resetAll();
    setCardMap({ ...store.cards });
  }, [store]);

  const getCard = useCallback(
    (id: string): SM2Card | undefined => store.getCard(id),
    [store],
  );

  return {
    cards: cardsArray,
    dueCards,
    newCards,
    stats,
    ensureCards,
    review,
    reviewBinary,
    selectNext,
    resetAll,
    getCard,
  };
}

// ---------------------------------------------------------------------------
// Specialised drill hook
// ---------------------------------------------------------------------------

/**
 * Configuration for the drill-specialised SR hook.
 */
export interface UseSRDrillOptions {
  /** localStorage key for the SR deck. */
  storageKey: string;
  /** Override default SM-2 params. */
  params?: Partial<SM2Params>;
}

/**
 * Return type for the drill-specialised SR hook.
 */
export interface UseSRDrillReturn {
  /** Deck statistics. */
  stats: DeckStats;

  /**
   * Ensure SR cards exist for all item ids.
   * Call once on mount / when the item pool changes.
   */
  ensureCards: (ids: string[], contentFactory?: (id: string) => CardContent, tags?: string[]) => void;

  /**
   * Pick the next item id to drill.
   *
   * Uses SR priority scoring to prefer items that are due / overdue,
   * while occasionally revisiting mastered items (10% chance of random).
   *
   * @param pool          All available item ids for this exercise.
   * @param lastItemId    The id of the previously shown item (avoid repeat).
   * @param randomChance  Probability [0, 1] of picking purely randomly
   *                      (default 0.1). Provides variation.
   * @returns The selected item id, or null if pool is empty.
   */
  pickNext: (pool: string[], lastItemId?: string, randomChance?: number) => string | null;

  /**
   * Record a review result for the given item.
   *
   * @param id          The item id that was reviewed.
   * @param isCorrect   Whether the answer was correct.
   * @param responseTimeMs Optional response time for finer-grained quality.
   */
  recordReview: (id: string, isCorrect: boolean, responseTimeMs?: number) => SM2Card | null;

  /** Reset all SR progress. */
  resetAll: () => void;
  /** Get SR card data for a specific item. */
  getCard: (id: string) => SM2Card | undefined;
}

/**
 * A convenience hook for music drill components.
 *
 * Wraps `useSpacedRepetition` with drill-specific selection logic:
 * - Most of the time, picks based on SR priority
 * - Occasionally picks randomly for variety (default 10%)
 * - Avoids repeating the same item back-to-back
 */
export function useSRDrill(options: UseSRDrillOptions): UseSRDrillReturn {
  const sr = useSpacedRepetition({
    storageKey: options.storageKey,
    params: options.params,
  });

  const pickNext = useCallback(
    (pool: string[], lastItemId?: string, randomChance: number = 0.1): string | null => {
      if (pool.length === 0) return null;

      // 10% random for variety
      if (Math.random() < randomChance) {
        const available = pool.filter((id) => pool.length === 1 || id !== lastItemId);
        return available[Math.floor(Math.random() * available.length)] ?? pool[0];
      }

      // Build card array for the current pool
      const poolCards: SM2Card[] = [];
      const missingIds: string[] = [];
      for (const id of pool) {
        const card = sr.getCard(id);
        if (card) {
          poolCards.push(card);
        } else {
          missingIds.push(id);
        }
      }

      // Create any missing cards
      if (missingIds.length > 0) {
        sr.ensureCards(missingIds);
      }

      // Build fresh card array after ensuring existence
      const allPoolCards: SM2Card[] = pool
        .map((id) => sr.getCard(id)!)
        .filter(Boolean);

      // Use SR priority-based selection
      const selected = selectNextCard(allPoolCards, Date.now(), lastItemId);
      return selected?.id ?? pool[Math.floor(Math.random() * pool.length)];
    },
    [sr],
  );

  const recordReview = useCallback(
    (id: string, isCorrect: boolean, responseTimeMs?: number): SM2Card | null => {
      // Ensure card exists
      const card = sr.getCard(id);
      if (!card) {
        sr.ensureCards([id]);
      }
      return sr.reviewBinary(id, isCorrect);
    },
    [sr],
  );

  return {
    stats: sr.stats,
    ensureCards: sr.ensureCards,
    pickNext,
    recordReview,
    resetAll: sr.resetAll,
    getCard: sr.getCard,
  };
}

// ---------------------------------------------------------------------------
// Debug hook (dev only)
// ---------------------------------------------------------------------------

/**
 * Debug hook that returns the raw store for inspection in devtools.
 * Usage: `const debug = useSRDebug('my-key'); console.log(debug.cards);`
 */
export function useSRDebug(storageKey: string) {
  const storeRef = useRef<SRStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = createSRStore(storageKey);
  }
  const store = storeRef.current;
  const [tick, setTick] = useState(0);

  return {
    cards: store.cards,
    params: store.params,
    refresh: () => setTick((n) => n + 1),
  };
}
