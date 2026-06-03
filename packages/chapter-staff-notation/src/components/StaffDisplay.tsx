/**
 * StaffDisplay — renders note(s) on a VexFlow staff.
 * Supports treble, bass, and grand (both treble + bass) modes.
 */
import { useEffect, useRef, useId } from 'react';
import { Factory } from 'vexflow';

export interface StaffDisplayProps {
  /** Scientific pitch name(s) to display, e.g. 'C4' or ['C4','E4','G4'] */
  notes: string | string[];
  clef: 'treble' | 'bass' | 'grand';
  noteDuration?: 'w' | 'h' | 'q';
  /** Note that should be drawn in the accent color (must be one of `notes`) */
  highlightNote?: string;
  /** Accent color for the highlighted note */
  accentColor?: string;
  /** Default note color */
  noteColor?: string;
  /** Key signature (e.g. 'G', 'F', 'Bb'). 'C' or undefined = no accidentals. */
  keySignature?: string;
  width?: number;
  height?: number;
}

/** Convert scientific note like 'C4' to VexFlow EasyScore format 'C4/w' */
function toEasyScore(note: string, duration = 'w'): string {
  return `${note}/${duration}`;
}

/** Parse octave from a scientific note name (e.g. 'C4' → 4) */
function getOctave(note: string): number {
  return parseInt(note.slice(-1), 10);
}

export default function StaffDisplay({
  notes,
  clef,
  noteDuration = 'w',
  highlightNote,
  accentColor = '#7c3aed',
  noteColor = '#2c2c2c',
  keySignature,
  width = 240,
  height = 180,
}: StaffDisplayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const vfId = useId().replace(/:/g, '_');

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.innerHTML = '';

    el.id = vfId;

    const noteArray = Array.isArray(notes) ? notes : [notes];
    if (noteArray.length === 0) return;

    try {
      if (clef === 'grand') {
        // ── Grand staff: treble stave on top, bass stave below ──
        const trebleNotes = noteArray.filter((n) => getOctave(n) >= 4);
        const bassNotes = noteArray.filter((n) => getOctave(n) <= 3);

        // Generous height to accommodate ledger lines at both extremes:
        // C5/B5 up to 5 ledger lines above treble, C2 2 ledger lines below bass
        const grandHeight = Math.max(height, 370);
        const vf = new Factory({ renderer: { elementId: vfId, width, height: grandHeight } });
        const score = vf.EasyScore();

        const yTop = 90;   // leaves ~90px above treble for C5/B5 ledger lines
        const yBottom = 210; // leaves ~80px below bass for C2 ledger lines
        const staveWidth = width - 20;

        // Treble stave (top)
        if (trebleNotes.length > 0) {
          const systemTop = vf.System({ x: 10, y: yTop, width: staveWidth });
          const staveTopNotes = score.notes(
            trebleNotes.map((n) => toEasyScore(n, noteDuration)).join(', '),
            { clef: 'treble' },
          );
          staveTopNotes.forEach((sn, i) => {
            const color = trebleNotes[i] === highlightNote ? accentColor : noteColor;
            sn.setStyle({ fillStyle: color, strokeStyle: color });
          });
          const staveTop = systemTop
            .addStave({ voices: [score.voice(staveTopNotes)] })
            .addClef('treble');
          if (keySignature && keySignature !== 'C') {
            staveTop.addKeySignature(keySignature);
          }
        }

        // Bass stave (bottom)
        if (bassNotes.length > 0) {
          const systemBottom = vf.System({ x: 10, y: yBottom, width: staveWidth });
          const staveBotNotes = score.notes(
            bassNotes.map((n) => toEasyScore(n, noteDuration)).join(', '),
            { clef: 'bass' },
          );
          staveBotNotes.forEach((sn, i) => {
            const color = bassNotes[i] === highlightNote ? accentColor : noteColor;
            sn.setStyle({ fillStyle: color, strokeStyle: color });
          });
          const staveBottom = systemBottom
            .addStave({ voices: [score.voice(staveBotNotes)] })
            .addClef('bass');
          if (keySignature && keySignature !== 'C') {
            staveBottom.addKeySignature(keySignature);
          }
        }

        // If one stave has no notes, still render it empty with its clef
        if (trebleNotes.length === 0) {
          const systemTop = vf.System({ x: 10, y: yTop, width: staveWidth });
          const staveTop = systemTop.addStave({ voices: [] }).addClef('treble');
          if (keySignature && keySignature !== 'C') {
            staveTop.addKeySignature(keySignature);
          }
        }
        if (bassNotes.length === 0) {
          const systemBottom = vf.System({ x: 10, y: yBottom, width: staveWidth });
          const staveBottom = systemBottom.addStave({ voices: [] }).addClef('bass');
          if (keySignature && keySignature !== 'C') {
            staveBottom.addKeySignature(keySignature);
          }
        }

        vf.draw();

        const svg = el.querySelector('svg');
        if (svg) {
          svg.style.display = 'block';
          svg.style.margin = '0 auto';
        }
      } else {
        // ── Single stave (treble or bass) ──
        const vf = new Factory({ renderer: { elementId: vfId, width, height } });
        const score = vf.EasyScore();

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

        const stave = system
          .addStave({ voices: [score.voice(staveNotes)] })
          .addClef(clef);

        if (keySignature && keySignature !== 'C') {
          stave.addKeySignature(keySignature);
        }

        vf.draw();

        const svg = el.querySelector('svg');
        if (svg) {
          svg.style.display = 'block';
          svg.style.margin = '0 auto';
        }
      }
    } catch {
      // Silently ignore VexFlow render errors (e.g. during hot reload)
    }
  }, [notes, clef, noteDuration, highlightNote, accentColor, noteColor, keySignature, width, height, vfId]);

  return <div ref={containerRef} style={{ lineHeight: 0, minHeight: height }} />;
}
