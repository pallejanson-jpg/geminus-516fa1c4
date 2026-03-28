/**
 * Deepgram Aura TTS helper.
 * Calls the deepgram-tts edge function and returns an Audio element.
 * Falls back to browser speechSynthesis on error.
 */

let currentAudio: HTMLAudioElement | null = null;

export async function speakWithDeepgram(
  text: string,
  opts?: { model?: string; lang?: string; rate?: number }
): Promise<HTMLAudioElement> {
  // Stop any currently playing audio
  stopDeepgramAudio();

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  const response = await fetch(`${supabaseUrl}/functions/v1/deepgram-tts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify({
      text,
      model: opts?.model || 'aura-2-thalia-en',
    }),
  });

  if (!response.ok) {
    // Try to parse error for fallback hint
    let shouldFallback = false;
    try {
      const err = await response.json();
      shouldFallback = err.fallback === 'browser_tts';
    } catch { /* ignore */ }

    if (shouldFallback) {
      return fallbackBrowserTTS(text, opts?.lang, opts?.rate);
    }
    throw new Error(`Deepgram TTS failed: ${response.status}`);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);

  // Adjust playback rate if needed
  if (opts?.rate && opts.rate !== 1) {
    audio.playbackRate = opts.rate;
  }

  // Clean up object URL when done
  audio.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true });
  audio.addEventListener('error', () => URL.revokeObjectURL(url), { once: true });

  currentAudio = audio;
  return audio;
}

export function stopDeepgramAudio() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }
}

export function isDeepgramPlaying(): boolean {
  return currentAudio !== null && !currentAudio.paused;
}

/** Browser TTS fallback */
function fallbackBrowserTTS(text: string, lang?: string, rate?: number): Promise<HTMLAudioElement> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      // Return a dummy silent audio
      resolve(new Audio());
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang || 'sv-SE';
    utterance.rate = rate ?? 1;
    utterance.pitch = 1;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);

    // Return a dummy Audio so the caller has something to track
    // The actual playback is handled by speechSynthesis
    const dummy = new Audio();
    (dummy as any).__browserTTS = true;
    (dummy as any).__utterance = utterance;
    resolve(dummy);
  });
}
