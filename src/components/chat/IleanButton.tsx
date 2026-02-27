import React, { useState, useEffect, useRef, useCallback } from 'react';
import { FileQuestion, GripHorizontal, X, Minimize2, Maximize2, Move, Loader2, ExternalLink, Building2, Layers, DoorOpen, Send, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { getIleanSettings, saveIleanSettings } from '@/components/settings/IleanSettings';
import { useIleanData } from '@/hooks/useIleanData';
import ReactMarkdown from 'react-markdown';

const BUTTON_SIZE = 56;

const STARTER_QUESTIONS = [
  'What documents are available?',
  'Summarize the latest maintenance reports',
  'Are there any open issues in the documents?',
  'What equipment is documented for this building?',
];

/**
 * Floating Ilean AI assistant — Document Q&A chat via Senslinc API.
 * Native Geminus UI, no iframe. Similar pattern to GunnarChat.
 */
export default function IleanButton() {
  const {
    messages, sendMessage, clearMessages, isLoading, isSending,
    contextEntity, contextLevel,
  } = useIleanData();

  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [input, setInput] = useState('');

  // Trigger button position (draggable)
  const [triggerPosition, setTriggerPosition] = useState<{ x: number; y: number } | null>(null);
  const [isTriggerDragging, setIsTriggerDragging] = useState(false);
  const triggerDragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const triggerDragStartPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const wasDraggedRef = useRef(false);

  // Panel drag state
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: -1, y: -1 });
  const [isDragging, setIsDragging] = useState(false);
  const dragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;
  const panelWidth = isMobile ? window.innerWidth : 400;
  const panelHeight = isMobile ? window.innerHeight : (typeof window !== 'undefined' && window.innerHeight < 700 ? window.innerHeight - 100 : 560);

  // Load saved position
  useEffect(() => {
    const settings = getIleanSettings();
    if (settings.buttonPosition) {
      const maxX = window.innerWidth - BUTTON_SIZE;
      const maxY = window.innerHeight - BUTTON_SIZE;
      setTriggerPosition({
        x: Math.max(0, Math.min(settings.buttonPosition.x, maxX)),
        y: Math.max(0, Math.min(settings.buttonPosition.y, maxY)),
      });
    }
  }, []);

  // Initialize panel position
  useEffect(() => {
    if (isOpen && position.x === -1) {
      if (isMobile) setPosition({ x: 0, y: 0 });
      else {
        const y = typeof window !== 'undefined' ? window.innerHeight - panelHeight - 80 : 100;
        setPosition({ x: 16, y: Math.max(16, y) });
      }
    }
  }, [isOpen, position.x, panelHeight, isMobile]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && !isMinimized && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, isMinimized]);

  // Panel drag handlers
  const handleDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (isMobile) return;
    e.preventDefault();
    setIsDragging(true);
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    dragOffsetRef.current = { x: clientX - position.x, y: clientY - position.y };
  }, [position, isMobile]);

  const handleDragMove = useCallback((e: MouseEvent | TouchEvent) => {
    if (!isDragging) return;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    setPosition({
      x: Math.max(0, Math.min(clientX - dragOffsetRef.current.x, window.innerWidth - panelWidth)),
      y: Math.max(0, Math.min(clientY - dragOffsetRef.current.y, window.innerHeight - 50)),
    });
  }, [isDragging, panelWidth]);

  const handleDragEnd = useCallback(() => { setIsDragging(false); }, []);

  // Trigger drag handlers
  const handleTriggerDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault(); e.stopPropagation();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const currentX = triggerPosition?.x ?? 16;
    const currentY = triggerPosition?.y ?? (window.innerHeight - 80);
    triggerDragOffsetRef.current = { x: clientX - currentX, y: clientY - currentY };
    triggerDragStartPosRef.current = { x: clientX, y: clientY };
    wasDraggedRef.current = false;
    setIsTriggerDragging(true);
  }, [triggerPosition]);

  const handleTriggerDragMove = useCallback((e: MouseEvent | TouchEvent) => {
    if (!isTriggerDragging) return;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    if (Math.abs(clientX - triggerDragStartPosRef.current.x) > 5 || Math.abs(clientY - triggerDragStartPosRef.current.y) > 5) wasDraggedRef.current = true;
    setTriggerPosition({
      x: Math.max(0, Math.min(clientX - triggerDragOffsetRef.current.x, window.innerWidth - BUTTON_SIZE)),
      y: Math.max(0, Math.min(clientY - triggerDragOffsetRef.current.y, window.innerHeight - BUTTON_SIZE)),
    });
  }, [isTriggerDragging]);

  const handleTriggerDragEnd = useCallback(() => {
    setIsTriggerDragging(false);
    if (wasDraggedRef.current && triggerPosition) saveIleanSettings({ buttonPosition: triggerPosition });
  }, [triggerPosition]);

  // Global listeners for trigger drag
  useEffect(() => {
    if (isTriggerDragging) {
      window.addEventListener('mousemove', handleTriggerDragMove);
      window.addEventListener('mouseup', handleTriggerDragEnd);
      window.addEventListener('touchmove', handleTriggerDragMove);
      window.addEventListener('touchend', handleTriggerDragEnd);
      return () => { window.removeEventListener('mousemove', handleTriggerDragMove); window.removeEventListener('mouseup', handleTriggerDragEnd); window.removeEventListener('touchmove', handleTriggerDragMove); window.removeEventListener('touchend', handleTriggerDragEnd); };
    }
  }, [isTriggerDragging, handleTriggerDragMove, handleTriggerDragEnd]);

  // Global listeners for panel drag
  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleDragMove);
      window.addEventListener('mouseup', handleDragEnd);
      window.addEventListener('touchmove', handleDragMove);
      window.addEventListener('touchend', handleDragEnd);
      return () => { window.removeEventListener('mousemove', handleDragMove); window.removeEventListener('mouseup', handleDragEnd); window.removeEventListener('touchmove', handleDragMove); window.removeEventListener('touchend', handleDragEnd); };
    }
  }, [isDragging, handleDragMove, handleDragEnd]);

  const handleTriggerClick = () => {
    if (!wasDraggedRef.current) { setIsOpen(true); setIsMinimized(false); }
    wasDraggedRef.current = false;
  };

  const handleOpenExternal = () => {
    if (contextEntity.dashboardUrl) window.open(contextEntity.dashboardUrl, '_blank');
  };

  const handleSend = () => {
    if (!input.trim() || isSending) return;
    sendMessage(input.trim());
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const triggerStyle = triggerPosition
    ? { left: triggerPosition.x, top: triggerPosition.y, bottom: 'auto', right: 'auto' }
    : {};

  return (
    <TooltipProvider>
      {/* Floating trigger button */}
      <div
        className={cn("fixed z-50", !triggerPosition && "left-4 sm:bottom-6")}
        style={triggerPosition ? triggerStyle : { bottom: 'calc(env(safe-area-inset-bottom, 0px) + 96px)' }}
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
                  "h-12 w-12 rounded-full shadow-lg",
                  "bg-gradient-to-br from-cyan-500 to-teal-600 hover:from-cyan-500/90 hover:to-teal-600/90",
                  "transition-all duration-300 hover:scale-105 hover:shadow-xl",
                  "sm:h-14 sm:w-14",
                  isOpen && "opacity-0 pointer-events-none",
                  isTriggerDragging && "cursor-grabbing scale-110"
                )}
              >
                <FileQuestion className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
              </Button>
              {!isOpen && (
                <div className="absolute -bottom-0.5 -right-0.5 h-4 w-4 bg-muted/80 rounded-full flex items-center justify-center pointer-events-none">
                  <Move className="h-2.5 w-2.5 text-muted-foreground" />
                </div>
              )}
            </div>
          </TooltipTrigger>
          <TooltipContent side="right" className="font-medium">Open Ilean (drag to move)</TooltipContent>
        </Tooltip>
      </div>

      {/* Minimized bubble */}
      {isOpen && isMinimized && (
        <div
          className="fixed left-4 z-[60] cursor-pointer"
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 96px)' }}
          onClick={() => setIsMinimized(false)}
        >
          <div className={cn("bg-card/90 backdrop-blur-lg border rounded-full p-3 shadow-lg", "flex items-center gap-2 hover:bg-card transition-colors")}>
            <FileQuestion className="h-5 w-5 text-cyan-500" />
            <span className="text-sm font-medium max-w-32 truncate">Ilean</span>
            <Maximize2 className="h-4 w-4 text-muted-foreground" />
          </div>
        </div>
      )}

      {/* Chat panel */}
      {isOpen && !isMinimized && (
        <div
          ref={panelRef}
          className={cn(
            "fixed z-[60] flex flex-col",
            "border rounded-lg shadow-xl",
            "bg-card/70 backdrop-blur-lg",
            isDragging && "cursor-grabbing select-none"
          )}
          style={isMobile ? { inset: 0, width: '100%', height: '100%', borderRadius: 0 } : { left: position.x, top: position.y, width: panelWidth, height: panelHeight }}
        >
          {/* Header */}
          <div
            className={cn(
              "flex items-center justify-between px-3 py-2",
              "border-b border-border/50",
              !isMobile && "rounded-t-lg cursor-grab",
              "bg-gradient-to-r from-cyan-500/10 to-teal-500/10",
              isDragging && "cursor-grabbing"
            )}
            onMouseDown={isMobile ? undefined : handleDragStart}
            onTouchStart={isMobile ? undefined : handleDragStart}
          >
            <div className="flex items-center gap-2">
              {!isMobile && <GripHorizontal className="h-4 w-4 text-muted-foreground" />}
              <div className="flex items-center gap-1.5">
                <FileQuestion className="h-4 w-4 text-cyan-500" />
                <span className="font-medium text-sm">Ilean</span>
                <span className="text-[10px] text-muted-foreground">Document Q&A</span>
              </div>
              {contextEntity.entityName && (
                <span className="text-xs text-muted-foreground flex items-center gap-1 ml-1">
                  {contextEntity.entityType === 'building' && <Building2 className="h-3 w-3" />}
                  {contextEntity.entityType === 'floor' && <Layers className="h-3 w-3" />}
                  {contextEntity.entityType === 'room' && <DoorOpen className="h-3 w-3" />}
                  <span className="max-w-24 truncate">{contextEntity.entityName}</span>
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {contextEntity.dashboardUrl && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-muted/50" onClick={handleOpenExternal}>
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">Open in Senslinc</TooltipContent>
                </Tooltip>
              )}
              {messages.length > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-muted/50" onClick={clearMessages}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">Clear conversation</TooltipContent>
                </Tooltip>
              )}
              {!isMobile && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-muted/50" onClick={() => setIsMinimized(true)}>
                      <Minimize2 className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">Minimize</TooltipContent>
                </Tooltip>
              )}
              <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-muted/50" onClick={() => setIsOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Messages area */}
          <ScrollArea className="flex-1 p-3" ref={scrollRef}>
            <div className="space-y-3">
              {messages.length === 0 && !isLoading && (
                <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
                  <FileQuestion className="h-12 w-12 text-muted-foreground/40 mb-3" />
                  <h3 className="font-semibold text-sm mb-1">Ask Ilean about documents</h3>
                  <p className="text-xs text-muted-foreground mb-4 max-w-xs">
                    Ilean answers questions about documents stored in Senslinc for{' '}
                    {contextEntity.entityName || 'this building'}.
                  </p>
                  <div className="flex flex-col gap-2 w-full max-w-xs">
                    {STARTER_QUESTIONS.map((q, i) => (
                      <Button
                        key={i}
                        variant="outline"
                        size="sm"
                        className="text-xs justify-start h-auto py-2 px-3 text-left whitespace-normal"
                        onClick={() => sendMessage(q)}
                      >
                        {q}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((msg, i) => (
                <div key={i} className={cn("flex", msg.role === 'user' ? "justify-end" : "justify-start")}>
                  <div className={cn(
                    "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                    msg.role === 'user'
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  )}>
                    {msg.role === 'assistant' ? (
                      <div className="prose prose-sm dark:prose-invert max-w-none [&>p]:my-1 [&>ul]:my-1 [&>ol]:my-1">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                    ) : (
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    )}
                  </div>
                </div>
              ))}

              {isSending && messages[messages.length - 1]?.role === 'user' && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Searching documents...</span>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Input area */}
          <div className="border-t border-border/50 p-3">
            <div className="flex items-center gap-2">
              <Input
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about documents..."
                disabled={isSending}
                className="flex-1 h-9 text-sm"
              />
              <Button
                onClick={handleSend}
                disabled={!input.trim() || isSending}
                size="icon"
                className="h-9 w-9 shrink-0 bg-gradient-to-br from-cyan-500 to-teal-600 hover:from-cyan-500/90 hover:to-teal-600/90"
              >
                <Send className="h-4 w-4 text-white" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </TooltipProvider>
  );
}
