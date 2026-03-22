import { useState, useCallback, useRef, useEffect } from 'react';

// TypeScript declarations for Web Speech API
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message?: string;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onstart: (() => void) | null;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognition;
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

export interface UseWebSpeechRecognitionOptions {
  language?: string;
  continuous?: boolean;
  silenceTimeoutMs?: number;
  onResult?: (transcript: string, isFinal: boolean) => void;
  onError?: (error: string) => void;
}

export interface UseWebSpeechRecognitionReturn {
  isListening: boolean;
  transcript: string;
  interimTranscript: string;
  isSupported: boolean;
  start: () => void;
  stop: () => void;
  error: string | null;
}

export function useWebSpeechRecognition(
  options: UseWebSpeechRecognitionOptions = {}
): UseWebSpeechRecognitionReturn {
  const {
    language = 'sv-SE',
    continuous = true,
    silenceTimeoutMs = 2500,
    onResult,
    onError,
  } = options;

  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const accumulatedRef = useRef('');
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isSupported = typeof window !== 'undefined' && 
    !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    clearSilenceTimer();
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    // Deliver accumulated transcript on stop
    const final = accumulatedRef.current.trim();
    if (final) {
      setTranscript(final);
      setInterimTranscript('');
      onResult?.(final, true);
    }
    accumulatedRef.current = '';
    setIsListening(false);
  }, [clearSilenceTimer, onResult]);

  const start = useCallback(() => {
    if (!isSupported) {
      const errorMsg = 'Voice control is not supported in this browser';
      setError(errorMsg);
      onError?.(errorMsg);
      return;
    }

    // Stop any existing recognition
    clearSilenceTimer();
    if (recognitionRef.current) {
      recognitionRef.current.abort();
    }
    accumulatedRef.current = '';

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.lang = language;
    recognition.continuous = continuous;
    recognition.interimResults = true;

    recognition.onstart = () => {
      setIsListening(true);
      setError(null);
      setTranscript('');
      setInterimTranscript('');
      accumulatedRef.current = '';
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      // Reset silence timer on any result
      clearSilenceTimer();

      let sessionFinal = '';
      let interim = '';

      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript;
        if (result.isFinal) {
          sessionFinal += text;
        } else {
          interim += text;
        }
      }

      // Accumulate all final results for the session
      if (sessionFinal) {
        accumulatedRef.current = sessionFinal;
      }

      const currentFull = (accumulatedRef.current + ' ' + interim).trim();
      setInterimTranscript(interim);
      onResult?.(currentFull, false);

      // Start silence timer — if no new results within timeout, auto-stop
      if (continuous && silenceTimeoutMs > 0) {
        silenceTimerRef.current = setTimeout(() => {
          // Auto-stop after silence
          if (recognitionRef.current) {
            recognitionRef.current.stop();
          }
        }, silenceTimeoutMs);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      let errorMessage = 'Ett fel uppstod vid röstinspelning';
      
      switch (event.error) {
        case 'not-allowed':
          errorMessage = 'Mikrofonåtkomst nekad. Tillåt mikrofonåtkomst i webbläsaren.';
          break;
        case 'no-speech':
          errorMessage = 'Inget tal detekterat. Försök igen.';
          break;
        case 'audio-capture':
          errorMessage = 'Ingen mikrofon hittades.';
          break;
        case 'network':
          errorMessage = 'Nätverksfel. Kontrollera din internetanslutning.';
          break;
        case 'aborted':
          // User aborted, not an error
          return;
      }

      setError(errorMessage);
      onError?.(errorMessage);
      setIsListening(false);
    };

    recognition.onend = () => {
      clearSilenceTimer();
      // Deliver accumulated transcript
      const final = accumulatedRef.current.trim();
      if (final) {
        setTranscript(final);
        setInterimTranscript('');
        onResult?.(final, true);
      }
      accumulatedRef.current = '';
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    
    try {
      recognition.start();
    } catch (e) {
      const errorMsg = 'Kunde inte starta röstinspelning';
      setError(errorMsg);
      onError?.(errorMsg);
    }
  }, [isSupported, language, continuous, silenceTimeoutMs, onResult, onError, clearSilenceTimer]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearSilenceTimer();
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, [clearSilenceTimer]);

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
