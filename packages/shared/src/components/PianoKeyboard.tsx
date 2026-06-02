/**
 * Interactive piano keyboard — configurable key range.
 * Data-driven by NoteLabel map from @ezmusic/shared theory.
 *
 * Supports two rendering modes:
 *   1. Full mode — labels, scale highlighting, tonic indicator (for note-solfege chapter)
 *   2. Simplified mode — no labels/inScaleSet → plain note-name keys (for drill training)
 */
import { useRef, useState, useEffect, useCallback } from 'react';
import { Tooltip, Typography } from 'antd';
import type { NoteLabel } from '../music/theory';

const { Text } = Typography;

// ---------------------------------------------------------------------------
// Piano key data model
// ---------------------------------------------------------------------------

interface PianoKey {
  note: string;          // scientific note, e.g. "C4"
  pitchClass: string;
  isBlack: boolean;
  whiteIndex?: number;   // position among all white keys (continuous across octaves)
  blackAfter?: number;   // white-key index this black key follows
}

/** Chromatic pitch classes in order */
const CHROMATIC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** White-key positions within a single octave's chromatic (0-indexed among whites) */
const WHITE_KEY_IN_OCTAVE: Record<string, number> = {
  C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6,
};

/** Parse scientific note name into [pitchClass, octave]. E.g. "C#4" → ["C#", 4] */
function parseNote(note: string): { pitchClass: string; octave: number } {
  const match = /^([A-G][#b]?)(\d+)$/.exec(note);
  if (!match) throw new Error(`Invalid note: ${note}`);
  return { pitchClass: match[1], octave: parseInt(match[2], 10) };
}

/** Normalize a pitch class to our CHROMATIC sharp form */
function normalizePC(pc: string): string {
  // Map flats to sharps
  const flatToSharp: Record<string, string> = { Bb: 'A#', Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#' };
  return flatToSharp[pc] ?? pc;
}

/** Generate all PianoKey entries between two notes (inclusive). */
function generatePianoKeys(fromNote: string, toNote: string): PianoKey[] {
  const from = parseNote(fromNote);
  const to = parseNote(toNote);

  const fromPC = normalizePC(from.pitchClass);
  const toPC = normalizePC(to.pitchClass);

  const fromChromaticIdx = from.octave * 12 + CHROMATIC.indexOf(fromPC);
  const toChromaticIdx = to.octave * 12 + CHROMATIC.indexOf(toPC);

  const keys: PianoKey[] = [];

  for (let ci = fromChromaticIdx; ci <= toChromaticIdx; ci++) {
    const octave = Math.floor(ci / 12);
    const pc = CHROMATIC[ci % 12];
    const note = `${pc}${octave}`;
    const isBlack = pc.includes('#');
    const whiteKeyPos = WHITE_KEY_IN_OCTAVE[pc];

    if (isBlack) {
      // blackAfter = the white key index of the preceding natural note
      const prevPC = CHROMATIC[(ci - 1) % 12];
      const prevOctave = Math.floor((ci - 1) / 12);
      const prevWhitePos = WHITE_KEY_IN_OCTAVE[prevPC];
      const blackAfter = (prevOctave - 4) * 7 + prevWhitePos;
      keys.push({ note, pitchClass: pc, isBlack: true, blackAfter });
    } else {
      const whiteIndex = (octave - 4) * 7 + whiteKeyPos!;
      keys.push({ note, pitchClass: pc, isBlack: false, whiteIndex });
    }
  }

  return keys;
}

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const WHITE_KEY_W = 52;
const WHITE_KEY_H = 180;
const BLACK_KEY_W = 32;
const BLACK_KEY_H = 112;

// ---------------------------------------------------------------------------
// Default range (C4–C5)
// ---------------------------------------------------------------------------

const DEFAULT_KEYS = generatePianoKeys('C4', 'C5');

// ---------------------------------------------------------------------------
// Highlight / active state type
// ---------------------------------------------------------------------------

export type KeyHighlightState = 'correct' | 'wrong' | 'reveal';

export interface KeyHighlight {
  note: string;
  state: KeyHighlightState;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface PianoKeyboardProps {
  /** Optional — solfège labels for each pitch class. When absent, simplified mode. */
  labels?: Map<string, NoteLabel>;
  /** Optional — fully-qualified active note, e.g. "C4". Purple highlight. */
  activeNote?: string;
  /** Optional — set of pitch classes in the current scale. When absent, all keys appear in-scale. */
  inScaleSet?: Set<string>;
  /** Called when a key is pressed */
  onKeyPress: (pitchClass: string, note: string) => void;
  /** Custom note range (inclusive). Defaults to C4–C5. */
  noteRange?: { min: string; max: string };
  /** Answer feedback highlights (drill mode). Applied on top of activeNote. */
  highlightKeys?: KeyHighlight[];
  /** Disable all key interactions */
  disabled?: boolean;
  /** Show pitch-class labels on keys (default true). Set false for blind training. */
  showNoteLabels?: boolean;
  /**
   * When true, the keyboard fills the available container width and scales
   * height proportionally. Useful for single-octave keyboards.
   */
  fillWidth?: boolean;
  /** Maximum keyboard height in px when fillWidth is active. No limit when unset. */
  maxHeight?: number;
}

// ---------------------------------------------------------------------------
// Color helper
// ---------------------------------------------------------------------------

function keyBg(
  isBlack: boolean,
  isActive: boolean,
  isTonic: boolean,
  inScale: boolean,
  hlState?: KeyHighlightState,
): { bg: string; border: string; textColor: string } {
  // Highlight states take precedence
  if (hlState === 'correct') return { bg: '#d1fae5', border: '#059669', textColor: '#065f46' };
  if (hlState === 'wrong')   return { bg: '#fee2e2', border: '#dc2626', textColor: '#991b1b' };
  if (hlState === 'reveal')  return { bg: '#ddd6fe', border: '#7c3aed', textColor: '#4c1d95' };

  if (isBlack) {
    if (isActive) return { bg: '#7c3aed', border: '#7c3aed', textColor: '#fff' };
    if (isTonic)  return { bg: '#5b21b6', border: '#5b21b6', textColor: '#fff' };
    return { bg: '#222', border: '#222', textColor: '#ccc' };
  }
  if (isActive) return { bg: '#ede9fe', border: '#7c3aed', textColor: '#7c3aed' };
  if (isTonic)  return { bg: '#f5f3ff', border: '#d0d0d0', textColor: '#555' };
  if (!inScale) return { bg: '#f9f9f9', border: '#d0d0d0', textColor: '#ccc' };
  return { bg: '#fff', border: '#d0d0d0', textColor: '#555' };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PianoKeyboard({
  labels,
  activeNote,
  inScaleSet,
  onKeyPress,
  noteRange,
  highlightKeys,
  disabled = false,
  showNoteLabels = true,
  fillWidth = false,
  maxHeight,
}: PianoKeyboardProps) {
  const keys = noteRange
    ? generatePianoKeys(noteRange.min, noteRange.max)
    : DEFAULT_KEYS;

  const whiteKeys = keys.filter((k) => !k.isBlack);
  const blackKeys = keys.filter((k) => k.isBlack);

  // Offset all positions so the leftmost white key starts at 0
  const minWhite = whiteKeys.length > 0 ? whiteKeys[0].whiteIndex! : 0;
  const naturalW = (whiteKeys.length > 0 ? whiteKeys[whiteKeys.length - 1].whiteIndex! - minWhite + 1 : 0) * WHITE_KEY_W;

  // Build highlight lookup
  const hlMap = new Map<string, KeyHighlightState>();
  if (highlightKeys) {
    for (const h of highlightKeys) {
      hlMap.set(h.note, h.state);
    }
  }

  const hasLabels = labels != null;
  const hasScale = inScaleSet != null;

  // -------------------------------------------------------------------------
  // fillWidth: measure container and scale to fit
  // -------------------------------------------------------------------------
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  const updateScale = useCallback(() => {
    if (!fillWidth || !containerRef.current) return;
    const availableW = containerRef.current.clientWidth;
    if (availableW > 0 && naturalW > 0) {
      let s = availableW / naturalW;
      // Cap by maxHeight if specified
      if (maxHeight && maxHeight > 0) {
        const heightBasedMax = maxHeight / WHITE_KEY_H;
        s = Math.min(s, heightBasedMax);
      }
      setScale(s);
    }
  }, [fillWidth, naturalW, maxHeight]);

  useEffect(() => {
    if (!fillWidth) {
      setScale(1);
      return;
    }
    updateScale();
    const observer = new ResizeObserver(() => {
      updateScale();
    });
    const el = containerRef.current;
    if (el) observer.observe(el);
    return () => observer.disconnect();
  }, [fillWidth, updateScale]);

  // Scaled dimensions
  const sWk = WHITE_KEY_W * scale;
  const sWkH = WHITE_KEY_H * scale;
  const sBkW = BLACK_KEY_W * scale;
  const sBkH = BLACK_KEY_H * scale;
  const totalW = naturalW * scale;
  // Font sizes scale proportionally, but cap at reasonable values
  const whiteFontSize = Math.round(12 * scale);
  const blackFontSize = Math.round(10 * scale);
  const solfegeWhite = Math.round(10 * scale);
  const solfegeBlack = Math.round(9 * scale);
  const tonicDotSize = Math.round(6 * scale);

  return (
    <div
      ref={containerRef}
      style={{ overflowX: fillWidth && scale > 1 ? 'hidden' : 'auto', paddingBottom: 8 }}
    >
      <div style={{ position: 'relative', width: totalW, height: sWkH, userSelect: 'none', margin: '0 auto' }}>
        {/* White keys */}
        {whiteKeys.map((k) => {
          const label = labels?.get(k.pitchClass);
          const isActive = k.note === activeNote;
          const isTonic = label?.isTonic ?? false;
          const inScale = hasScale ? inScaleSet!.has(k.pitchClass) : true;
          const hlState = hlMap.get(k.note);
          const { bg, border, textColor } = keyBg(false, isActive, isTonic, inScale, hlState);

          const displayFreq = k.note === 'C5'
            ? (label ? parseFloat((label.freq * 2).toFixed(2)) : undefined)
            : label?.freq;
          const tooltip = label
            ? `${k.pitchClass}  |  ${label.solfege}  |  ${displayFreq} Hz`
            : k.pitchClass;

          return (
            <Tooltip key={k.note} title={tooltip} placement="bottom" open={showNoteLabels ? undefined : false}>
              <div
                onMouseDown={() => {
                  if (!disabled) onKeyPress(k.pitchClass, k.note);
                }}
                style={{
                  position: 'absolute',
                  left: (k.whiteIndex! - minWhite) * sWk,
                  top: 0,
                  width: sWk - Math.max(2, 2 * scale),
                  height: sWkH,
                  background: bg,
                  border: `1px solid ${border}`,
                  borderRadius: `0 0 ${Math.round(8 * scale)}px ${Math.round(8 * scale)}px`,
                  cursor: disabled ? 'default' : 'pointer',
                  boxShadow: hlState === 'correct'
                    ? 'inset 0 -4px 0 #059669'
                    : hlState === 'wrong'
                      ? 'inset 0 -4px 0 #dc2626'
                      : isActive
                        ? 'inset 0 -4px 0 #7c3aed'
                        : 'inset 0 -4px 0 #bbb',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  paddingBottom: Math.round(10 * scale),
                  gap: Math.round(2 * scale),
                  zIndex: 1,
                  transition: 'background 0.1s',
                  opacity: disabled ? 0.7 : 1,
                }}
              >
                {hasLabels && label && inScale && (
                  <Text style={{ fontSize: solfegeWhite, color: isActive ? '#7c3aed' : '#aaa', lineHeight: 1 }}>
                    {label.solfege}
                  </Text>
                )}
                {showNoteLabels && (
                  <Text style={{
                    fontSize: whiteFontSize,
                    fontWeight: (isActive || hlState) ? 700 : 400,
                    color: textColor,
                    lineHeight: 1,
                  }}>
                    {k.pitchClass}
                  </Text>
                )}
                {hasLabels && isTonic && (
                  <div style={{ width: tonicDotSize, height: tonicDotSize, borderRadius: '50%', background: '#7c3aed', marginTop: 2 }} />
                )}
              </div>
            </Tooltip>
          );
        })}

        {/* Black keys */}
        {blackKeys.map((k) => {
          const label = labels?.get(k.pitchClass);
          const isActive = k.note === activeNote;
          const isTonic = label?.isTonic ?? false;
          const inScale = hasScale ? inScaleSet!.has(k.pitchClass) : true;
          const hlState = hlMap.get(k.note);
          const { bg, border: _border, textColor } = keyBg(true, isActive, isTonic, inScale, hlState);
          const left = (k.blackAfter! - minWhite + 1) * sWk - sBkW / 2 - 1;
          const tooltip = label
            ? `${k.pitchClass}  |  ${label.solfege}  |  ${label.freq} Hz`
            : k.pitchClass;

          return (
            <Tooltip key={k.note} title={tooltip} placement="top" open={showNoteLabels ? undefined : false}>
              <div
                onMouseDown={() => {
                  if (!disabled) onKeyPress(k.pitchClass, k.note);
                }}
                style={{
                  position: 'absolute',
                  left,
                  top: 0,
                  width: sBkW,
                  height: sBkH,
                  background: bg,
                  borderRadius: `0 0 ${Math.round(6 * scale)}px ${Math.round(6 * scale)}px`,
                  cursor: disabled ? 'default' : 'pointer',
                  zIndex: 2,
                  boxShadow: hlState
                    ? `0 4px 12px rgba(${hlState === 'correct' ? '5,150,105' : hlState === 'wrong' ? '220,38,38' : '124,58,237'},0.6)`
                    : isActive
                      ? '0 4px 12px rgba(124,58,237,0.6)'
                      : '2px 4px 6px rgba(0,0,0,0.5)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  paddingBottom: Math.round(8 * scale),
                  gap: Math.round(2 * scale),
                  transition: 'background 0.1s',
                  opacity: disabled ? 0.7 : 1,
                }}
              >
                {hasLabels && label && inScale && (
                  <Text style={{ fontSize: solfegeBlack, color: isActive ? '#fff' : '#999', lineHeight: 1 }}>
                    {label.solfege}
                  </Text>
                )}
                {showNoteLabels && (
                  <Text style={{
                    fontSize: blackFontSize,
                    color: textColor,
                    lineHeight: 1,
                  }}>
                    {k.pitchClass}
                  </Text>
                )}
              </div>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
