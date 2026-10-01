import { useRef } from 'react';
import { useSpeechRecognition } from './useSpeechRecognition';

/**
 * Dictation into a text field: live transcript while speaking, appended to whatever
 * was already typed (never replacing it). `value`/`onChange` are the field's own
 * state. One place for this behaviour so the Dream Agent, the note dialog and the
 * guided debrief all dictate identically.
 */
export function useVoiceDictation(value: string, onChange: (text: string) => void) {
  // What was already in the field when recording started; the transcript goes after it.
  const baseRef = useRef('');
  const { isSupported, isListening, error, start, stop } = useSpeechRecognition(
    (text) => onChange(baseRef.current ? `${baseRef.current.trimEnd()} ${text}` : text),
  );

  /** Starts recording, or stops it if already recording. */
  function toggle() {
    if (isListening) { stop(); return; }
    baseRef.current = value;
    start();
  }

  return { isSupported, isListening, error, toggle, stop };
}

export type VoiceDictation = ReturnType<typeof useVoiceDictation>;
