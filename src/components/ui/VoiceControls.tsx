import { Mic } from 'lucide-react';
import type { VoiceDictation } from '../../hooks/useVoiceDictation';
import { Button } from './Button';

/** Extra class for the dictated field: a violet ring while recording, so it's obvious it's live. */
export function voiceFieldClass(voice: VoiceDictation): string {
  return voice.isListening ? 'ring-2 ring-violet/60' : '';
}

/** The voice-note button: solid violet and pulsing while recording. Renders nothing in browsers without speech recognition. */
export function VoiceButton({ voice }: { voice: VoiceDictation }) {
  if (!voice.isSupported) return null;
  return (
    <Button
      variant={voice.isListening ? 'primary' : 'ghost'}
      aria-pressed={voice.isListening}
      className={voice.isListening ? 'ring-2 ring-violet/40 motion-safe:animate-pulse' : ''}
      onClick={voice.toggle}
    >
      <Mic className="h-4 w-4" aria-hidden />
      {voice.isListening ? 'Recording, tap to stop' : 'Voice note'}
    </Button>
  );
}

/** The "Recording…" status line while listening, and a clear message if the microphone is blocked. */
export function VoiceStatus({ voice }: { voice: VoiceDictation }) {
  return (
    <>
      {voice.isListening && (
        <p role="status" className="flex items-center gap-2 text-sm font-semibold text-violet">
          <span className="h-2.5 w-2.5 rounded-full bg-violet motion-safe:animate-pulse" aria-hidden />
          Recording. Speak now and your words appear above as you talk.
        </p>
      )}
      {voice.error && !voice.isListening && (
        <p role="alert" className="text-sm text-danger">
          {voice.error === 'not-allowed' || voice.error === 'service-not-allowed'
            ? 'Microphone access is blocked. Allow it in your browser\'s address bar, then try again.'
            : `Voice input stopped (${voice.error}). Try again.`}
        </p>
      )}
    </>
  );
}
