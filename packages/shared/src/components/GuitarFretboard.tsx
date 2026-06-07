/**
 * Interactive guitar fretboard — 6 strings, 12 frets, standard tuning.
 * Data-driven, modeled after PianoKeyboard's API.
 *
 * Standard tuning (low to high): E2 A2 D3 G3 B3 E4
 * Visual layout: string 1 (high E) at TOP, string 6 (low E) at BOTTOM
 */
import { useMemo } from 'react';
import { Tooltip, Typography } from 'antd';
import type { KeyHighlight, KeyHighlightState } from './PianoKeyboard';

const { Text } = Typography;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Chromatic pitch classes in order */
const CHROMATIC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Standard guitar tuning: [stringName, baseNote] — from high (top) to low (bottom) */
const GUITAR_STRINGS: { name: string; baseNote: string }[] = [
  { name: '1弦 (E4)', baseNote: 'E4' },
  { name: '2弦 (B3)', baseNote: 'B3' },
  { name: '3弦 (G3)', baseNote: 'G3' },
  { name: '4弦 (D3)', baseNote: 'D3' },
  { name: '5弦 (A2)', baseNote: 'A2' },
  { name: '6弦 (E2)', baseNote: 'E2' },
];

/** Number of frets to display (0 = nut, 1–12 = frets) */
const FRET_COUNT = 24;

// Layout constants
const LEFT_PAD = 36; // space for open string labels / nut area
const FRET_W = 56;
const STRING_SPACING = 34;
const TOP_PAD = 32; // space for fret numbers
const BOTTOM_PAD = 16;
const RIGHT_PAD = 20;
const NOTE_RADIUS = 14;

// Total dimensions
const TOTAL_W = LEFT_PAD + FRET_COUNT * FRET_W + RIGHT_PAD;
const TOTAL_H = TOP_PAD + (GUITAR_STRINGS.length - 1) * STRING_SPACING + BOTTOM_PAD;

// ---------------------------------------------------------------------------
// Note calculation
// ---------------------------------------------------------------------------

