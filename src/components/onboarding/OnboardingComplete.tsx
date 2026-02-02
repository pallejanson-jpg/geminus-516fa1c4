import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Volume2, VolumeX, Sparkles, ArrowRight, Loader2, Play, Pause, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import AudioVisualizer from './AudioVisualizer';

interface OnboardingCompleteProps {
  script: string;
  avatarImage: string | null;
  isLoading: boolean;
  error: string | null;
  onStart: () => void;
}

const OnboardingComplete: React.FC<OnboardingCompleteProps> = ({
  script,
  avatarImage,
  isLoading,
  error,
  onStart,
}) => {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [currentSentenceIndex, setCurrentSentenceIndex] = useState(-1);
  const [hasPlayed, setHasPlayed] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Split script into sentences for highlighting
  const sentences = useMemo(() => {
    if (!script) return [];
    // Split on sentence-ending punctuation, keeping the punctuation
    return script.match(/[^.!?]+[.!?]+/g)?.map(s => s.trim()) || [script];
  }, [script]);

  useEffect(() => {
    // Check if Web Speech API is supported
    setSpeechSupported('speechSynthesis' in window);
    
    // Cleanup on unmount
    return () => {
      if ('speechSynthesis' in window) {
        speechSynthesis.cancel();
      }
    };
  }, []);

  const handleSpeak = () => {
    if (!speechSupported || !script) return;

    if (isSpeaking && !isPaused) {
      // Pause
      speechSynthesis.pause();
      setIsPaused(true);
      return;
    }

    if (isPaused) {
      // Resume
      speechSynthesis.resume();
      setIsPaused(false);
      return;
    }

    // Start new speech
    speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(script);
    utterance.lang = 'en-US';
    utterance.rate = 0.95;
    utterance.pitch = 1;
    
    // Track sentence progress using character position
    let sentenceCharPositions: number[] = [];
    let charCount = 0;
    sentences.forEach((sentence) => {
      sentenceCharPositions.push(charCount);
      charCount += sentence.length + 1; // +1 for space between sentences
    });

    utterance.onboundary = (event) => {
      if (event.name === 'word' || event.name === 'sentence') {
        // Find which sentence we're in based on character index
        const charIndex = event.charIndex;
        for (let i = sentenceCharPositions.length - 1; i >= 0; i--) {
          if (charIndex >= sentenceCharPositions[i]) {
            setCurrentSentenceIndex(i);
            break;
          }
        }
      }
    };
    
    utterance.onstart = () => {
      setCurrentSentenceIndex(0);
      setHasPlayed(true);
    };
    
    utterance.onend = () => {
      setIsSpeaking(false);
      setIsPaused(false);
      setCurrentSentenceIndex(-1);
    };
    
    utterance.onerror = () => {
      setIsSpeaking(false);
      setIsPaused(false);
      setCurrentSentenceIndex(-1);
    };
    
    utteranceRef.current = utterance;
    setIsSpeaking(true);
    setIsPaused(false);
    speechSynthesis.speak(utterance);
  };

  const handleReplay = () => {
    speechSynthesis.cancel();
    setIsSpeaking(false);
    setIsPaused(false);
    setCurrentSentenceIndex(-1);
    // Small delay then restart
    setTimeout(() => {
      handleSpeak();
    }, 100);
  };

  const handleStop = () => {
    speechSynthesis.cancel();
    setIsSpeaking(false);
    setIsPaused(false);
    setCurrentSentenceIndex(-1);
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-6">
        <div className="relative mb-6">
          <div className="absolute -inset-4 bg-primary/20 rounded-full blur-xl animate-pulse" />
          <div className="relative w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
            <Loader2 className="w-10 h-10 text-primary animate-spin" />
          </div>
        </div>
        <h2 className="text-xl font-semibold mb-2">Creating Your Personal Guide</h2>
        <p className="text-muted-foreground text-center">
          Our AI is crafting a personalized welcome just for you...
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
        <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
          <Sparkles className="w-8 h-8 text-destructive" />
        </div>
        <h2 className="text-xl font-semibold mb-2">Something went wrong</h2>
        <p className="text-muted-foreground mb-6">{error}</p>
        <Button onClick={onStart}>
          Continue Anyway
          <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-[60vh] px-6 py-4">
      {/* Header */}
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold mb-2">Your AI Guide</h2>
        <p className="text-muted-foreground">
          Meet your personal onboarding assistant
        </p>
      </div>

      {/* Avatar Section */}
      <div className="flex flex-col items-center mb-6">
        <div className={cn(
          "relative w-32 h-32 rounded-full overflow-hidden mx-auto mb-4",
          isSpeaking && !isPaused && "animate-avatar-glow"
        )}>
          {avatarImage ? (
            <img 
              src={avatarImage} 
              alt="AI Guide" 
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-primary/20 to-primary/40 flex items-center justify-center">
              <Sparkles className="w-12 h-12 text-primary" />
            </div>
          )}
          
          {/* Speaking indicator overlay */}
          {isSpeaking && !isPaused && (
            <div className="absolute inset-0 bg-primary/10 animate-pulse pointer-events-none" />
          )}
        </div>

        {/* Audio Visualizer */}
        <AudioVisualizer 
          isActive={isSpeaking && !isPaused} 
          className="mb-4"
          barCount={7}
        />

        {/* Playback Controls */}
        {speechSupported && script && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSpeak}
              className="gap-2"
            >
              {isSpeaking && !isPaused ? (
                <>
                  <Pause className="w-4 h-4" />
                  Pause
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  {hasPlayed ? 'Resume' : 'Play'}
                </>
              )}
            </Button>
            
            {hasPlayed && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleReplay}
                className="gap-2"
              >
                <RotateCcw className="w-4 h-4" />
                Replay
              </Button>
            )}
            
            {isSpeaking && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleStop}
              >
                <VolumeX className="w-4 h-4" />
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Script with sentence highlighting */}
      <Card className="flex-1 mb-6 bg-muted/30 overflow-hidden">
        <CardContent className="p-5">
          <div className="prose prose-sm max-w-none">
            {sentences.map((sentence, i) => (
              <span 
                key={i}
                className={cn(
                  "transition-all duration-300",
                  currentSentenceIndex === i 
                    ? "text-primary font-medium bg-primary/10 px-1 -mx-1 rounded" 
                    : "text-foreground",
                  currentSentenceIndex > i && "text-muted-foreground"
                )}
              >
                {sentence}{' '}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* CTA */}
      <Button size="lg" onClick={onStart} className="w-full h-12">
        Start Exploring
        <ArrowRight className="w-4 h-4 ml-2" />
      </Button>
    </div>
  );
};

export default OnboardingComplete;
