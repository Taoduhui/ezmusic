/**
 * Persistence layer — localStorage-backed card store.
 *
 * Each "deck" is stored under a separate localStorage key.
 * The store is JSON-serializable and includes versioning for forward
 * compatibility.
 */

import type { SM2Card, SM2Params, CardContent } from './types';
import { DEFAULT_SM2_PARAMS, createCard } from './types';
import { sm2Update } from './sm2';
import type { RecallQuality } from './types';

// ---------------------------------------------------------------------------
// Stored data shape
// ---------------------------------------------------------------------------

const STORE_VERSION = 1;

interface SerializedStore {
  version: number;
  params: SM2Params;
  cards: Record<string, SM2Card>;
}

// ---------------------------------------------------------------------------
// Store API
// ---------------------------------------------------------------------------

export interface SRStore {
  /** All cards keyed by id. */
  cards: Record<string, SM2Card>;
  /** The algorithm parameters for this deck. */
  params: SM2Params;

  // ── Card CRUD ──────────────────────────────────────────────────────────
  /** Add a new card (no-op if id already exists). Returns the created card, or null. */
  addCard(id: string, content?: CardContent, tags?: string[]): SM2Card | null;
  /** Remove a card by id. */
  removeCard(id: string): void;
  /** Get a card by id, or undefined. */
  getCard(id: string): SM2Card | undefined;
  /** List all card ids. */
  getAllIds(): string[];
  /** Get all cards as an array. */
  getAllCards(): SM2Card[];

  // ── Review ─────────────────────────────────────────────────────────────
  /**
   * Review a card: apply SM-2 update and persist.
   * Returns the updated card.
   */
  review(id: string, quality: RecallQuality, now?: number): SM2Card | null;

  // ── Bulk operations ────────────────────────────────────────────────────
  /** Ensure cards exist for all given ids (creates missing ones). */
  ensureCards(ids: string[], contentFactory?: (id: string) => CardContent, tags?: string[]): void;
  /** Reset all progress (keep cards but reset SM-2 state). */
  resetAll(): void;
  /** Delete all cards from the store. */
  clear(): void;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function createSRStore(storageKey: string, paramsOverride?: Partial<SM2Params>): SRStore {
  const params: SM2Params = { ...DEFAULT_SM2_PARAMS, ...paramsOverride };

  // ── Load ────────────────────────────────────────────────────────────────
  let cards = loadCards(storageKey, params);

  function persist(): void {
    saveCards(storageKey, { version: STORE_VERSION, params, cards });
  }

  // ── Public API ──────────────────────────────────────────────────────────

  const store: SRStore = {
    get cards() { return cards; },
    get params() { return params; },

    addCard(id: string, content: CardContent = {}, tags: string[] = []): SM2Card | null {
      if (cards[id]) return null;
      const card = createCard(id, content, tags, params, Date.now());
      cards = { ...cards, [id]: card };
      persist();
      return card;
    },

    removeCard(id: string): void {
      if (!cards[id]) return;
      const next = { ...cards };
      delete next[id];
      cards = next;
      persist();
    },

    getCard(id: string): SM2Card | undefined {
      return cards[id];
    },

    getAllIds(): string[] {
      return Object.keys(cards);
    },

    getAllCards(): SM2Card[] {
      return Object.values(cards);
    },

    review(id: string, quality: RecallQuality, now?: number): SM2Card | null {
      const card = cards[id];
      if (!card) return null;
      const result = sm2Update(card, quality, params, now);
      cards = { ...cards, [id]: result.card };
      persist();
      return result.card;
    },

    ensureCards(ids: string[], contentFactory?: (id: string) => CardContent, tags?: string[]): void {
      let changed = false;
      const next = { ...cards };
      for (const id of ids) {
        if (!next[id]) {
          const content = contentFactory ? contentFactory(id) : {};
          next[id] = createCard(id, content, tags, params, Date.now());
          changed = true;
        }
      }
      if (changed) {
        cards = next;
        persist();
      }
    },

    resetAll(): void {
      const next: Record<string, SM2Card> = {};
      for (const id of Object.keys(cards)) {
        next[id] = createCard(id, cards[id].content, cards[id].tags, params, Date.now());
        // Preserve creation time
        next[id] = { ...next[id], createdAt: cards[id].createdAt };
      }
      cards = next;
      persist();
    },

    clear(): void {
      cards = {};
      persist();
    },
  };

  return store;
}

// ---------------------------------------------------------------------------
// localStorage raw access
// ---------------------------------------------------------------------------

function loadCards(storageKey: string, params: SM2Params): Record<string, SM2Card> {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return {};

    const parsed = JSON.parse(raw) as Partial<SerializedStore>;

    // Version migration (future-proof)
    if (parsed.version !== STORE_VERSION) {
      // For now, just use cards as-is; add migrations here when format changes
    }

    const loaded = parsed.cards ?? {};

    // Sanitize: ensure every card has all required fields
    const sanitized: Record<string, SM2Card> = {};
    for (const [id, card] of Object.entries(loaded)) {
      if (!card || typeof card !== 'object') continue;
      sanitized[id] = sanitizeCard(card as Partial<SM2Card>, id, params);
    }

    return sanitized;
  } catch {
    return {};
  }
}

function saveCards(storageKey: string, data: SerializedStore): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(data));
  } catch {
    // Storage quota exceeded — could notify user, but for now silently fail
  }
}

function sanitizeCard(raw: Partial<SM2Card>, id: string, params: SM2Params): SM2Card {
  const now = Date.now();
  return {
    id: raw.id ?? id,
    easinessFactor: typeof raw.easinessFactor === 'number' ? raw.easinessFactor : params.initialEF,
    interval: typeof raw.interval === 'number' ? raw.interval : params.baseInterval,
    repetitions: typeof raw.repetitions === 'number' ? raw.repetitions : 0,
    nextReviewAt: typeof raw.nextReviewAt === 'number' ? raw.nextReviewAt : now,
    lastReviewedAt: typeof raw.lastReviewedAt === 'number' ? raw.lastReviewedAt : null,
    totalReviews: typeof raw.totalReviews === 'number' ? raw.totalReviews : 0,
    totalCorrect: typeof raw.totalCorrect === 'number' ? raw.totalCorrect : 0,
    consecutiveCorrect: typeof raw.consecutiveCorrect === 'number' ? raw.consecutiveCorrect : 0,
    consecutiveWrong: typeof raw.consecutiveWrong === 'number' ? raw.consecutiveWrong : 0,
    content: raw.content && typeof raw.content === 'object' ? raw.content : {},
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now,
  };
}
