import { useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface UseDeepgramSpeechRecognitionOptions {
  language?: string;
  continuous?: boolean;
  silenceTimeoutMs?: number;
  onResult?: (transcript: string, isFinal: boolean) => void;
  onError?: (error: string) => void;
}

export interface UseDeepgramSpeechRecognitionReturn {
  isListening: boolean;
  transcript: string;
  interimTranscript: string;
  isSupported: boolean;
  start: () => void;
  stop: () => void;
  error: string | null;
}

// Map language codes: "sv-SE" -> "sv", "en-US" -> "en", etc.
function mapLang(lang: string): string {
  return lang.split('-')[0] || 'sv';
}

export function useDeepgramSpeechRecognition(
  options: UseDeepgramSpeechRecognitionOptions = {}
): UseDeepgramSpeechRecognitionReturn {
  const {
    language = 'sv-SE',
    silenceTimeoutMs = 2500,
    onResult,
    onError,
  } = options;

  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const accumulatedRef = useRef('');
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isStoppingRef = useRef(false);

  // MediaRecorder + getUserMedia are available in all modern browsers
  const isSupported =
    typeof window !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined';

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const cleanup = useCallback(() => {
    clearSilenceTimer();
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try { mediaRecorderRef.current.stop(); } catch { /* ignore */ }
    }
    mediaRecorderRef.current = null;
    if (wsRef.current) {
      try { wsRef.current.close(); } catch { /* ignore */ }
    }
    wsRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
    }
    streamRef.current = null;
  }, [clearSilenceTimer]);

  const stop = useCallback(() => {
    if (isStoppingRef.current) return;
    isStoppingRef.current = true;

    cleanup();

    const final = accumulatedRef.current.trim();
    if (final) {
      setTranscript(final);
      setInterimTranscript('');
      onResult?.(final, true);
    }
    accumulatedRef.current = '';
    setIsListening(false);

    // Reset flag after a tick
    setTimeout(() => { isStoppingRef.current = false; }, 100);
  }, [cleanup, onResult]);

  const start = useCallback(async () => {
    if (!isSupported) {
      const msg = 'Mikrofon stöds inte i denna webbläsare';
      setError(msg);
      onError?.(msg);
      return;
    }

    // Clean up any previous session
    cleanup();
    accumulatedRef.current = '';
    setTranscript('');
    setInterimTranscript('');
    setError(null);

    try {
      // 1. Get temporary Deepgram key from edge function
      const { data: tokenData, error: tokenErr } = await supabase.functions.invoke(
        'deepgram-token',
        { method: 'POST', body: {} }
      );

      if (tokenErr || !tokenData?.key) {
        const msg = 'Kunde inte hämta Deepgram-token';
        setError(msg);
        onError?.(msg);
        return;
      }

      const dgKey = tokenData.key;
      const lang = mapLang(language);

      // 2. Get microphone stream
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // 3. Open WebSocket to Deepgram
      const wsUrl = `wss://api.deepgram.com/v1/listen?model=nova-2&language=${lang}&smart_format=true&interim_results=true&endpointing=300&vad_events=true`;
      const ws = new WebSocket(wsUrl, ['token', dgKey]);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsListening(true);
        setError(null);

        // 4. Start MediaRecorder and send chunks every 250ms
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm';

        const recorder = new MediaRecorder(stream, { mimeType });
        mediaRecorderRef.current = recorder;

        recorder.ondataavailable = (event) => {
          if (event.data.size > 0 && ws.readyState === WebSocket.OPEN) {
            ws.send(event.data);
          }
        };

        recorder.start(250); // 250ms chunks
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          if (msg.type === 'Results') {
            const alt = msg.channel?.alternatives?.[0];
            if (!alt) return;

            const text = alt.transcript || '';
            const isFinal = msg.is_final;

            clearSilenceTimer();

            if (isFinal && text) {
              // Append to accumulated
              accumulatedRef.current = accumulatedRef.current
                ? accumulatedRef.current + ' ' + text
                : text;
              setInterimTranscript('');
              onResult?.(accumulatedRef.current.trim(), false);
            } else if (text) {
              setInterimTranscript(text);
              const currentFull = (accumulatedRef.current + ' ' + text).trim();
              onResult?.(currentFull, false);
            }

            // Silence timeout — auto-stop after silence
            if (silenceTimeoutMs > 0) {
              silenceTimerRef.current = setTimeout(() => {
                stop();
              }, silenceTimeoutMs);
            }
          }
        } catch {
          // Ignore parse errors
        }
      };

      ws.onerror = () => {
        const msg = 'WebSocket-fel vid taligenkänning';
        setError(msg);
        onError?.(msg);
        cleanup();
        setIsListening(false);
      };

      ws.onclose = () => {
        // If not already stopping, deliver final transcript
        if (!isStoppingRef.current) {
          const final = accumulatedRef.current.trim();
          if (final) {
            setTranscript(final);
            setInterimTranscript('');
            onResult?.(final, true);
          }
          accumulatedRef.current = '';
          setIsListening(false);
        }
      };
    } catch (err: unknown) {
      const message =
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Mikrofonåtkomst nekad. Tillåt mikrofon i webbläsaren.'
          : 'Kunde inte starta röstinspelning';
      setError(message);
      onError?.(message);
      cleanup();
      setIsListening(false);
    }
  }, [isSupported, language, silenceTimeoutMs, onResult, onError, cleanup, clearSilenceTimer, stop]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    isListening,
    transcript,
    interimTranscript,
    isSupported,
    start,
    stop,
    error,
  };
}
