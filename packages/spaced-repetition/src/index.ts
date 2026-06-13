/**
 * @ezmusic/spaced-repetition
 *
 * A lightweight spaced-repetition library based on the SM-2 algorithm,
 * adapted for music education drills.
 *
 * @example
 * ```ts
 * import { useSRDrill } from '@ezmusic/spaced-repetition';
 *
 * function MyDrill() {
 *   const { pickNext, recordReview, stats } = useSRDrill({
 *     storageKey: 'my-drill-sr',
 *   });
 *
 *   const pool = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4'];
 *   const [currentId, setCurrentId] = useState(pickNext(pool));
 *
 *   const handleAnswer = (isCorrect: boolean) => {
 *     if (currentId) recordReview(currentId, isCorrect);
 *     setCurrentId(pickNext(pool, currentId ?? undefined));
 *   };
 *   // ...
 * }
 * ```
 */

// Types
export type {
  SM2Card,
  SM2Params,
  RecallQuality,
  CardContent,
} from './types';

export {
  DEFAULT_SM2_PARAMS,
  RECALL_QUALITY_VALUES,
  createCard,
  clamp,
  validateQuality,
  shuffleArray,
} from './types';

// SM-2 algorithm
export {
  sm2Update,
  binaryToQuality,
  timedToQuality,
  formatInterval,
  predictIntervals,
} from './sm2';

export type { SM2UpdateResult } from './sm2';

// Scheduler
export {
  getDueCards,
  getDueCardsSorted,
  getNewCards,
  getReviewedCards,
  cardPriority,
  selectNextCard,
  selectReviewBatch,
  computeDeckStats,
} from './scheduler';

export type { DeckStats } from './scheduler';

// Store (low-level, framework-agnostic)
export { createSRStore } from './store';
export type { SRStore } from './store';

// React hooks
export {
  useSpacedRepetition,
  useSRDrill,
  useSRDebug,
} from './hooks';

export type {
  UseSROptions,
  UseSRReturn,
  UseSRDrillOptions,
  UseSRDrillReturn,
} from './hooks';
