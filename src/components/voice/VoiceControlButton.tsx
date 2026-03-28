import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Mic, MicOff, HelpCircle, Move, X, GripHorizontal, Minimize2, Maximize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useDeepgramSpeechRecognition as useWebSpeechRecognition } from '@/hooks/useDeepgramSpeechRecognition';
import { useVoiceCommands, VoiceCommandCallbacks } from '@/hooks/useVoiceCommands';
import { toast } from 'sonner';

const BUTTON_SIZE = 56;
const POSITION_KEY = 'voice-control-position';

interface VoiceControlButtonProps {
  callbacks?: VoiceCommandCallbacks;
  className?: string;
}

function loadPosition(): { x: number; y: number } | null {
  try {
    const stored = localStorage.getItem(POSITION_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch { return null; }
}

function savePosition(pos: { x: number; y: number }) {
  localStorage.setItem(POSITION_KEY, JSON.stringify(pos));
}

export default function VoiceControlButton({ 
  callbacks = {}, 
  className 
}: VoiceControlButtonProps) {
  const [feedback, setFeedback] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  
  // Draggable trigger button
  const [triggerPosition, setTriggerPosition] = useState<{ x: number; y: number } | null>(null);
  const [isTriggerDragging, setIsTriggerDragging] = useState(false);
  const triggerDragOffsetRef = useRef({ x: 0, y: 0 });
  const triggerDragStartRef = useRef({ x: 0, y: 0 });
  const wasDraggedRef = useRef(false);

  // Panel state
  const [panelPos, setPanelPos] = useState({ x: -1, y: -1 });
  const [isPanelDragging, setIsPanelDragging] = useState(false);
  const panelDragOffsetRef = useRef({ x: 0, y: 0 });

  const { executeCommand, getAvailableCommands } = useVoiceCommands(callbacks);

  // Transcript history for panel
  const [history, setHistory] = useState<Array<{ text: string; matched: boolean; feedback?: string }>>([]);

  const handleResult = useCallback(
    (transcript: string, isFinal: boolean) => {
      if (isFinal && transcript.trim()) {
        const result = executeCommand(transcript);
        
        setHistory(h => [...h.slice(-19), { 
          text: transcript, 
          matched: result.matched, 
          feedback: result.feedback 
        }]);

        if (result.matched) {
          setFeedback(result.feedback || 'Kommando utfört');
          setTimeout(() => setFeedback(''), 2000);
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
    if (isListening) stop(); else start();
  }, [isListening, start, stop]);

  // Load saved position
  useEffect(() => {
    const saved = loadPosition();
    if (saved) {
      const maxX = window.innerWidth - BUTTON_SIZE;
      const maxY = window.innerHeight - BUTTON_SIZE;
      setTriggerPosition({ x: Math.max(0, Math.min(saved.x, maxX)), y: Math.max(0, Math.min(saved.y, maxY)) });
    }
  }, []);

  // Init panel position
  useEffect(() => {
    if (isOpen && panelPos.x === -1) {
      setPanelPos({ x: window.innerWidth - 420, y: window.innerHeight - 500 });
    }
  }, [isOpen, panelPos.x]);

  // Trigger drag handlers
  const handleTriggerDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const cx = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const cy = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const curX = triggerPosition?.x ?? (window.innerWidth - 80);
    const curY = triggerPosition?.y ?? (window.innerHeight - 160);
    triggerDragOffsetRef.current = { x: cx - curX, y: cy - curY };
    triggerDragStartRef.current = { x: cx, y: cy };
    wasDraggedRef.current = false;
    setIsTriggerDragging(true);
  }, [triggerPosition]);

  const handleTriggerDragMove = useCallback((e: MouseEvent | TouchEvent) => {
    if (!isTriggerDragging) return;
    const cx = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const cy = 'touches' in e ? e.touches[0].clientY : e.clientY;
    if (Math.abs(cx - triggerDragStartRef.current.x) > 5 || Math.abs(cy - triggerDragStartRef.current.y) > 5) {
      wasDraggedRef.current = true;
    }
    setTriggerPosition({
      x: Math.max(0, Math.min(cx - triggerDragOffsetRef.current.x, window.innerWidth - BUTTON_SIZE)),
      y: Math.max(0, Math.min(cy - triggerDragOffsetRef.current.y, window.innerHeight - BUTTON_SIZE)),
    });
  }, [isTriggerDragging]);

  const handleTriggerDragEnd = useCallback(() => {
    setIsTriggerDragging(false);
    if (wasDraggedRef.current && triggerPosition) savePosition(triggerPosition);
  }, [triggerPosition]);

  // Panel drag
  const handlePanelDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    setIsPanelDragging(true);
    const cx = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const cy = 'touches' in e ? e.touches[0].clientY : e.clientY;
    panelDragOffsetRef.current = { x: cx - panelPos.x, y: cy - panelPos.y };
  }, [panelPos]);

  const handlePanelDragMove = useCallback((e: MouseEvent | TouchEvent) => {
    if (!isPanelDragging) return;
    const cx = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const cy = 'touches' in e ? e.touches[0].clientY : e.clientY;
    setPanelPos({
      x: Math.max(0, Math.min(cx - panelDragOffsetRef.current.x, window.innerWidth - 380)),
      y: Math.max(0, Math.min(cy - panelDragOffsetRef.current.y, window.innerHeight - 50)),
    });
  }, [isPanelDragging]);

  const handlePanelDragEnd = useCallback(() => setIsPanelDragging(false), []);

  // Global listeners for trigger drag
  useEffect(() => {
    if (!isTriggerDragging) return;
    window.addEventListener('mousemove', handleTriggerDragMove);
    window.addEventListener('mouseup', handleTriggerDragEnd);
    window.addEventListener('touchmove', handleTriggerDragMove);
    window.addEventListener('touchend', handleTriggerDragEnd);
    return () => {
      window.removeEventListener('mousemove', handleTriggerDragMove);
      window.removeEventListener('mouseup', handleTriggerDragEnd);
      window.removeEventListener('touchmove', handleTriggerDragMove);
      window.removeEventListener('touchend', handleTriggerDragEnd);
    };
  }, [isTriggerDragging, handleTriggerDragMove, handleTriggerDragEnd]);

  // Global listeners for panel drag
  useEffect(() => {
    if (!isPanelDragging) return;
    window.addEventListener('mousemove', handlePanelDragMove);
    window.addEventListener('mouseup', handlePanelDragEnd);
    window.addEventListener('touchmove', handlePanelDragMove);
    window.addEventListener('touchend', handlePanelDragEnd);
    return () => {
      window.removeEventListener('mousemove', handlePanelDragMove);
      window.removeEventListener('mouseup', handlePanelDragEnd);
      window.removeEventListener('touchmove', handlePanelDragMove);
      window.removeEventListener('touchend', handlePanelDragEnd);
    };
  }, [isPanelDragging, handlePanelDragMove, handlePanelDragEnd]);

  if (!isSupported) return null;

  const displayText = interimTranscript || transcript;
  const commands = getAvailableCommands();
  const commandsByCategory = commands.reduce((acc, cmd) => {
    if (!acc[cmd.category]) acc[cmd.category] = [];
    acc[cmd.category].push(cmd);
    return acc;
  }, {} as Record<string, typeof commands>);

  const categoryLabels: Record<string, string> = {
    navigation: 'Navigation',
    search: 'Search',
    '3d': '3D Viewer',
    viewer: 'Viewer',
    assistant: 'Assistant',
    help: 'Help',
  };

  const triggerStyle = triggerPosition ? {
    left: triggerPosition.x,
    top: triggerPosition.y,
    bottom: 'auto',
    right: 'auto',
  } : {};

  const handleTriggerClick = () => {
    if (!wasDraggedRef.current) {
      setIsOpen(true);
      setIsMinimized(false);
    }
    wasDraggedRef.current = false;
  };

  return (
    <TooltipProvider>
      {/* Floating trigger button — draggable */}
      <div
        className={cn("fixed z-50", !triggerPosition && "right-4", className)}
        style={triggerPosition ? triggerStyle : { bottom: 'calc(env(safe-area-inset-bottom, 0px) + 160px)' }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="relative">
              <Button
                onClick={handleTriggerClick}
                onMouseDown={handleTriggerDragStart}
                onTouchStart={handleTriggerDragStart}
                size="lg"
                className={cn(
                  "h-12 w-12 rounded-full shadow-lg sm:h-14 sm:w-14",
                  "bg-gradient-to-br from-violet-500 to-purple-600 hover:from-violet-500/90 hover:to-purple-600/90",
                  "transition-all duration-300 hover:scale-105 hover:shadow-xl",
                  isOpen && "opacity-0 pointer-events-none",
                  isTriggerDragging && "cursor-grabbing scale-110",
                  isListening && "ring-2 ring-destructive ring-offset-2 ring-offset-background animate-pulse"
                )}
              >
                {isListening ? <MicOff className="h-5 w-5 sm:h-6 sm:w-6 text-white" /> : <Mic className="h-5 w-5 sm:h-6 sm:w-6 text-white" />}
              </Button>
              {!isOpen && (
                <div className="absolute -bottom-0.5 -right-0.5 h-4 w-4 bg-muted/80 rounded-full flex items-center justify-center pointer-events-none">
                  <Move className="h-2.5 w-2.5 text-muted-foreground" />
                </div>
              )}
            </div>
          </TooltipTrigger>
          <TooltipContent side="left" className="font-medium">
            Röststyrning (dra för att flytta)
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Minimized bubble */}
      {isOpen && isMinimized && (
        <div
          className="fixed right-4 z-[60] cursor-pointer"
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 160px)' }}
          onClick={() => setIsMinimized(false)}
        >
          <div className="bg-card/90 backdrop-blur-lg border rounded-full p-3 shadow-lg flex items-center gap-2 hover:bg-card transition-colors">
            <Mic className={cn("h-5 w-5", isListening ? "text-destructive" : "text-violet-500")} />
            <span className="text-sm font-medium">Röst</span>
            <Maximize2 className="h-4 w-4 text-muted-foreground" />
          </div>
        </div>
      )}

      {/* Floating panel */}
      {isOpen && !isMinimized && (
        <div
          className={cn(
            "fixed z-[60] flex flex-col",
            "border rounded-lg shadow-xl",
            "bg-card/70 backdrop-blur-lg",
            isPanelDragging && "cursor-grabbing select-none"
          )}
          style={{
            left: panelPos.x,
            top: panelPos.y,
            width: 380,
            height: 460,
          }}
        >
          {/* Header */}
          <div
            className={cn(
              "flex items-center justify-between px-3 py-2",
              "border-b border-border/50 rounded-t-lg cursor-grab",
              "bg-gradient-to-r from-violet-500/10 to-purple-500/10",
              isPanelDragging && "cursor-grabbing"
            )}
            onMouseDown={handlePanelDragStart}
            onTouchStart={handlePanelDragStart}
          >
            <div className="flex items-center gap-2">
              <GripHorizontal className="h-4 w-4 text-muted-foreground" />
              <Mic className="h-4 w-4 text-violet-500" />
              <span className="font-medium text-sm">Röststyrning</span>
              {isListening && (
                <span className="text-xs text-destructive animate-pulse">● Lyssnar</span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setIsMinimized(true)}>
                <Minimize2 className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setIsOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {/* Mic toggle */}
            <div className="flex items-center gap-2">
              <Button
                onClick={toggleListening}
                size="lg"
                variant={isListening ? "destructive" : "default"}
                className="h-12 flex-1"
              >
                {isListening ? <MicOff className="h-5 w-5 mr-2" /> : <Mic className="h-5 w-5 mr-2" />}
                {isListening ? "Stoppa" : "Starta"}
              </Button>
            </div>

            {/* Live transcript */}
            {isListening && displayText && (
              <div className="bg-muted/50 border rounded-lg px-3 py-2 text-sm animate-in fade-in">
                <p className="italic text-foreground">"{displayText}"</p>
              </div>
            )}
            {isListening && !displayText && (
              <div className="bg-muted/50 border rounded-lg px-3 py-2 text-sm animate-pulse">
                <p className="text-muted-foreground">Lyssnar...</p>
              </div>
            )}

            {/* Feedback */}
            {feedback && (
              <div className="bg-primary/10 text-primary rounded-lg px-3 py-2 text-sm animate-in fade-in">
                ✓ {feedback}
              </div>
            )}

            {/* History */}
            {history.length > 0 && (
              <div className="space-y-1">
                <h4 className="text-xs font-medium text-muted-foreground">Historik</h4>
                {history.slice().reverse().map((item, idx) => (
                  <div key={idx} className={cn(
                    "text-xs px-2 py-1 rounded",
                    item.matched ? "bg-primary/5 text-foreground" : "bg-destructive/5 text-muted-foreground"
                  )}>
                    <span className="italic">"{item.text}"</span>
                    {item.feedback && <span className="ml-1 text-primary">→ {item.feedback}</span>}
                  </div>
                ))}
              </div>
            )}

            {/* Commands reference */}
            <div className="space-y-2 pt-2 border-t">
              <h4 className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <HelpCircle className="h-3 w-3" /> Tillgängliga kommandon
              </h4>
              {Object.entries(commandsByCategory).map(([category, cmds]) => (
                <div key={category}>
                  <h5 className="text-xs font-medium text-muted-foreground mb-1">
                    {categoryLabels[category] || category}
                  </h5>
                  <ul className="space-y-0.5">
                    {cmds.map((cmd, idx) => (
                      <li key={idx} className="text-xs py-0.5 px-2 rounded bg-muted/30">
                        {cmd.description}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className="px-3 py-2 border-t text-xs text-muted-foreground">
            Tryck på mikrofon-knappen och tala tydligt.
          </div>
        </div>
      )}
    </TooltipProvider>
  );
}
