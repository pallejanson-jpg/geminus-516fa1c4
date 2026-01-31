import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Volume2, VolumeX, Sparkles, ArrowRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface OnboardingCompleteProps {
  script: string;
  isLoading: boolean;
  error: string | null;
  onStart: () => void;
}

const OnboardingComplete: React.FC<OnboardingCompleteProps> = ({
  script,
  isLoading,
  error,
  onStart,
}) => {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);

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

    if (isSpeaking) {
      speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(script);
    utterance.lang = 'en-US';
    utterance.rate = 0.95;
    utterance.pitch = 1;
    
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    
    setIsSpeaking(true);
    speechSynthesis.speak(utterance);
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-6">
        <div className="relative mb-6">
          <div className="absolute -inset-4 bg-primary/20 rounded-full blur-xl animate-pulse" />
          <div className="relative w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
        </div>
        <h2 className="text-xl font-semibold mb-2">Creating Your Welcome</h2>
        <p className="text-muted-foreground text-center">
          Our AI is personalizing your experience...
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
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 mb-4">
          <Sparkles className="w-6 h-6 text-primary" />
        </div>
        <h2 className="text-2xl font-bold mb-2">Your Personal Welcome</h2>
        <p className="text-muted-foreground">
          Here's what we've prepared for you
        </p>
      </div>

      {/* AI-generated script card */}
      <Card className="flex-1 mb-6 bg-muted/30">
        <CardContent className="p-5">
          <div className="prose prose-sm max-w-none text-foreground">
            {script.split('\n\n').map((paragraph, i) => (
              <p key={i} className={cn("mb-4 last:mb-0", i === 0 && "text-base font-medium")}>
                {paragraph}
              </p>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* TTS button */}
      {speechSupported && script && (
        <Button
          variant="outline"
          onClick={handleSpeak}
          className="mb-4"
        >
          {isSpeaking ? (
            <>
              <VolumeX className="w-4 h-4 mr-2" />
              Stop
            </>
          ) : (
            <>
              <Volume2 className="w-4 h-4 mr-2" />
              Listen
            </>
          )}
        </Button>
      )}

      {/* CTA */}
      <Button size="lg" onClick={onStart} className="w-full h-12">
        Start Exploring
        <ArrowRight className="w-4 h-4 ml-2" />
      </Button>
    </div>
  );
};

export default OnboardingComplete;
