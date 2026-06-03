/**
 * Music theory utilities built on top of tonal.
 * All pure functions – no side-effects, no state.
 */
import { Note, Scale, Interval } from 'tonal';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Solfège syllable in movable-do system */
export type SolfegeSyllable = 'Do' | 'Re' | 'Mi' | 'Fa' | 'Sol' | 'La' | 'Si';

/** How to render a note label */
export interface NoteLabel {
  /** Scientific pitch class, e.g. "C", "F#", "Bb" */
  pitchClass: string;
  /** Solfège syllable in the current key */
  solfege: SolfegeSyllable;
  /** Whether this note is the tonic (Do) of the current key */
  isTonic: boolean;
  /** Whether the note has an accidental in the key's scale */
  hasAccidental: boolean;
  /** Frequency in Hz for octave 4 */
  freq: number;
}

/** One row in the mapping table */
export interface MappingRow {
  solfege: SolfegeSyllable;
  pitchClass: string;
  hasAccidental: boolean;
  /** Scale degree index 0–6 */
  degree: number;
}

/** Frequency bar chart data point */
export interface FreqDataPoint {
  /** Display name shown on chart axis */
  note: string;
  pitchClass: string;
  freq: number;
  /** Ratio relative to tonic, e.g. "3/2" (approx) */
  ratioLabel: string;
  /** 'selected' when this is the active note, 'normal' otherwise */
  isSelected: 'selected' | 'normal';
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SOLFEGE_SYLLABLES: SolfegeSyllable[] = [
  'Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Si',
];

/** Common major keys shown in the selector */
export const COMMON_MAJOR_KEYS = ['C', 'G', 'D', 'A', 'E', 'F', 'Bb', 'Eb'] as const;
export type CommonMajorKey = (typeof COMMON_MAJOR_KEYS)[number];

/** 12-TET base frequencies for octave 4 (C4 = middle C) */
const C4_FREQ = 261.63;
const SEMITONE_RATIO = Math.pow(2, 1 / 12);

// Chromatic pitch classes in order
const CHROMATIC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------

function chromaticIndex(pitchClass: string): number {
  const normalized = Note.pitchClass(pitchClass);
  const idx = CHROMATIC.indexOf(normalized);
  if (idx !== -1) return idx;
  // Handle flat enharmonics
  const fromFlat = Note.enharmonic(pitchClass);
  return CHROMATIC.indexOf(Note.pitchClass(fromFlat));
}

/** Normalize a pitch class to the sharp form used by CHROMATIC (e.g. Bb → A#, Eb → D#). */
export function normalizeToSharpPC(pc: string): string {
  return CHROMATIC[chromaticIndex(pc)] ?? pc;
}

/** Frequency of a pitch class in octave 4 (12-TET, A4 = 440 Hz). */
export function pitchClassFreq(pitchClass: string): number {
  const semitones = chromaticIndex(pitchClass);
  return parseFloat((C4_FREQ * Math.pow(SEMITONE_RATIO, semitones)).toFixed(2));
}

// ---------------------------------------------------------------------------
// Scale & mapping
// ---------------------------------------------------------------------------

/**
 * Returns the 7 pitch classes of the given major key, in scale order.
 * Uses tonal's Scale.get for canonical names (handles flats/sharps correctly).
 */
export function majorScaleNotes(key: string): string[] {
  const scale = Scale.get(`${key} major`);
  if (!scale.notes || scale.notes.length === 0) return [];
  return scale.notes.map((n) => Note.pitchClass(n));
}

/**
 * Build the full mapping table for the current key & solfège mode.
 *
 * @param key       Tonic pitch class, e.g. "G"
 * @param fixedDo   When true, Do is always C (固定唱名法). When false, Do follows the tonic (移动唱名法).
 */
export function buildMappingRows(key: string, fixedDo: boolean): MappingRow[] {
  const scaleNotes = majorScaleNotes(key);
  if (scaleNotes.length === 0) return [];

  if (fixedDo) {
    // Fixed-do: map pitch class → solfège based on C-major position
    const cMajor = majorScaleNotes('C');
    return scaleNotes.map((pc, degree) => {
      const cIdx = cMajor.indexOf(pc);
      const solfege =
        cIdx !== -1
          ? SOLFEGE_SYLLABLES[cIdx]
          : (SOLFEGE_SYLLABLES[degree] as SolfegeSyllable);
      const hasAccidental = pc.includes('#') || pc.includes('b');
      return { solfege, pitchClass: pc, hasAccidental, degree };
    });
  } else {
    // Movable-do: degree 0 → Do, 1 → Re, …
    return scaleNotes.map((pc, degree) => ({
      solfege: SOLFEGE_SYLLABLES[degree],
      pitchClass: pc,
      hasAccidental: pc.includes('#') || pc.includes('b'),
      degree,
    }));
  }
}

/**
 * Returns a NoteLabel for every key in a one-octave span (C4–B4, 12 notes).
 */
export function buildKeyboardLabels(key: string, fixedDo: boolean): Map<string, NoteLabel> {
  const rows = buildMappingRows(key, fixedDo);
  const tonicSemitone = chromaticIndex(Note.pitchClass(key));

  const map = new Map<string, NoteLabel>();
  CHROMATIC.forEach((pc) => {
    const pcIdx = chromaticIndex(pc);
    // Match by semitone to handle enharmonic equivalents (e.g. A# = Bb, D# = Eb)
    const row = rows.find((r) => chromaticIndex(r.pitchClass) === pcIdx);
    const isTonic = pcIdx === tonicSemitone;
    map.set(pc, {
      pitchClass: row?.pitchClass ?? pc,
      solfege: row?.solfege ?? ('Do' as SolfegeSyllable),
      isTonic,
      hasAccidental: pc.includes('#') || pc.includes('b'),
      freq: pitchClassFreq(pc),
    });
  });
  return map;
}

// ---------------------------------------------------------------------------
// Frequency chart
// ---------------------------------------------------------------------------

/** Approximate simple ratio for a semitone interval count */
function approxRatio(semitones: number): string {
  const ratios: Record<number, string> = {
    0: '1/1',
    2: '9/8',
    4: '5/4',
    5: '4/3',
    7: '3/2',
    9: '5/3',
    11: '15/8',
    12: '2/1',
  };
  return ratios[semitones] ?? '—';
}

/**
 * Build frequency chart data for one octave (C4–B4).
 * The tonic pitch class's frequency is the reference.
 */
export function buildFreqChartData(
  key: string,
  fixedDo: boolean,
  selectedPitchClass: string | null,
): FreqDataPoint[] {
  const rows = buildMappingRows(key, fixedDo);
  const tonicSemitones = chromaticIndex(Note.pitchClass(key));

  return CHROMATIC.filter((pc) =>
    rows.some((r) => chromaticIndex(r.pitchClass) === chromaticIndex(pc)),
  ).map((pc) => {
    const pcIdx = chromaticIndex(pc);
    const semitones = (pcIdx - tonicSemitones + 12) % 12;
    const row = rows.find((r) => chromaticIndex(r.pitchClass) === pcIdx);
    return {
      note: row ? `${row.solfege} (${row.pitchClass})` : pc,
      pitchClass: pc,
      freq: pitchClassFreq(pc),
      ratioLabel: approxRatio(semitones),
      isSelected: pc === selectedPitchClass ? 'selected' : 'normal',
    };
  });
}

// ---------------------------------------------------------------------------
// Interval description
// ---------------------------------------------------------------------------

/**
 * Human-readable interval name between tonic and a pitch class.
 * Returns empty string for the tonic itself.
 */
export function intervalFromTonic(key: string, pitchClass: string): string {
  if (Note.pitchClass(key) === pitchClass) return '';
  const semitones = (chromaticIndex(pitchClass) - chromaticIndex(Note.pitchClass(key)) + 12) % 12;
  const names: Record<number, { zh: string; en: string }> = {
    1: { zh: '小二度', en: 'Minor 2nd' },
    2: { zh: '大二度', en: 'Major 2nd' },
    3: { zh: '小三度', en: 'Minor 3rd' },
    4: { zh: '大三度', en: 'Major 3rd' },
    5: { zh: '纯四度', en: 'Perfect 4th' },
    6: { zh: '增四度', en: 'Tritone' },
    7: { zh: '纯五度', en: 'Perfect 5th' },
    8: { zh: '小六度', en: 'Minor 6th' },
    9: { zh: '大六度', en: 'Major 6th' },
    10: { zh: '小七度', en: 'Minor 7th' },
    11: { zh: '大七度', en: 'Major 7th' },
  };
  return names[semitones]?.zh ?? '';
}

export function intervalFromTonicEn(key: string, pitchClass: string): string {
  if (Note.pitchClass(key) === pitchClass) return '';
  const semitones = (chromaticIndex(pitchClass) - chromaticIndex(Note.pitchClass(key)) + 12) % 12;
  const names: Record<number, string> = {
    1: 'Minor 2nd', 2: 'Major 2nd', 3: 'Minor 3rd', 4: 'Major 3rd',
    5: 'Perfect 4th', 6: 'Tritone', 7: 'Perfect 5th', 8: 'Minor 6th',
    9: 'Major 6th', 10: 'Minor 7th', 11: 'Major 7th',
  };
  return names[semitones] ?? '';
}

// ---------------------------------------------------------------------------
// Staff notation (五线谱)
// ---------------------------------------------------------------------------

/** Natural notes used in each drill stage, ordered low to high */
export const TREBLE_C4_NOTES = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4'] as const;

export const TREBLE_C5_NOTES = ['C5', 'D5', 'E5', 'F5', 'G5', 'A5', 'B5'] as const;

export const TREBLE_2OCT_NOTES = [
  ...TREBLE_C4_NOTES,
  ...TREBLE_C5_NOTES,
] as const;

export const BASS_C1_NOTES = ['C1', 'D1', 'E1', 'F1', 'G1', 'A1', 'B1'] as const;

export const BASS_C2_NOTES = ['C2', 'D2', 'E2', 'F2', 'G2', 'A2', 'B2'] as const;

export const COMBINED_C3_NOTES = ['C3', 'D3', 'E3', 'F3', 'G3', 'A3', 'B3'] as const;

export const BASS_2OCT_NOTES = [
  ...BASS_C2_NOTES,
  ...COMBINED_C3_NOTES,
] as const;

export const GRAND_STAFF_NOTES = [
  ...BASS_C2_NOTES,
  ...COMBINED_C3_NOTES,
  ...TREBLE_C4_NOTES,
  ...TREBLE_C5_NOTES,
] as const;

export const TREBLE_FREE_NOTES = [
  'A3', 'B3',
  'C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4',
  'C5', 'D5', 'E5', 'F5', 'G5', 'A5',
] as const;

export const BASS_FREE_NOTES = [
  ...BASS_C1_NOTES,
  ...BASS_C2_NOTES,
  ...COMBINED_C3_NOTES,
  'C4',
] as const;

export const COMBINED_FREE_NOTES = [
  ...BASS_C1_NOTES,
  ...BASS_C2_NOTES,
  ...COMBINED_C3_NOTES,
  'C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4',
  'C5', 'D5', 'E5', 'F5', 'G5', 'A5',
] as const;

/** Identifiers for each progressive drill stage */
export type DrillStage =
  | 'treble-c4'
  | 'treble-c5'
  | 'treble-c4c5'
  | 'bass-c2'
  | 'bass-c3'
  | 'bass-c2c3'
  | 'combined-grand';

/** Ordered sequence of stages from beginner to advanced */
export const DRILL_STAGE_ORDER: DrillStage[] = [
  'treble-c4',
  'treble-c5',
  'treble-c4c5',
  'bass-c2',
  'bass-c3',
  'bass-c2c3',
  'combined-grand',
];

/** Note pool for each stage */
export const DRILL_STAGE_NOTES: Record<DrillStage, readonly string[]> = {
  'treble-c4': TREBLE_C4_NOTES,
  'treble-c5': TREBLE_C5_NOTES,
  'treble-c4c5': TREBLE_2OCT_NOTES,
  'bass-c2': BASS_C2_NOTES,
  'bass-c3': COMBINED_C3_NOTES,
  'bass-c2c3': BASS_2OCT_NOTES,
  'combined-grand': GRAND_STAFF_NOTES,
};

/** Which clef to use for rendering a stage */
export function getClefForNote(_note: string, stage: DrillStage): 'treble' | 'bass' | 'grand' {
  if (stage.startsWith('bass-')) return 'bass';
  if (stage === 'combined-grand') return 'grand';
  return 'treble';
}

/** Per-note mastery state */
export interface NoteProgress {
  correctStreak: number;
  totalCorrect: number;
  totalAttempts: number;
  mastered: boolean;
}

/** Weighted random note selection: notes with lower streaks appear more often */
export function selectDrillNote(
  pool: readonly string[],
  progress: Record<string, NoteProgress>,
  lastNote?: string,
): string {
  const weights = pool.map((note) => {
    const p = progress[note];
    if (p?.mastered) return 0.3; // occasionally revisit mastered notes
    return Math.max(1, 3 - (p?.correctStreak ?? 0));
  });

  // Avoid repeating the same note twice in a row when pool size > 1
  if (pool.length > 1 && lastNote) {
    const idx = pool.indexOf(lastNote);
    if (idx !== -1) weights[idx] = 0;
  }

  const total = weights.reduce((a, b) => a + b, 0);
  let rand = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    rand -= weights[i];
    if (rand <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

/** Pick 2 wrong-answer distractors from the pool, preferring pitch-adjacent notes */
export function getDrillDistractors(
  correctNote: string,
  pool: readonly string[],
): string[] {
  const others = pool.filter((n) => n !== correctNote);
  // Sort by closeness in pool index (adjacent staff positions = harder distractors)
  const correctIdx = pool.indexOf(correctNote);
  const sorted = [...others].sort((a, b) => {
    const da = Math.abs(pool.indexOf(a) - correctIdx);
    const db = Math.abs(pool.indexOf(b) - correctIdx);
    return da - db;
  });
  // Take the 6 closest, shuffle, then pick 2 for variety
  const candidates = sorted.slice(0, Math.min(6, sorted.length));
  const shuffled = candidates.sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 2);
}

/** True when every note in the pool has been mastered */
export function isStageComplete(
  pool: readonly string[],
  progress: Record<string, NoteProgress>,
): boolean {
  return pool.every((note) => progress[note]?.mastered === true);
}

/** Apply a key signature to a single note (e.g. 'F4' in 'G' major → 'F#4') */
export function applyKeyToNote(note: string, key: string): string {
  if (key === 'C') return note;

  const scaleNotes = majorScaleNotes(key);
  if (scaleNotes.length === 0) return note;

  const pc = Note.pitchClass(note);
  const octave = /\d+$/.exec(note)?.[0] ?? '4';

  // Direct match in the scale (e.g. C, D, E in G major)
  const direct = scaleNotes.find((s) => Note.pitchClass(s) === pc);
  if (direct) return `${direct}${octave}`;

  // Try enharmonic match for notes that need accidentals (e.g. F → F# in G major)
  const enhanced = Note.enharmonic(pc);
  const match = scaleNotes.find((s) => Note.pitchClass(s) === Note.pitchClass(enhanced));
  if (match) return `${match}${octave}`;

  return note;
}

/** Apply a key signature to an entire note pool */
export function applyKeyToPool(
  pool: readonly string[],
  key: string,
): string[] {
  return pool.map((note) => applyKeyToNote(note, key));
}

// ---------------------------------------------------------------------------
// Random accidentals (变音记号) — for drill variation
// ---------------------------------------------------------------------------

/** Types of accidentals that can be randomly applied during drills */
export type AccidentalOption =
  | 'natural'
  | 'sharp'
  | 'flat'
  | 'natural-sign'
  | 'double-sharp'
  | 'double-flat';

/** Accidental options with i18n label keys for the multi-select UI */
export const ACCIDENTAL_OPTIONS: { value: AccidentalOption; labelKey: string }[] = [
  { value: 'natural', labelKey: 'staffNotation.accidentalNone' },
  { value: 'sharp', labelKey: 'staffNotation.accidentalSharp' },
  { value: 'flat', labelKey: 'staffNotation.accidentalFlat' },
  { value: 'natural-sign', labelKey: 'staffNotation.accidentalNaturalSign' },
  { value: 'double-sharp', labelKey: 'staffNotation.accidentalDoubleSharp' },
  { value: 'double-flat', labelKey: 'staffNotation.accidentalDoubleFlat' },
];

/**
 * Check whether a given accidental type can be applied to a note without
 * causing an enharmonic simplification that collides with a note already in
 * the pool (e.g. E♯ → F, B♯ → C, F♭ → E, C♭ → B).
 *
 * When this returns `false`, the note should be excluded from the question
 * pool when the user has NOT selected "不变音" (natural).
 */
export function isAccidentalApplicable(
  note: string,
  accidentalType: AccidentalOption,
  pool: readonly string[],
): boolean {
  if (accidentalType === 'natural') return true;

  const pc = Note.pitchClass(note);
  const hasAccidental = pc.includes('#') || pc.includes('b');

  // natural-sign only makes sense for notes that already carry an accidental
  if (accidentalType === 'natural-sign') return hasAccidental;

  // For sharp / flat / double-*: test whether the accidental actually changes
  // the note.  If applySpecificAccidental returns the same note (because the
  // enharmonic result collides with an existing pool note and the fallback
  // fires), the accidental is *not* applicable.
  const result = applySpecificAccidental(note, accidentalType, pool);
  return result !== note;
}

/**
 * Decide which accidental type (if any) should be applied to a note for the
 * current question, based on the user's multi-select configuration.
 *
 * This is the **decision** step — call it once per question so the correct
 * answer and all distractors share the same accidental type.
 *
 * @returns The chosen `AccidentalOption`, or `null` if the note should stay
 *          as-is (no extra accidental beyond the key signature).
 */
export function pickRandomAccidental(
  note: string,
  selectedAccidentals: AccidentalOption[],
  pool?: readonly string[],
): AccidentalOption | null {
  const accidentalTypes = selectedAccidentals.filter((a) => a !== 'natural');
  if (accidentalTypes.length === 0) return null;

  const includesNatural = selectedAccidentals.includes('natural');

  const pc = Note.pitchClass(note);
  const hasAccidental = pc.includes('#') || pc.includes('b');

  // Only keep types that make sense for this particular note
  let applicable = accidentalTypes.filter((type) => {
    if (type === 'natural-sign') return hasAccidental;
    return true;
  });

  // When the note pool is known, also exclude accidental types that would
  // produce an enharmonic simplification colliding with an existing pool note
  // (e.g. E♯→F, B♯→C with sharp; F♭→E, C♭→B with flat).
  if (pool) {
    applicable = applicable.filter((type) => isAccidentalApplicable(note, type, pool));
  }

  if (applicable.length === 0) return null;

  // When "不变音" is selected, ~35 % chance to apply an accidental.
  // When "不变音" is NOT selected, always apply an accidental.
  if (includesNatural && Math.random() > 0.35) return null;

  return applicable[Math.floor(Math.random() * applicable.length)];
}

/**
 * Apply a **specific** accidental type to a note.
 *
 * Use this together with {@link pickRandomAccidental} so the correct answer and
 * all distractors receive the same accidental treatment in a single question.
 *
 * All accidentals are applied relative to the **natural** pitch class (stripping
 * any alteration introduced by the key signature), matching real notation where
 * an accidental indicates the absolute alteration.
 */
export function applySpecificAccidental(
  note: string,
  type: AccidentalOption,
  existingPool?: readonly string[],
): string {
  if (type === 'natural') return note;

  const pc = Note.pitchClass(note); // e.g. 'F#' or 'C'
  const octave = /\d+$/.exec(note)?.[0] ?? '4';

  // Natural pitch class — strip any existing accidental (key signature)
  const naturalPC = pc[0]; // 'F#' → 'F', 'C' → 'C'
  const naturalIdx = chromaticIndex(naturalPC);

  let resultPc: string;
  switch (type) {
    case 'natural-sign':
      resultPc = naturalPC;
      break;
    case 'sharp':
      resultPc = CHROMATIC[(naturalIdx + 1) % 12];
      break;
    case 'flat': {
      const flatIdx = (naturalIdx + 11) % 12; // -1 mod 12
      const sharpPc = CHROMATIC[flatIdx];
      // Convert to flat notation when possible (e.g. D# → Eb)
      resultPc = sharpPc.includes('#') ? Note.enharmonic(sharpPc) : sharpPc;
      break;
    }
    case 'double-sharp':
      resultPc = `${naturalPC}##`;
      break;
    case 'double-flat':
      resultPc = `${naturalPC}bb`;
      break;
    default:
      return note;
  }

  const result = `${resultPc}${octave}`;

  // Avoid colliding with notes that are already in the pool
  if (existingPool && existingPool.includes(result)) return note;

  return result;
}

/**
 * Convenience wrapper: randomly pick and apply an accidental to a single note.
 *
 * Prefer {@link pickRandomAccidental} + {@link applySpecificAccidental} when
 * generating a question with distractors, so the same accidental type is used
 * for the correct answer and all wrong answers.
 */
export function applyRandomAccidental(
  note: string,
  selectedAccidentals: AccidentalOption[],
  existingPool?: readonly string[],
): string {
  const type = pickRandomAccidental(note, selectedAccidentals, existingPool);
  if (!type) return note;
  return applySpecificAccidental(note, type, existingPool);
}

/** Shuffle an array (Fisher-Yates, non-mutating) */
export function shuffleArray<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
