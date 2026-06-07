/**
 * Interactive guitar fretboard — 6 strings, 24 frets, standard tuning.
 * Data-driven, modeled after PianoKeyboard's API.
 *
 * Standard tuning (low to high): E2 A2 D3 G3 B3 E4
 * Visual layout: string 1 (high E) at TOP, string 6 (low E) at BOTTOM
 *
 * The visible fret range is controlled by a dual-handle range slider.
 * The fretboard zooms so the selected range fills the available width.
 */
import { useMemo, useRef, useEffect, useCallback, useState } from 'react';
import { Slider } from 'antd';
import type { KeyHighlight, KeyHighlightState } from './PianoKeyboard';

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

/** Maximum fret number */
const FRET_COUNT = 24;

/** Minimum number of frets shown */
const MIN_VISIBLE_FRETS = 4;

// Layout constants (base values — actual FRET_W is dynamic)
const LEFT_PAD = 36;
const STRING_SPACING = 34;
const TOP_PAD = 32;
const BOTTOM_PAD = 16;
const RIGHT_PAD = 8;
const NOTE_RADIUS = 14;

// Total height (fixed)
const TOTAL_H = TOP_PAD + (GUITAR_STRINGS.length - 1) * STRING_SPACING + BOTTOM_PAD;

/** Fret marker positions (standard guitar inlay pattern) */
const FRET_MARKERS = [3, 5, 7, 9, 12, 15, 17, 19, 21, 24];

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
  /** Leftmost visible fret (inclusive). Default 0. */
  fretStart?: number;
  /** Rightmost visible fret (inclusive). Default 12. */
  fretEnd?: number;
  /** Called when the user drags the range slider handles */
  onFretRangeChange?: (start: number, end: number) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function GuitarFretboard({
  onKeyPress,
  highlightKeys,
  disabled = false,
  showNoteLabels = true,
  fretStart = 0,
  fretEnd = 12,
  onFretRangeChange,
}: GuitarFretboardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  // Measure container width
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Clamp range
  const clampedStart = Math.max(0, Math.min(fretStart, FRET_COUNT - MIN_VISIBLE_FRETS));
  const clampedEnd = Math.max(
    clampedStart + MIN_VISIBLE_FRETS,
    Math.min(fretEnd, FRET_COUNT),
  );

  const visibleFrets = clampedEnd - clampedStart;

  // Dynamic fret width based on container and visible range
  const availW = Math.max(containerWidth - LEFT_PAD - RIGHT_PAD, 200);
  const fretW = visibleFrets > 0 ? availW / visibleFrets : 56;

  // SVG viewport width
  const svgW = Math.max(LEFT_PAD + visibleFrets * fretW + RIGHT_PAD, 300);

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

  // Fret lines within the visible range
  const fretLines = useMemo(() => {
    const lines: { x: number; label: string; isNut: boolean }[] = [];
    // The line at the left edge
    if (clampedStart === 0) {
      lines.push({ x: LEFT_PAD, label: '', isNut: true });
    }
    for (let f = clampedStart + 1; f <= clampedEnd + 1; f++) {
      const idx = f - clampedStart; // 1-based index from left edge
      const x = LEFT_PAD + idx * fretW;
      lines.push({ x, label: f <= FRET_COUNT ? `${f}` : '', isNut: false });
    }
    return lines;
  }, [clampedStart, clampedEnd, fretW]);

  // Note positions
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
      for (let f = clampedStart; f <= clampedEnd; f++) {
        const note = getFretNote(si, f);
        const pitchClass = getFretPitchClass(si, f);
        let x: number;
        if (f === 0) {
          x = LEFT_PAD / 2; // open string — left of nut
        } else {
          const idx = f - clampedStart; // 1-based
          x = LEFT_PAD + (idx - 0.5) * fretW;
        }
        const y = TOP_PAD + si * STRING_SPACING;
        result.push({ stringIdx: si, fret: f, note, pitchClass, x, y });
      }
    }
    return result;
  }, [clampedStart, clampedEnd, fretW]);

  // Slider handlers
  const handleSliderChange = useCallback(
    (val: number[]) => {
      const [s, e] = val;
      onFretRangeChange?.(s, e);
    },
    [onFretRangeChange],
  );

  const maxSlider = FRET_COUNT;

  return (
    <div ref={containerRef}>
      {/* Range slider */}
      <div style={{ padding: '0 40px 8px' }}>
        <Slider
          range
          min={0}
          max={maxSlider}
          value={[clampedStart, clampedEnd]}
          onChange={handleSliderChange}
          tooltip={{
            formatter: (v) => (v === 0 ? '空弦' : `品 ${v}`),
          }}
          style={{ margin: 0 }}
        />
      </div>

      {/* Fretboard SVG */}
      <div style={{ overflowX: 'hidden' }}>
        <svg
          width="100%"
          height={TOTAL_H}
          viewBox={`0 0 ${svgW} ${TOTAL_H}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ display: 'block' }}
        >
          {/* Fretboard background */}
          <rect
            x={LEFT_PAD}
            y={TOP_PAD - 10}
            width={visibleFrets * fretW}
            height={(GUITAR_STRINGS.length - 1) * STRING_SPACING + 20}
            fill="#faf7f2"
            rx={4}
          />

          {/* Fret markers (dots) — only those within visible range */}
          {FRET_MARKERS.filter((f) => f >= clampedStart && f <= clampedEnd).map((fret) => {
            const idx = fret - clampedStart;
            const x = LEFT_PAD + (idx - 0.5) * fretW; // center of fret f
            const midY = TOP_PAD + 2.5 * STRING_SPACING;
            const topY = TOP_PAD + 0.5 * STRING_SPACING;
            const botY = TOP_PAD + 4.5 * STRING_SPACING;
            const dotR = Math.min(5, fretW * 0.09);
            return (
              <g key={`fretdot-${fret}`}>
                {fret !== 12 ? (
                  <circle cx={x} cy={midY} r={dotR} fill="#e8e5df" />
                ) : (
                  <>
                    <circle cx={x} cy={topY} r={dotR} fill="#e8e5df" />
                    <circle cx={x} cy={botY} r={dotR} fill="#e8e5df" />
                  </>
                )}
              </g>
            );
          })}

          {/* Fret lines (vertical) */}
          {fretLines.map((fl, i) => (
            <g key={`fretline-${i}`}>
              <line
                x1={fl.x}
                y1={TOP_PAD - 10}
                x2={fl.x}
                y2={TOP_PAD + (GUITAR_STRINGS.length - 1) * STRING_SPACING + 10}
                stroke={fl.isNut ? '#555' : '#c0c0c0'}
                strokeWidth={fl.isNut ? 3 : 1.5}
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
          {GUITAR_STRINGS.map((_str, si) => {
            const y = TOP_PAD + si * STRING_SPACING;
            const thickness = Math.max(1, 2.5 - si * 0.3);
            return (
              <line
                key={`string-${si}`}
                x1={LEFT_PAD - 8}
                y1={y}
                x2={LEFT_PAD + visibleFrets * fretW}
                y2={y}
                stroke="#bbb"
                strokeWidth={thickness}
              />
            );
          })}

          {/* String labels (open string notes) — only when start = 0 */}
          {clampedStart === 0 &&
            GUITAR_STRINGS.map((_s, si) => {
              const y = TOP_PAD + si * STRING_SPACING;
              return (
                <text
                  key={`slabel-${si}`}
                  x={LEFT_PAD / 2 - 2}
                  y={y + 4}
                  textAnchor="middle"
                  style={{ fontSize: 10, fill: '#888', userSelect: 'none', fontWeight: 500 }}
                >
                  {parseNote(_s.baseNote).pitchClass}
                </text>
              );
            })}

          {/* Note positions (clickable circles) */}
          {positions.map((pos) => {
            const hlState = hlMap.get(pos.note);
            const { bg, border, textColor } = noteBg(hlState);
            const r = Math.min(NOTE_RADIUS, fretW * 0.25);

            return (
              <g
                key={`${pos.stringIdx}-${pos.fret}`}
                style={{ cursor: disabled ? 'default' : 'pointer' }}
                onClick={() => {
                  if (!disabled) onKeyPress(pos.pitchClass, pos.note);
                }}
              >
                {/* Hit area */}
                <circle cx={pos.x} cy={pos.y} r={r + 4} fill="transparent" />
                {/* Visible note circle */}
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={r}
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
                      fontSize: Math.max(8, Math.min(10, fretW * 0.18)),
                      fontWeight: hlState ? 700 : 500,
                      fill: textColor,
                      userSelect: 'none',
                      pointerEvents: 'none',
                    }}
                  >
                    {pos.note}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
