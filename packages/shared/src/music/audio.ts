/**
 * Tone.js audio hook for the ezmusic shared package.
 * Provides note playback backed by a piano sampler.
 */
import { useEffect, useCallback } from 'react';

/** Lazily import tone so tree-shaking keeps it out of bundles that don't need it. */
let tonePromise: Promise<typeof import('tone')> | null = null;

async function getTone() {
  tonePromise ??= import('tone');
  return tonePromise;
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

function getLocalSampleBaseUrl() {
  if (typeof document === 'undefined') {
    return '/audio/salamander/';
  }

  return new URL('audio/salamander/', document.baseURI).toString();
}

let samplerPromise: Promise<import('tone').Sampler> | null = null;

async function loadSampler() {
  const Tone = await getTone();
  if (!samplerPromise) {
    const sampler = new Tone.Sampler({
      urls: PIANO_SAMPLE_URLS,
      baseUrl: getLocalSampleBaseUrl(),
      release: 1.4,
      volume: -3,
    }).toDestination();

    samplerPromise = Tone.loaded().then(() => sampler).catch((error) => {
      samplerPromise = null;
      throw error;
    });
  }

  return samplerPromise;
}

export function useAudio(): UseAudioReturn {
  const ensureSampler = useCallback(async () => {
    const Tone = await getTone();
    const sampler = await loadSampler();
    await Tone.start();
    return sampler;
  }, []);

  useEffect(() => {
    void loadSampler();
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
