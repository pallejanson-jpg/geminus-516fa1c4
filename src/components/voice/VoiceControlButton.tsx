import React, { useState, useCallback, useEffect } from 'react';
import { Mic, MicOff, HelpCircle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useWebSpeechRecognition } from '@/hooks/useWebSpeechRecognition';
import { useVoiceCommands, VoiceCommandCallbacks } from '@/hooks/useVoiceCommands';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface VoiceControlButtonProps {
  callbacks?: VoiceCommandCallbacks;
  className?: string;
}

export default function VoiceControlButton({ 
  callbacks = {}, 
  className 
}: VoiceControlButtonProps) {
  const [feedback, setFeedback] = useState('');
  const [showHelpDialog, setShowHelpDialog] = useState(false);
  
  const { executeCommand, getAvailableCommands } = useVoiceCommands(callbacks);

  const handleResult = useCallback(
    (transcript: string, isFinal: boolean) => {
      if (isFinal && transcript.trim()) {
        const result = executeCommand(transcript);
        
        if (result.matched) {
          if (result.isHelpCommand) {
            setShowHelpDialog(true);
            setFeedback('');
          } else {
            setFeedback(result.feedback || 'Kommando utfört');
            // Clear feedback after 2 seconds
            setTimeout(() => setFeedback(''), 2000);
          }
        } else {
          toast.info(`Okänt kommando: "${transcript}"`, {
            description: 'Säg "hjälp" för att se tillgängliga kommandon',
          });
        }
      }
    },
    [executeCommand]
  );

  const handleError = useCallback((error: string) => {
    toast.error(error);
  }, []);

  const {
    isListening,
    interimTranscript,
    transcript,
    isSupported,
    start,
    stop,
  } = useWebSpeechRecognition({
    language: 'sv-SE',
    onResult: handleResult,
    onError: handleError,
  });

  const toggleListening = useCallback(() => {
    if (isListening) {
      stop();
    } else {
      start();
    }
  }, [isListening, start, stop]);

  // Clear interim transcript when not listening
  useEffect(() => {
    if (!isListening) {
      // Small delay to show final result
      const timer = setTimeout(() => {
        // Transcript stays visible briefly after recognition ends
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [isListening]);

  if (!isSupported) {
    return null; // Don't render if not supported
  }

  const displayText = interimTranscript || transcript;
  const commands = getAvailableCommands();

  // Group commands by category
  const commandsByCategory = commands.reduce((acc, cmd) => {
    if (!acc[cmd.category]) {
      acc[cmd.category] = [];
    }
    acc[cmd.category].push(cmd);
    return acc;
  }, {} as Record<string, typeof commands>);

  const categoryLabels: Record<string, string> = {
    navigation: 'Navigation',
    search: 'Sök',
    '3d': '3D-visare',
    assistant: 'Assistent',
    help: 'Hjälp',
  };

  return (
    <>
      <div className={cn(
        "fixed bottom-20 right-4 z-50 flex flex-col items-end gap-2",
        className
      )}>
        {/* Transcription popup */}
        {(isListening && displayText) && (
          <div className="bg-card border border-border rounded-lg px-3 py-2 text-sm shadow-lg max-w-[200px] animate-in fade-in slide-in-from-bottom-2">
            <p className="text-foreground italic">"{displayText}"</p>
          </div>
        )}

        {/* Feedback popup */}
        {feedback && !isListening && (
          <div className="bg-primary text-primary-foreground rounded-lg px-3 py-2 text-sm shadow-lg animate-in fade-in slide-in-from-bottom-2">
            ✓ {feedback}
          </div>
        )}

        {/* Listening indicator */}
        {isListening && !displayText && (
          <div className="bg-card border border-border rounded-lg px-3 py-2 text-sm shadow-lg animate-pulse">
            <p className="text-muted-foreground">Lyssnar...</p>
          </div>
        )}

        {/* Microphone button */}
        <Button
          onClick={toggleListening}
          size="lg"
          variant={isListening ? "destructive" : "default"}
          className={cn(
            "h-14 w-14 rounded-full shadow-lg transition-all",
            isListening && "animate-pulse"
          )}
          aria-label={isListening ? "Stoppa röststyrning" : "Starta röststyrning"}
        >
          {isListening ? (
            <MicOff className="h-6 w-6" />
          ) : (
            <Mic className="h-6 w-6" />
          )}
        </Button>

        {/* Help button (small, below mic) */}
        <Button
          onClick={() => setShowHelpDialog(true)}
          size="sm"
          variant="outline"
          className="h-8 w-8 rounded-full p-0"
          aria-label="Visa röstkommandon"
        >
          <HelpCircle className="h-4 w-4" />
        </Button>
      </div>

      {/* Help Dialog */}
      <Dialog open={showHelpDialog} onOpenChange={setShowHelpDialog}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mic className="h-5 w-5" />
              Röstkommandon
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4 mt-4">
            {Object.entries(commandsByCategory).map(([category, cmds]) => (
              <div key={category}>
                <h3 className="font-medium text-sm text-muted-foreground mb-2">
                  {categoryLabels[category] || category}
                </h3>
                <ul className="space-y-1">
                  {cmds.map((cmd, idx) => (
                    <li 
                      key={idx} 
                      className="text-sm py-1 px-2 rounded bg-muted/50"
                    >
                      {cmd.description}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="mt-4 pt-4 border-t text-xs text-muted-foreground">
            <p>Tryck på mikrofon-knappen och tala tydligt.</p>
            <p className="mt-1">Exempel: "Öppna portfolio" eller "Visa [byggnad] i 3D"</p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
