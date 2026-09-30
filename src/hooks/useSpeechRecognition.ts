import { useCallback, useEffect, useRef, useState } from 'react';

// Not in the standard TS DOM lib yet — Chrome/Edge/Safari ship a working
// implementation under one of these two global names.
interface SpeechRecognitionResultLike {
  results: { [index: number]: { [index: number]: { transcript: string } }; length: number };
}
interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionResultLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Wraps the browser's SpeechRecognition API (Web Speech API) — live, continuous
 * transcription with no backend, no per-use cost. `onResult` fires with the full
 * accumulated transcript text each time the browser reports a result; the caller
 * decides how to use it (e.g. append to a textarea). isSupported is false in any
 * browser without a working implementation — callers should hide/disable voice
 * input entirely rather than show a broken button.
 */
export function useSpeechRecognition(onResult: (text: string) => void) {
  const [isListening, setIsListening] = useState(false);
  /** Browser's SpeechRecognition error code (e.g. 'not-allowed' when the mic is blocked), or null. */
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const SpeechRecognitionCtor = getSpeechRecognition();
  const isSupported = SpeechRecognitionCtor !== null;

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  const start = useCallback(() => {
    if (!SpeechRecognitionCtor || isListening) return;
    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    // Interim results make words appear live while speaking; with this off the
    // browser only reports text after each pause, so nothing seems to happen.
    recognition.interimResults = true;
    recognition.lang = 'en-GB';
    recognition.onresult = (event) => {
      let transcript = '';
      for (let i = 0; i < event.results.length; i += 1) transcript += event.results[i][0].transcript;
      onResult(transcript);
    };
    // 'no-speech' / 'aborted' are routine (silence, or our own stop()) — only
    // surface errors the user can act on, like a blocked microphone.
    recognition.onerror = (event) => {
      if (event.error && event.error !== 'no-speech' && event.error !== 'aborted') setError(event.error);
      setIsListening(false);
    };
    recognition.onend = () => setIsListening(false);
    recognitionRef.current = recognition;
    setError(null);
    recognition.start();
    setIsListening(true);
  }, [SpeechRecognitionCtor, isListening, onResult]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
  }, []);

  return { isSupported, isListening, error, start, stop };
}
