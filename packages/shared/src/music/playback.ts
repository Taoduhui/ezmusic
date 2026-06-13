/**
 * Playback sequencing utilities.
 *
 * Pure functions for building note-to-tonic walk sequences and async helpers
 * for playing them through the Tone.js sampler.
 */
import { Note } from 'tonal';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Natural notes of the C-major scale in stepwise order. */
const C_MAJOR_NATURALS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;

/** Default values. */
const DEFAULT_TONIC = 'C';
const DEFAULT_NOTE_DURATION = 0.4;
const DEFAULT_GAP_MS = 75;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TonicWalkOptions {
  /** Tonic pitch class (default: "C"). */
  tonic?: string;
  /** Duration per note in seconds (default: 0.4). */
  noteDuration?: number;
  /** Duration for the first (start) note in seconds (default: same as noteDuration). */
  startNoteDuration?: number;
  /** Gap between notes in milliseconds (default: 75). */
  gapMs?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/** Extract the natural root of a pitch class (strip accidentals). */
function naturalRoot(pc: string): string {
  return pc[0];
}

/** Parse octave from a scientific note name, defaulting to 4. */
function parseOctave(note: string): number {
  const m = /\d+$/.exec(note);
  return m ? parseInt(m[0], 10) : 4;
}

// ---------------------------------------------------------------------------
// Sequence builder
// ---------------------------------------------------------------------------

/**
 * Build a stepwise diatonic sequence from `startNote` to the nearest tonic.
 *
 * The sequence walks through the C-major natural notes, taking the shortest
 * path (fewest semitones / steps) back to the tonic.  The starting note is
 * always included as the first element.
 *
 * @example
 *   buildTonicWalkSequence('E4')         // → ['E4', 'D4', 'C4']
 *   buildTonicWalkSequence('G4')         // → ['G4', 'A4', 'B4', 'C5']
 *   buildTonicWalkSequence('C4')         // → ['C4']
 *   buildTonicWalkSequence('A4', 'G')    // → ['A4', 'B4', 'C5', 'D5', 'E5', 'F#5', 'G5']
 *
 * @param startNote - Scientific pitch notation, e.g. "E4", "G#3"
 * @param tonic     - Tonic pitch class, defaults to "C"
 * @returns Array of note names forming the walk, including start and tonic
 */
export function buildTonicWalkSequence(
  startNote: string,
  tonic: string = DEFAULT_TONIC,
): string[] {
  const startPc = Note.pitchClass(startNote);     // e.g. "E", "F#"
  const startOctave = parseOctave(startNote);

  const tonicPc = Note.pitchClass(tonic);          // e.g. "C"
  const tonicNatural = naturalRoot(tonicPc);       // e.g. "C"

  const startNatural = naturalRoot(startPc);

  const tonicIdx = C_MAJOR_NATURALS.indexOf(tonicNatural as typeof C_MAJOR_NATURALS[number]);
  const startIdx = C_MAJOR_NATURALS.indexOf(startNatural as typeof C_MAJOR_NATURALS[number]);

  // Non-diatonic starting note — just return the note itself
  if (startIdx === -1 || tonicIdx === -1) return [startNote];

  // Already at the tonic — nothing to walk
  if (startIdx === tonicIdx) return [startNote];

  // Count steps in each direction (mod 7)
  const stepsUp = (tonicIdx - startIdx + 7) % 7;   // e.g. G→C: (0-4+7)%7 = 3
  const stepsDown = (startIdx - tonicIdx + 7) % 7; // e.g. G→C: (4-0+7)%7 = 4

  const goUp = stepsUp <= stepsDown;

  const sequence: string[] = [];
  let idx = startIdx;
  let octave = startOctave;

  // Add the starting note
  sequence.push(`${C_MAJOR_NATURALS[idx]}${octave}`);

  // Walk stepwise to the tonic
  while (idx !== tonicIdx) {
    if (goUp) {
      idx = (idx + 1) % 7;
      if (idx === 0) octave++; // wrapped B → C
    } else {
      idx = (idx + 6) % 7;    // -1 mod 7
      if (idx === 6) octave--; // wrapped C → B
    }
    sequence.push(`${C_MAJOR_NATURALS[idx]}${octave}`);
  }

  return sequence;
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

/**
 * Play a tonic-walk sequence from `startNote` back to the tonic.
 *
 * This is an async helper that calls `playNote` for each step in the walk,
 * respecting the configured note duration and inter-note gap.
 *
 * @param playNote  - A note playback function (from `useAudio()`).
 * @param startNote - The starting note in scientific pitch notation.
 * @param options   - Optional overrides for tonic, duration, and gap.
 *
 * @example
 *   const { playNote } = useAudio();
 *   // On every answer, play E4 → D4 → C4
 *   await playTonicWalk(playNote, 'E4');
 */
export async function playTonicWalk(
  playNote: (note: string, duration?: number) => Promise<void>,
  startNote: string,
  options?: TonicWalkOptions,
): Promise<void> {
  const {
    tonic = DEFAULT_TONIC,
    noteDuration = DEFAULT_NOTE_DURATION,
    startNoteDuration = noteDuration,
    gapMs = DEFAULT_GAP_MS,
  } = options ?? {};

  const sequence = buildTonicWalkSequence(startNote, tonic);

  for (let i = 0; i < sequence.length; i++) {
    // First note uses startNoteDuration; subsequent notes use noteDuration.
    const dur = i === 0 ? startNoteDuration : noteDuration;
    // Note: playNote resolves immediately (it only schedules via Tone.js),
    // so we wait dur + gapMs before the next note to avoid overlap.
    await playNote(sequence[i], dur);
    if (i < sequence.length - 1) {
      await wait(dur * 1000 + gapMs);
    }
  }
}
