/**
 * Interactive guitar fretboard — 6 strings, 24 frets, standard tuning.
 * Data-driven, modeled after PianoKeyboard's API.
 *
 * Standard tuning (low to high): E2 A2 D3 G3 B3 E4
 * Visual layout: string 1 (high E) at TOP, string 6 (low E) at BOTTOM
 *
 * Each fret has a fixed width so that at most 5 frets fit on screen at once.
 * The fretboard scrolls horizontally to reach higher frets.
 * A dual-handle range slider selects the drill range (fretStart..fretEnd).
 */
import { useMemo, useRef, useEffect, useCallback, useState } from 'react';
import { Slider } from '../ui';
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

/** Fixed number of frets that fit on one screen */
const FRETS_PER_SCREEN = 5;

// Layout constants
const LEFT_PAD = 36;
const STRING_SPACING = 34;
const TOP_PAD = 32;
const BOTTOM_PAD = 16;
const RIGHT_PAD = 8;
const NOTE_RADIUS = 14;
/** Minimum fret width in px */
const MIN_FRET_W = 56;

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
  /** Leftmost fret in drill range (inclusive). Default 0. */
  fretStart?: number;
  /** Rightmost fret in drill range (inclusive). Default 12. */
  fretEnd?: number;
  /** Called when the user drags the range slider handles */
  onFretRangeChange?: (start: number, end: number) => void;
  /** Optional custom label for note positions (e.g. solfège). Falls back to scientific note name. */
  getNoteLabel?: (note: string) => string;
  /** Show the fret range slider above the fretboard (default true). */
  showRangeSlider?: boolean;
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
  getNoteLabel,
  showRangeSlider = true,
}: GuitarFretboardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sliderWrapRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  // Middle drag-handle state
  const [draggingRange, setDraggingRange] = useState(false);
  const dragStateRef = useRef({ startX: 0, origStart: 0, origEnd: 0 });

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

  // Clamp drill range — allow start == end (e.g. open-string only: 0–0)
  const clampedStart = Math.max(0, Math.min(fretStart, FRET_COUNT));
  const clampedEnd = Math.max(clampedStart, Math.min(fretEnd, FRET_COUNT));

  // Fixed fret width — exactly FRETS_PER_SCREEN fit the available width
  const availW = Math.max(containerWidth - LEFT_PAD - RIGHT_PAD, 200);
  const fretW = Math.max(availW / FRETS_PER_SCREEN, MIN_FRET_W);

  // SVG viewport covers all frets
  const svgW = LEFT_PAD + FRET_COUNT * fretW + RIGHT_PAD;

  // Auto-scroll so the drill range start is visible when fretStart changes
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || fretW <= 0) return;
    // Scroll so clampedStart is near the left edge
    const targetX = clampedStart > 0 ? LEFT_PAD + (clampedStart - 0.5) * fretW : 0;
    el.scrollTo({ left: targetX, behavior: 'smooth' });
  }, [clampedStart, fretW]);

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

  // Fret lines for all frets (0 = nut, 1..FRET_COUNT)
  const fretLines = useMemo(() => {
    const lines: { x: number; label: string; isNut: boolean }[] = [];
    // Nut
    lines.push({ x: LEFT_PAD, label: '', isNut: true });
    for (let f = 1; f <= FRET_COUNT; f++) {
      const x = LEFT_PAD + f * fretW;
      lines.push({ x, label: `${f}`, isNut: false });
    }
    return lines;
  }, [fretW]);

  // Note positions for all frets (0..FRET_COUNT)
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
        let x: number;
        if (f === 0) {
          x = LEFT_PAD / 2; // open string — left of nut
        } else {
          x = LEFT_PAD + (f - 0.5) * fretW; // center of fret f
        }
        const y = TOP_PAD + si * STRING_SPACING;
        result.push({ stringIdx: si, fret: f, note, pitchClass, x, y });
      }
    }
    return result;
  }, [fretW]);

  // Slider handlers
  const handleSliderChange = useCallback(
    (val: number[]) => {
      const [s, e] = val;
      onFretRangeChange?.(s, e);
    },
    [onFretRangeChange],
  );

  const maxSlider = FRET_COUNT;

  // ---- Middle range-drag handlers ----
  const handleRangeDragStart = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      dragStateRef.current = { startX: clientX, origStart: clampedStart, origEnd: clampedEnd };
      setDraggingRange(true);
    },
    [clampedStart, clampedEnd],
  );

  useEffect(() => {
    if (!draggingRange) return;

    const handleMove = (e: MouseEvent | TouchEvent) => {
      // Prevent page scroll on touch devices
      if ('touches' in e) e.preventDefault();
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const wrap = sliderWrapRef.current;
      if (!wrap) return;

      const rail = wrap.querySelector('[data-slider-rail]') as HTMLElement;
      if (!rail) return;

      const railRect = rail.getBoundingClientRect();
      // Cumulative pixel delta from the original drag-start position
      const totalPxDelta = clientX - dragStateRef.current.startX;
      const valueDelta = Math.round((totalPxDelta / railRect.width) * maxSlider);

      const rangeLen = dragStateRef.current.origEnd - dragStateRef.current.origStart;
      let newStart = dragStateRef.current.origStart + valueDelta;
      let newEnd = newStart + rangeLen;

      // Clamp to slider bounds
      if (newStart < 0) {
        newStart = 0;
        newEnd = rangeLen;
      }
      if (newEnd > maxSlider) {
        newEnd = maxSlider;
        newStart = maxSlider - rangeLen;
      }

      onFretRangeChange?.(newStart, newEnd);
    };

    const handleEnd = () => {
      setDraggingRange(false);
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleEnd);
    document.addEventListener('touchmove', handleMove, { passive: false });
    document.addEventListener('touchend', handleEnd);

    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleEnd);
      document.removeEventListener('touchmove', handleMove);
      document.removeEventListener('touchend', handleEnd);
    };
  }, [draggingRange, maxSlider, onFretRangeChange]);

  // Middle-handle position percentages — relative to the rail
  const rangeMidPercent = ((clampedStart + clampedEnd) / 2 / maxSlider) * 100;
  const rangeWidthPercent = ((clampedEnd - clampedStart) / maxSlider) * 100;

  return (
    <div ref={containerRef}>
      {/* Range slider — selects drill range (hidden when showRangeSlider=false) */}
      {showRangeSlider && (
      <div ref={sliderWrapRef} style={{ position: 'relative' }}>
        <div style={{ padding: '0 40px 8px' }}>
          <Slider
            range
            min={0}
            max={maxSlider}
            value={[clampedStart, clampedEnd]}
            onChange={handleSliderChange}
            style={{ margin: 0 }}
          />
        </div>

        {/* Overlay that matches the Slider's area */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 40,
            right: 40,
            bottom: 8,
            pointerEvents: 'none',
          }}
        >
          {/* Draggable range-grip — spans the selected range */}
          <div
            onMouseDown={handleRangeDragStart}
            onTouchStart={handleRangeDragStart}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: `${rangeMidPercent}%`,
              width: `${rangeWidthPercent}%`,
              transform: 'translateX(-50%)',
              cursor: 'grab',
              pointerEvents: 'auto',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            title="拖动整体移动范围"
          >
            {/* Visual grip pill */}
            <div
              style={{
                width: 28,
                height: 18,
                borderRadius: 9,
                background: draggingRange ? '#1677ff' : '#d9d9d9',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 2,
                transition: 'background 0.15s',
                boxShadow: draggingRange
                  ? '0 2px 6px rgba(22,119,255,0.35)'
                  : '0 1px 3px rgba(0,0,0,0.12)',
              }}
            >
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  style={{
                    width: 3,
                    height: 3,
                    borderRadius: '50%',
                    background: '#fff',
                    display: 'block',
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
      )}

      {/* Fretboard SVG — horizontally scrollable */}
      <div ref={scrollRef} style={{ overflowX: 'auto' }}>
        <svg
          width={svgW}
          height={TOTAL_H}
          viewBox={`0 0 ${svgW} ${TOTAL_H}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ display: 'block', minWidth: '100%' }}
        >
          {/* Fretboard background — full width */}
          <rect
            x={LEFT_PAD}
            y={TOP_PAD - 10}
            width={FRET_COUNT * fretW}
            height={(GUITAR_STRINGS.length - 1) * STRING_SPACING + 20}
            fill="#faf7f2"
            rx={4}
          />

          {/* Drill range highlight */}
          <rect
            x={clampedStart === 0 ? LEFT_PAD / 2 : LEFT_PAD + (clampedStart - 0.5) * fretW}
            y={TOP_PAD - 10}
            width={(clampedEnd - clampedStart) * fretW + (clampedStart === 0 ? LEFT_PAD / 2 : 0)}
            height={(GUITAR_STRINGS.length - 1) * STRING_SPACING + 20}
            fill="#fef3c7"
            rx={4}
          />

          {/* Fret markers (dots) — all */}
          {FRET_MARKERS.map((fret) => {
            const x = LEFT_PAD + (fret - 0.5) * fretW;
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

          {/* Fret lines (vertical) — all */}
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

          {/* String lines (horizontal) — full width */}
          {GUITAR_STRINGS.map((_str, si) => {
            const y = TOP_PAD + si * STRING_SPACING;
            const thickness = Math.max(1, 2.5 - si * 0.3);
            return (
              <line
                key={`string-${si}`}
                x1={LEFT_PAD - 8}
                y1={y}
                x2={LEFT_PAD + FRET_COUNT * fretW}
                y2={y}
                stroke="#bbb"
                strokeWidth={thickness}
              />
            );
          })}

          {/* String labels (open string notes) */}
          {GUITAR_STRINGS.map((_s, si) => {
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

          {/* String number labels — at the far right */}
          {GUITAR_STRINGS.map((_s, si) => {
            const y = TOP_PAD + si * STRING_SPACING;
            const rightX = LEFT_PAD + FRET_COUNT * fretW + RIGHT_PAD - 2;
            return (
              <text
                key={`strnum-${si}`}
                x={rightX + 2}
                y={y + 4}
                textAnchor="end"
                style={{ fontSize: 10, fill: '#999', userSelect: 'none', fontWeight: 500 }}
              >
                {si + 1}
              </text>
            );
          })}

          {/* Note positions (clickable circles) — all frets */}
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
                {/* Note label — custom renderer takes priority */}
                {(getNoteLabel || showNoteLabels) && (
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
                    {getNoteLabel ? getNoteLabel(pos.note) : pos.note}
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
