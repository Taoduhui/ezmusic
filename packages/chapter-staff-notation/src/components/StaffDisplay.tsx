/**
 * StaffDisplay — renders a single note (or a set of notes) on a VexFlow staff.
 * Supports treble and bass clef, optional note highlighting.
 */
import { useEffect, useRef, useId } from 'react';
import { Factory } from 'vexflow';

export interface StaffDisplayProps {
  /** Scientific pitch name(s) to display, e.g. 'C4' or ['C4','E4','G4'] */
  notes: string | string[];
  clef: 'treble' | 'bass';
  noteDuration?: 'w' | 'h' | 'q';
  /** Note that should be drawn in the accent color (must be one of `notes`) */
  highlightNote?: string;
  /** Accent color for the highlighted note */
  accentColor?: string;
  /** Default note color */
  noteColor?: string;
  width?: number;
  height?: number;
}

/** Convert scientific note like 'C4' to VexFlow EasyScore format 'C4/w' */
function toEasyScore(note: string, duration = 'w'): string {
  return `${note}/${duration}`;
}

export default function StaffDisplay({
  notes,
  clef,
  noteDuration = 'w',
  highlightNote,
  accentColor = '#7c3aed',
  noteColor = '#2c2c2c',
  width = 240,
  height = 180,
}: StaffDisplayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // VexFlow needs a stable string DOM id — React 18's useId gives us one.
  const vfId = useId().replace(/:/g, '_');

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.innerHTML = '';

    // Ensure the element has the stable id so VexFlow can find it
    el.id = vfId;

    const noteArray = Array.isArray(notes) ? notes : [notes];
    if (noteArray.length === 0) return;

    try {
      const vf = new Factory({ renderer: { elementId: vfId, width, height } });
      const score = vf.EasyScore();

      // Y offset: leave enough room above the stave for ledger lines (C4 above bass staff, G5+ above treble)
      const yOffset = 50;
      const system = vf.System({ x: 10, y: yOffset, width: width - 20 });

      const staveNotes = score.notes(
        noteArray.map((n) => toEasyScore(n, noteDuration)).join(', '),
        { clef },
      );

      staveNotes.forEach((sn, i) => {
        const color = noteArray[i] === highlightNote ? accentColor : noteColor;
        sn.setStyle({ fillStyle: color, strokeStyle: color });
      });

      system
        .addStave({ voices: [score.voice(staveNotes)] })
        .addClef(clef);

      vf.draw();

      // Style the SVG for clean inline rendering
      const svg = el.querySelector('svg');
      if (svg) {
        svg.style.display = 'block';
        svg.style.margin = '0 auto';
      }
    } catch {
      // Silently ignore VexFlow render errors (e.g. during hot reload)
    }
  }, [notes, clef, noteDuration, highlightNote, accentColor, noteColor, width, height, vfId]);

  return <div ref={containerRef} style={{ lineHeight: 0, minHeight: height }} />;
}