/** Parse scientific note name into [pitchClass, octave] */
function parseNote(note: string): { pitchClass: string; octave: number } {
  const match = /^([A-G][#b]?)(\d+)$/.exec(note);
  if (!match) throw new Error(`Invalid note: ${note}`);
  return { pitchClass: match[1], octave: parseInt(match[2], 10) };
}

/** Normalize pitch class to sharp form */
function normalizePC(pc: string): string {
  const flatToSharp: Record<string, string> = {
    Bb: 'A#', Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#',
  };
  return flatToSharp[pc] ?? pc;
}

/** Get the note at a given string index and fret number */
function getFretNote(stringIdx: number, fret: number): string {
  const baseNote = GUITAR_STRINGS[stringIdx].baseNote;
  const { pitchClass, octave } = parseNote(baseNote);
  const pc = normalizePC(pitchClass);
  const baseIdx = CHROMATIC.indexOf(pc);
  if (baseIdx === -1) return baseNote;

  const totalIdx = baseIdx + fret;
  const newOctave = octave + Math.floor(totalIdx / 12);
  const newPC = CHROMATIC[totalIdx % 12];
  return `${newPC}${newOctave}`;
}

/** Get just the pitch class (no octave) */
function getFretPitchClass(stringIdx: number, fret: number): string {
  const note = getFretNote(stringIdx, fret);
  return parseNote(note).pitchClass;
}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

function noteBg(hlState?: KeyHighlightState): { bg: string; border: string; textColor: string } {
  if (hlState === 'correct') return { bg: '#d1fae5', border: '#059669', textColor: '#065f46' };
  if (hlState === 'wrong')   return { bg: '#fee2e2', border: '#dc2626', textColor: '#991b1b' };
  if (hlState === 'reveal')  return { bg: '#ddd6fe', border: '#7c3aed', textColor: '#4c1d95' };
  return { bg: '#fff', border: '#d0d0d0', textColor: '#555' };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GuitarFretboardProps {
  /** Called when a fret position is pressed */
  onKeyPress: (pitchClass: string, note: string) => void;
  /** Answer feedback highlights (drill mode) */
  highlightKeys?: KeyHighlight[];
  /** Disable all interactions */
  disabled?: boolean;
  /** Show note labels on fret positions (default true) */
  showNoteLabels?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function GuitarFretboard({
  onKeyPress,
  highlightKeys,
  disabled = false,
  showNoteLabels = true,
}: GuitarFretboardProps) {
  // Build highlight lookup
  const hlMap = useMemo(() => {
    const map = new Map<string, KeyHighlightState>();
    if (highlightKeys) {
      for (const h of highlightKeys) {
        map.set(h.note, h.state);
      }
    }
    return map;
  }, [highlightKeys]);

  // Precompute all fret positions
  const positions = useMemo(() => {
    const result: {
      stringIdx: number;
      fret: number;
      note: string;
      pitchClass: string;
      x: number;
      y: number;
    }[] = [];
    for (let si = 0; si < GUITAR_STRINGS.length; si++) {
      for (let f = 0; f <= FRET_COUNT; f++) {
        const note = getFretNote(si, f);
        const pitchClass = getFretPitchClass(si, f);
        // x: center of the fret space (between fret lines)
        const x = f === 0
          ? LEFT_PAD / 2 // nut position (open string)
          : LEFT_PAD + (f - 1) * FRET_W + FRET_W / 2;
        const y = TOP_PAD + si * STRING_SPACING;
        result.push({ stringIdx: si, fret: f, note, pitchClass, x, y });
      }
    }
    return result;
  }, []);

  // Fret line positions (vertical lines)
  const fretLines = useMemo(() => {
    const lines: { x: number; label: string }[] = [];
    // Nut (fret 0)
    lines.push({ x: LEFT_PAD, label: '' });
    for (let f = 1; f <= FRET_COUNT; f++) {
      const x = LEFT_PAD + f * FRET_W;
      lines.push({ x, label: `${f}` });
    }
    return lines;
  }, []);

  return (
    <div style={{ overflowX: 'auto', paddingBottom: 8 }}>
      <svg
        width={TOTAL_W}
        height={TOTAL_H}
        viewBox={`0 0 ${TOTAL_W} ${TOTAL_H}`}
        style={{ display: 'block', margin: '0 auto' }}
      >
        {/* Fretboard background */}
        <rect
          x={LEFT_PAD}
          y={TOP_PAD - 10}
          width={FRET_COUNT * FRET_W}
          height={(GUITAR_STRINGS.length - 1) * STRING_SPACING + 20}
          fill="#faf7f2"
          rx={4}
        />

        {/* Fret markers (dots at frets 3, 5, 7, 9, 12, 15, 17, 19, 21, 24) — rendered behind everything */}
        {[3, 5, 7, 9, 12, 15, 17, 19, 21, 24].map((fret) => {
          const x = LEFT_PAD + (fret - 1) * FRET_W + FRET_W / 2;
          // Single dot between strings 3–4; double dots between 1–2 and 5–6 for fret 12
          const midY = TOP_PAD + 2.5 * STRING_SPACING;
          const topY = TOP_PAD + 0.5 * STRING_SPACING;
          const botY = TOP_PAD + 4.5 * STRING_SPACING;
          return (
            <g key={`fretdot-${fret}`}>
              {fret !== 12 ? (
                <circle cx={x} cy={midY} r={5} fill="#e8e5df" />
              ) : (
                <>
                  <circle cx={x} cy={topY} r={5} fill="#e8e5df" />
                  <circle cx={x} cy={botY} r={5} fill="#e8e5df" />
                </>
              )}
            </g>
          );
        })}

        {/* Fret lines (vertical) */}
        {fretLines.map((fl, i) => (
          <g key={`fret-${i}`}>
            <line
              x1={fl.x}
              y1={TOP_PAD - 10}
              x2={fl.x}
              y2={TOP_PAD + (GUITAR_STRINGS.length - 1) * STRING_SPACING + 10}
              stroke={i === 0 ? '#555' : '#c0c0c0'}
              strokeWidth={i === 0 ? 3 : 1.5}
            />
            {/* Fret number label */}
            {fl.label && (
              <text
                x={fl.x}
                y={TOP_PAD - 14}
                textAnchor="middle"
                style={{ fontSize: 10, fill: '#999', userSelect: 'none' }}
              >
                {fl.label}
              </text>
            )}
          </g>
        ))}

        {/* String lines (horizontal) */}
        {GUITAR_STRINGS.map((s, si) => {
          const y = TOP_PAD + si * STRING_SPACING;
          const thickness = Math.max(1, 2.5 - si * 0.3); // thicker for low strings
          return (
            <line
              key={`string-${si}`}
              x1={LEFT_PAD - 8}
              y1={y}
              x2={LEFT_PAD + FRET_COUNT * FRET_W}
              y2={y}
              stroke="#bbb"
              strokeWidth={thickness}
            />
          );
        })}

        {/* String labels (open string notes) */}
        {GUITAR_STRINGS.map((s, si) => {
          const y = TOP_PAD + si * STRING_SPACING;
          return (
            <text
              key={`slabel-${si}`}
              x={LEFT_PAD / 2 - 2}
              y={y + 4}
              textAnchor="middle"
              style={{ fontSize: 10, fill: '#888', userSelect: 'none', fontWeight: 500 }}
            >
              {parseNote(s.baseNote).pitchClass}
            </text>
          );
        })}

        {/* Note positions (clickable circles) */}
        {positions.map((pos) => {
          const hlState = hlMap.get(pos.note);
          const { bg, border, textColor } = noteBg(hlState);

          return (
            <g
              key={`${pos.stringIdx}-${pos.fret}`}
              style={{ cursor: disabled ? 'default' : 'pointer' }}
              onClick={() => {
                if (!disabled) onKeyPress(pos.pitchClass, pos.note);
              }}
            >
              {/* Hit area (larger than visible circle for easier touch) */}
              <circle
                cx={pos.x}
                cy={pos.y}
                r={NOTE_RADIUS + 4}
                fill="transparent"
              />
              {/* Visible note circle */}
              <circle
                cx={pos.x}
                cy={pos.y}
                r={NOTE_RADIUS}
                fill={bg}
                stroke={border}
                strokeWidth={hlState ? 2 : 1.5}
                style={{ transition: 'all 0.15s' }}
              />
              {/* Note label */}
              {showNoteLabels && (
                <text
                  x={pos.x}
                  y={pos.y + 1}
                  textAnchor="middle"
                  dominantBaseline="central"
                  style={{
                    fontSize: 10,
                    fontWeight: hlState ? 700 : 500,
                    fill: textColor,
                    userSelect: 'none',
                    pointerEvents: 'none',
                  }}
                >
                  {pos.pitchClass}
                </text>
              )}
            </g>
          );
        })}

      </svg>
    </div>
  );
}
