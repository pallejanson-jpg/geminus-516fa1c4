import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { X, Send, Sparkles, Loader2, Info, Mic, MicOff, Volume2, VolumeX, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import ReactMarkdown from "react-markdown";
import { useWebSpeechRecognition } from "@/hooks/useWebSpeechRecognition";
import { getGunnarSettings, saveGunnarSettings } from "@/components/settings/GunnarSettings";
import { dispatchAiViewerCommand } from "@/hooks/useAiViewerBridge";
import { AI_SENSOR_DATA_EVENT } from "@/components/viewer/SensorDataOverlay";
import { preprocessForTTS } from "@/lib/tts-preprocess";

type Message = {
  role: "user" | "assistant";
  content: string;
};

export interface GunnarContext {
  activeApp: string;
  currentBuilding?: { fmGuid: string; name: string };
  currentStorey?: { fmGuid: string; name: string };
  currentSpace?: { fmGuid: string; name: string };
  viewerState?: {
    buildingFmGuid: string;
    viewMode: '2d' | '3d';
    visibleFloorFmGuids: string[];
    visibleModelIds: string[];
    selectedFmGuids: string[];
    clipHeight: number;
  };
}

interface GunnarChatProps {
  open: boolean;
  onClose: () => void;
  context?: GunnarContext;
  embedded?: boolean;
  autoVoice?: boolean;
  onAutoVoiceConsumed?: () => void;
}

/** Structured AI response format */
interface AiStructuredResponse {
  message: string;
  action: 'highlight' | 'filter' | 'colorize' | 'list' | 'none';
  asset_ids: string[];
  external_entity_ids: string[];
  filters: {
    system?: string;
    category?: string;
    room?: string;
  };
  sensor_data?: Array<{
    entity_id: string;
    value: number;
    type: string;
    unit?: string;
    status: 'normal' | 'warning' | 'critical';
  }>;
  color_map?: Record<string, [number, number, number]>;
  proactive_insights?: string[];
  error?: string;
}

export const AI_FILTER_SYNC_EVENT = 'AI_FILTER_SYNC';

function getContextualGreeting(context?: GunnarContext): string {
  if (context?.currentBuilding?.name) {
    return `Hej! Jag ser att du tittar på **${context.currentBuilding.name}**. Fråga mig om utrustning, system, rum eller be mig markera objekt i 3D-viewern!`;
  }
  return `Hej! Jag är Geminus AI, din assistent för digital twin-data. Jag kan:\n\n• Söka utrustning och system\n• Markera objekt i 3D-viewern\n• Ge byggnadsöversikter\n\nVad vill du veta?`;
}

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/gunnar-chat`;

const GunnarChat = React.forwardRef<HTMLDivElement, GunnarChatProps>(function GunnarChat({ open, onClose, context, embedded, autoVoice, onAutoVoiceConsumed }, _ref) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [proactiveInsights, setProactiveInsights] = useState<string[]>([]);
  const [voiceOutputEnabled, setVoiceOutputEnabled] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast: toastHook } = useToast();
  const proactiveFetchedRef = useRef<string>("");
  const abortRef = useRef<AbortController | null>(null);
  const spokenMessageKeyRef = useRef<string>("");
  
  const currentBuildingRef = useRef<string | undefined>(undefined);

  // Fetch proactive insights when context has a building
  useEffect(() => {
    const buildingKey = context?.currentBuilding?.fmGuid || "";
    if (!buildingKey || proactiveFetchedRef.current === buildingKey) return;
    proactiveFetchedRef.current = buildingKey;
    const fetchInsights = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) return;
        const resp = await fetch(CHAT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ messages: [], context, proactive: true }),
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data.proactive_insights?.length) setProactiveInsights(data.proactive_insights);
        }
      } catch (e) { console.error("Failed to fetch proactive insights:", e); }
    };
    fetchInsights();
  }, [context?.currentBuilding?.fmGuid]);

  useEffect(() => {
    const buildingKey = context?.currentBuilding?.fmGuid;
    if (buildingKey !== currentBuildingRef.current) {
      currentBuildingRef.current = buildingKey;
      if (messages.length <= 1) {
        setMessages([{ role: "assistant", content: getContextualGreeting(context) }]);
        setProactiveInsights([]);
        proactiveFetchedRef.current = "";
      }
    }
  }, [context?.currentBuilding?.fmGuid]);

  useEffect(() => {
    if (messagesEndRef.current) messagesEndRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, proactiveInsights]);

  useEffect(() => {
    if (open && inputRef.current) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  // ── Browser TTS helpers ──
  const stopSpeaking = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
    setSpeakingIndex(null);
  }, []);

  const speakText = useCallback(async (text: string, msgIndex?: number) => {
    const cleaned = preprocessForTTS(text);
    if (!cleaned) return;

    stopSpeaking();

    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return;
    }

    const utterance = new SpeechSynthesisUtterance(cleaned);
    utterance.lang = 'sv-SE';
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.onstart = () => { setIsSpeaking(true); if (msgIndex !== undefined) setSpeakingIndex(msgIndex); };
    utterance.onend = () => { setIsSpeaking(false); setSpeakingIndex(null); };
    utterance.onerror = () => { setIsSpeaking(false); setSpeakingIndex(null); };

    window.speechSynthesis.speak(utterance);
  }, [stopSpeaking]);

  const speakAssistant = useCallback(async (text: string) => {
    if (!voiceOutputEnabled) return;
    await speakText(text);
  }, [voiceOutputEnabled, speakText]);

  // ── Structured chat call (no streaming — JSON response) ──
  const callChat = useCallback(async (userMessages: Message[], currentContext?: GunnarContext): Promise<AiStructuredResponse> => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("You must be logged in.");

    const controller = new AbortController();
    abortRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), 60000);

    try {
      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ messages: userMessages, context: currentContext }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const errorData = await resp.json().catch(() => ({}));
        if (resp.status === 429) throw { status: 429, message: "Too many requests. Please wait." };
        if (resp.status === 402) throw { status: 402, message: "AI credits used up." };
        if (resp.status === 401) throw { status: 401, message: "Not logged in." };
        throw new Error(errorData.error || `Request failed (${resp.status})`);
      }

      return await resp.json();
    } finally {
      clearTimeout(timeout);
      abortRef.current = null;
    }
  }, []);

  // ── Execute viewer action from structured response ──
  const executeViewerAction = useCallback((response: AiStructuredResponse) => {
    // Dispatch filter sync if filters present
    if (response.filters && (response.filters.system || response.filters.category || response.filters.room)) {
      window.dispatchEvent(new CustomEvent(AI_FILTER_SYNC_EVENT, { detail: response.filters }));
    }

    if (response.action === 'colorize' && response.color_map && Object.keys(response.color_map).length > 0) {
      dispatchAiViewerCommand({ action: 'colorize', colorMap: response.color_map });
      // Dispatch sensor data to overlay panel
      if (response.sensor_data?.length) {
        window.dispatchEvent(new CustomEvent(AI_SENSOR_DATA_EVENT, { detail: response.sensor_data }));
      }
      const sensorCount = response.sensor_data?.length || Object.keys(response.color_map).length;
      toast.success(`Visar sensordata för ${sensorCount} objekt`);
      return;
    }

    if (!response.external_entity_ids?.length) return;

    switch (response.action) {
      case 'highlight':
        dispatchAiViewerCommand({ action: 'highlight', entityIds: response.external_entity_ids });
        toast.success(`Markerar ${response.external_entity_ids.length} objekt i viewern`);
        break;
      case 'filter':
        dispatchAiViewerCommand({ action: 'filter', entityIds: response.external_entity_ids });
        toast.success(`Filtrerar till ${response.external_entity_ids.length} objekt`);
        break;
      case 'list':
      case 'none':
        // No viewer action
        break;
    }
  }, []);

  /** Trim conversation history */
  const trimHistory = useCallback((msgs: Message[]): Message[] => {
    return msgs.slice(-12);
  }, []);

  const sendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;
    const userMessage: Message = { role: "user", content: text.trim() };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);
    setProactiveInsights([]);

    try {
      const apiMessages = trimHistory(newMessages.filter((_, i) => i > 0));
      const response = await callChat(apiMessages, context);

      // Add assistant message
      const assistantContent = response.message || "Inga resultat hittades.";
      setMessages(prev => [...prev, { role: "assistant", content: assistantContent }]);

      // Execute viewer action
      executeViewerAction(response);
    } catch (error) {
      console.error("Chat error:", error);
      const isAbort = error instanceof DOMException && error.name === "AbortError";
      const errMsg = isAbort ? "Request timed out." : (error as any)?.message || "Could not fetch response";
      toastHook({ variant: "destructive", title: "Error", description: errMsg });
      setMessages(messages); // revert
    } finally {
      setIsLoading(false);
    }
  };

  const handleSend = () => sendMessage(input);

  // ── Voice ──
  const speechSettings = getGunnarSettings();
  const {
    isListening, isSupported: isVoiceSupported,
    start: startListening, stop: stopListening,
  } = useWebSpeechRecognition({
    language: speechSettings.speechLang,
    onResult: (transcript, isFinal) => {
      if (isFinal) {
        const text = transcript.trim();
        if (text) void sendMessage(text);
        setInput('');
      } else {
        setInput(transcript);
      }
    },
    onError: (errorMessage) => {
      toastHook({ variant: 'destructive', title: 'Röstfel', description: errorMessage });
    },
  });

  const toggleListening = useCallback(() => {
    if (!isVoiceSupported || isLoading) return;
    if (isListening) stopListening(); else startListening();
  }, [isListening, isLoading, isVoiceSupported, startListening, stopListening]);

  const toggleVoiceOutput = useCallback(() => {
    if (voiceOutputEnabled) {
      stopSpeaking();
      setVoiceOutputEnabled(false);
    } else {
      setVoiceOutputEnabled(true);
    }
  }, [voiceOutputEnabled, stopSpeaking]);

  // Auto-start voice mode
  useEffect(() => {
    if (autoVoice && open && isVoiceSupported && !isListening) {
      setVoiceOutputEnabled(true);
      const timer = setTimeout(() => { startListening(); onAutoVoiceConsumed?.(); }, 600);
      return () => clearTimeout(timer);
    }
  }, [autoVoice, open, isVoiceSupported]);

  // Auto-speak assistant messages
  useEffect(() => {
    if (!open || !voiceOutputEnabled || isLoading) return;
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.role !== 'assistant') return;
    const key = `${messages.length - 1}:${lastMessage.content.length}`;
    if (spokenMessageKeyRef.current === key) return;
    spokenMessageKeyRef.current = key;
    speakAssistant(lastMessage.content);
  }, [messages, isLoading, open, voiceOutputEnabled, speakAssistant]);

  useEffect(() => {
    return () => { stopSpeaking(); };
  }, [stopSpeaking]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  if (!open) return null;

  // ── Render ──
  const renderMessages = () => (
    <div className="space-y-3">
      {messages.map((msg, i) => (
        <div key={i} className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
          <div className={cn(
            "max-w-[85%] rounded-lg px-3 py-2 text-sm",
            msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
          )}>
            {msg.role === "assistant" ? (
              <div>
                <div className="prose prose-sm dark:prose-invert max-w-none [&>p]:my-1 [&>ul]:my-1 [&>ol]:my-1">
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                </div>
                <div className="flex justify-end mt-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-50 hover:opacity-100 transition-opacity"
                    onClick={() => {
                      if (isSpeaking) { stopSpeaking(); } else { speakText(msg.content); }
                    }}
                    title={isSpeaking ? "Stoppa uppläsning" : "Läs upp"}
                  >
                    {isSpeaking ? <Square className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                  </Button>
                </div>
              </div>
            ) : (
              <p className="whitespace-pre-wrap">{msg.content}</p>
            )}
          </div>
        </div>
      ))}

      {proactiveInsights.length > 0 && messages.length <= 1 && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
            <Info className="h-3.5 w-3.5" />
            Aktuell status
          </div>
          {proactiveInsights.map((insight, i) => (
            <p key={i} className="text-sm text-foreground">{insight}</p>
          ))}
        </div>
      )}

      {isLoading && messages[messages.length - 1]?.role === "user" && (
        <div className="flex justify-start">
          <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Tänker...</span>
          </div>
        </div>
      )}
      <div ref={messagesEndRef} />
    </div>
  );

  const renderInput = (compact?: boolean) => (
    <div className={cn("border-t border-border shrink-0", compact ? "p-2 sm:p-3" : "p-3 sm:p-4")}>
      <div className="flex flex-col gap-1 sm:gap-0">
        {/* Mic/speaker row - mobile */}
        <div className="flex items-center gap-1 sm:hidden">
          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={toggleVoiceOutput}>
            {voiceOutputEnabled ? <Volume2 className={cn("h-3 w-3", isSpeaking && "animate-pulse text-primary")} /> : <VolumeX className="h-3 w-3 text-muted-foreground" />}
          </Button>
          {isVoiceSupported && (
            <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={toggleListening} disabled={isLoading}>
              {isListening ? <MicOff className="h-3 w-3 text-destructive" /> : <Mic className="h-3 w-3" />}
            </Button>
          )}
        </div>
        {/* Input row */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          <div className="hidden sm:flex items-center gap-1 shrink-0">
            <Button variant="ghost" size="icon" className={cn("shrink-0", compact ? "h-8 w-8" : "h-9 w-9")} onClick={toggleVoiceOutput}>
              {voiceOutputEnabled ? <Volume2 className={cn(compact ? "h-3.5 w-3.5" : "h-4 w-4", isSpeaking && "animate-pulse text-primary")} /> : <VolumeX className={cn(compact ? "h-3.5 w-3.5" : "h-4 w-4", "text-muted-foreground")} />}
            </Button>
            {isVoiceSupported && (
              <Button variant="ghost" size="icon" className={cn("shrink-0", compact ? "h-8 w-8" : "h-9 w-9")} onClick={toggleListening} disabled={isLoading}>
                {isListening ? <MicOff className={cn(compact ? "h-3.5 w-3.5" : "h-4 w-4", "text-destructive")} /> : <Mic className={cn(compact ? "h-3.5 w-3.5" : "h-4 w-4")} />}
              </Button>
            )}
          </div>
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ställ en fråga..."
            disabled={isLoading}
            className={cn("flex-1 min-w-0", compact && "h-8 sm:h-9 text-sm")}
          />
          <Button onClick={handleSend} disabled={isLoading || !input.trim()} size="icon" className={cn("shrink-0", compact ? "h-8 w-8 sm:h-9 sm:w-9" : "h-9 w-9")}>
            <Send className={cn(compact ? "h-3.5 w-3.5 sm:h-4 sm:w-4" : "h-4 w-4")} />
          </Button>
        </div>
      </div>
    </div>
  );

  if (embedded) {
    return (
      <div className="flex flex-col h-full min-h-0">
        <ScrollArea className="flex-1 min-h-0 p-3" ref={scrollRef}>
          {renderMessages()}
        </ScrollArea>
        {renderInput(true)}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
      <div className="flex h-[92vh] sm:h-[90vh] w-full max-w-2xl flex-col rounded-t-xl sm:rounded-xl border border-border bg-background shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-primary/20 to-accent/20">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="font-semibold">Geminus AI</h2>
              <p className="text-xs text-muted-foreground">
                {context?.currentBuilding?.name || "AI BIM Assistant"}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1 min-h-0 p-4" ref={scrollRef}>
          {renderMessages()}
        </ScrollArea>

        {renderInput()}
      </div>
    </div>
  );
});

export default GunnarChat;
