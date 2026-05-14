/**
 * Tone.js audio hook for the ezmusic shared package.
 * Provides note playback backed by a piano sampler.
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

const PIANO_SAMPLE_URLS = {
  A1: 'A1.mp3',
  A2: 'A2.mp3',
  A3: 'A3.mp3',
  A4: 'A4.mp3',
  C2: 'C2.mp3',
  C3: 'C3.mp3',
  C4: 'C4.mp3',
  C5: 'C5.mp3',
  C6: 'C6.mp3',
  'D#2': 'Ds2.mp3',
  'D#3': 'Ds3.mp3',
  'D#4': 'Ds4.mp3',
  'D#5': 'Ds5.mp3',
  'F#2': 'Fs2.mp3',
  'F#3': 'Fs3.mp3',
  'F#4': 'Fs4.mp3',
  'F#5': 'Fs5.mp3',
} as const;

export function useAudio(): UseAudioReturn {
  const samplerRef = useRef<import('tone').Sampler | null>(null);

  const ensureSampler = useCallback(async () => {
    const Tone = await getTone();
    await Tone.start();
    if (!samplerRef.current) {
      samplerRef.current = new Tone.Sampler({
        urls: PIANO_SAMPLE_URLS,
        baseUrl: 'https://tonejs.github.io/audio/salamander/',
        release: 1.4,
        volume: -3,
      }).toDestination();
      await Tone.loaded();
    }
    return samplerRef.current;
  }, []);

  const playFreq = useCallback(
    async (freq: number, duration = 1.0) => {
      const sampler = await ensureSampler();
      sampler.triggerAttackRelease(freq, duration);
    },
    [ensureSampler],
  );

  const playNote = useCallback(
    async (note: string, duration = 1.0) => {
      const sampler = await ensureSampler();
      sampler.triggerAttackRelease(note, duration);
    },
    [ensureSampler],
  );

  return { playFreq, playNote };
}
