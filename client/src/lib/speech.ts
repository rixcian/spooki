import { useCallback, useEffect, useRef, useState } from 'react';

// Minimal typing for the Web Speech API (webkit-prefixed in Safari).
interface RecognitionResultList {
  length: number;
  [i: number]: { 0: { transcript: string } };
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { results: RecognitionResultList }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | undefined {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function joinTranscript(base: string, spoken: string): string {
  const said = spoken.trim();
  if (!said) return base;
  if (!base || /\s$/.test(base)) return base + said;
  return `${base} ${said}`;
}

const ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone access was denied.',
  'service-not-allowed': 'Speech recognition is not allowed here.',
  'no-speech': "Didn't catch that — try again.",
  network: 'Speech recognition needs a connection.',
};

/** Dictation into a text field: `onText` receives the field's full new value. */
export function useSpeechToText(getBase: () => string, onText: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const supported = typeof window !== 'undefined' && recognitionCtor() !== undefined;

  const stop = useCallback(() => rec.current?.stop(), []);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor || rec.current) return;
    const r = new Ctor();
    const base = getBase();
    r.lang = navigator.language || 'en-US';
    r.continuous = false;
    r.interimResults = true;
    r.onresult = (e) => {
      let spoken = '';
      for (let i = 0; i < e.results.length; i++) spoken += e.results[i][0].transcript;
      onText(joinTranscript(base, spoken));
    };
    r.onerror = (e) => {
      if (e.error !== 'aborted') setError(ERRORS[e.error] ?? `Dictation failed (${e.error}).`);
    };
    r.onend = () => {
      rec.current = null;
      setListening(false);
    };
    rec.current = r;
    setError(null);
    setListening(true);
    try {
      r.start();
    } catch {
      rec.current = null;
      setListening(false);
    }
  }, [getBase, onText]);

  useEffect(() => () => rec.current?.stop(), []);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(t);
  }, [error]);

  return { supported, listening, error, start, stop };
}
