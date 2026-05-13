/**
 * Tone.js audio hook for the ezmusic shared package.
 * Provides a simple playNote function backed by a PolySynth.
 */
import { useRef, useCallback } from 'react';

/** Lazily import tone so tree-shaking keeps it out of bundles that don't need it. */
async function getTone() {
  return import('tone');
}

export interface UseAudioReturn {
  /**
   * Play a note by frequency (Hz).
   * Triggers AudioContext start on first user interaction automatically.
   */
  playFreq: (freq: number, duration?: number) => Promise<void>;
  /**
   * Play a note by scientific pitch notation, e.g. "C4", "G#4".
   */
  playNote: (note: string, duration?: number) => Promise<void>;
}

export function useAudio(): UseAudioReturn {
  const synthRef = useRef<import('tone').PolySynth | null>(null);

  const ensureSynth = useCallback(async () => {
    const Tone = await getTone();
    await Tone.start();
    if (!synthRef.current) {
      synthRef.current = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.02, decay: 0.1, sustain: 0.5, release: 1.0 },
        volume: -6,
      }).toDestination();
    }
    return synthRef.current;
  }, []);

  const playFreq = useCallback(
    async (freq: number, duration = 1.0) => {
      const synth = await ensureSynth();
      synth.triggerAttackRelease(freq, duration);
    },
    [ensureSynth],
  );

  const playNote = useCallback(
    async (note: string, duration = 1.0) => {
      const synth = await ensureSynth();
      synth.triggerAttackRelease(note, duration);
    },
    [ensureSynth],
  );

  return { playFreq, playNote };
}
