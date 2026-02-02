import React, { useState, useRef, useEffect, useCallback } from "react";
import { X, Send, Sparkles, Loader2, Navigation, Compass, Eye, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useApp } from "@/context/AppContext";
import { toast } from "sonner";
import { VIEW_MODE_REQUESTED_EVENT } from "@/lib/viewer-events";

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
  embedded?: boolean; // When true, renders without the modal wrapper
}

// Parse actions from AI response
interface GunnarAction {
  action: string;
  fmGuids?: string[];
  floorFmGuid?: string;
  modelId?: string;
  visible?: boolean;
  fmGuid?: string;
}

interface ParsedResponse {
  actions: GunnarAction[];
  followups: string[];
}

function parseResponse(content: string): ParsedResponse {
  const actions: GunnarAction[] = [];
  const followups: string[] = [];
  
  // Look for JSON blocks with actions or follow-ups
  const jsonMatches = content.matchAll(/```json\s*(\{[\s\S]*?\})\s*```/g);
  for (const match of jsonMatches) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed.action) {
        actions.push(parsed);
      }
      if (parsed.suggested_followups && Array.isArray(parsed.suggested_followups)) {
        followups.push(...parsed.suggested_followups);
      }
    } catch {
      // Invalid JSON, skip
    }
  }
  return { actions, followups };
}

function getContextualGreeting(context?: GunnarContext): string {
  if (context?.currentBuilding?.name) {
    return `Hej! Jag ser att du tittar på **${context.currentBuilding.name}**. Jag kan hjälpa dig med information om byggnaden - fråga om våningsplan, rum, area eller tillgångar!`;
  }
  if (context?.activeApp === 'assetplus_viewer') {
    return `Hej! Du är i 3D-viewern. Jag kan hjälpa dig navigera, visa specifika våningsplan eller hitta objekt. Prova att fråga "Visa plan 2" eller "Hur många rum finns det?"`;
  }
  if (context?.activeApp === 'navigator') {
    return `Hej! Du är i Navigatorn. Jag kan hjälpa dig hitta specifika rum, tillgångar eller byggnadsdelar. Fråga mig vad du letar efter!`;
  }
  if (context?.activeApp === 'portfolio') {
    return `Hej! Jag är Gunnar, din fastighetsassistent. Jag kan berätta om alla byggnader i portföljen - fråga om antal rum, area, våningsplan eller specifika tillgångar!`;
  }
  return `Hej! Jag är Gunnar, din AI-assistent för fastighetsdata. Fråga mig om:\n\n• Antal rum, våningsplan eller byggnader\n• Area och ytor\n• Specifika tillgångar\n• Navigering i 3D-modellen\n\nVad vill du veta?`;
}

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/gunnar-chat`;

export default function GunnarChat({ open, onClose, context, embedded }: GunnarChatProps) {
  const { setAiSelectedFmGuids, setActiveApp, clearAiSelection, setViewer3dFmGuid } = useApp();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [pendingActions, setPendingActions] = useState<GunnarAction[]>([]);
  const [suggestedFollowups, setSuggestedFollowups] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast: toastHook } = useToast();
  const prevContextRef = useRef<string>("");

  // Set initial greeting based on context
  useEffect(() => {
    const contextKey = JSON.stringify(context);
    if (contextKey !== prevContextRef.current) {
      prevContextRef.current = contextKey;
      setMessages([{
        role: "assistant",
        content: getContextualGreeting(context),
      }]);
      setPendingActions([]);
      setSuggestedFollowups([]);
    }
  }, [context]);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Focus input when opened
  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  const streamChat = useCallback(
    async (userMessages: Message[], currentContext?: GunnarContext) => {
      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ 
          messages: userMessages,
          context: currentContext,
        }),
      });

      if (!resp.ok) {
        const errorData = await resp.json().catch(() => ({}));
        if (resp.status === 429) {
          throw new Error("För många förfrågningar. Vänta en stund och försök igen.");
        }
        if (resp.status === 402) {
          throw new Error("AI-krediter slut. Kontakta administratör.");
        }
        throw new Error(errorData.error || `Request failed with status ${resp.status}`);
      }

      if (!resp.body) throw new Error("No response body");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = "";
      let assistantContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        textBuffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);

          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") break;

          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) {
              assistantContent += content;
              setMessages((prev) => {
                const last = prev[prev.length - 1];
                if (last?.role === "assistant") {
                  return prev.map((m, i) =>
                    i === prev.length - 1 ? { ...m, content: assistantContent } : m
                  );
                }
                return [...prev, { role: "assistant", content: assistantContent }];
              });
            }
          } catch {
            textBuffer = line + "\n" + textBuffer;
            break;
          }
        }
      }

      return assistantContent;
    },
    []
  );

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = { role: "user", content: input.trim() };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);
    setPendingActions([]);
    setSuggestedFollowups([]);

    try {
      const apiMessages = newMessages.filter((_, i) => i > 0);
      const response = await streamChat(apiMessages, context);
      
      // Parse actions and follow-ups from response
      const { actions, followups } = parseResponse(response);
      if (actions.length > 0) {
        setPendingActions(actions);
      }
      if (followups.length > 0) {
        setSuggestedFollowups(followups);
      }
    } catch (error) {
      console.error("Chat error:", error);
      toastHook({
        variant: "destructive",
        title: "Fel",
        description: error instanceof Error ? error.message : "Kunde inte få svar",
      });
      setMessages(messages);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFollowupClick = (question: string) => {
    setInput(question);
    // Auto-send after a short delay
    setTimeout(() => {
      const syntheticEvent = { preventDefault: () => {} } as React.KeyboardEvent;
      // Just set the input, user can click send
    }, 100);
  };

  const executeAction = useCallback((action: GunnarAction) => {
    switch (action.action) {
      case "selectInTree":
        if (action.fmGuids && action.fmGuids.length > 0) {
          setAiSelectedFmGuids(action.fmGuids);
          setActiveApp('navigator');
          onClose();
          toast.success(`Visar ${action.fmGuids.length} objekt i Navigatorn`);
        }
        break;
      case "showFloor":
        if (action.floorFmGuid) {
          // Dispatch event to viewer
          window.dispatchEvent(new CustomEvent('GUNNAR_SHOW_FLOOR', {
            detail: { floorFmGuid: action.floorFmGuid }
          }));
          toast.success('Växlar till våningsplan');
        }
        break;
      case "highlight":
        if (action.fmGuids && action.fmGuids.length > 0) {
          window.dispatchEvent(new CustomEvent('GUNNAR_HIGHLIGHT', {
            detail: { fmGuids: action.fmGuids }
          }));
          toast.success(`Markerar ${action.fmGuids.length} objekt`);
        }
        break;
      case "switchTo2D":
        window.dispatchEvent(new CustomEvent(VIEW_MODE_REQUESTED_EVENT, {
          detail: { mode: '2d' }
        }));
        toast.success('Växlar till 2D-vy');
        break;
      case "switchTo3D":
        window.dispatchEvent(new CustomEvent(VIEW_MODE_REQUESTED_EVENT, {
          detail: { mode: '3d' }
        }));
        toast.success('Växlar till 3D-vy');
        break;
      case "toggleModel":
        if (action.modelId !== undefined) {
          window.dispatchEvent(new CustomEvent('GUNNAR_TOGGLE_MODEL', {
            detail: { modelId: action.modelId, visible: action.visible }
          }));
        }
        break;
      case "flyTo":
        if (action.fmGuid) {
          window.dispatchEvent(new CustomEvent('GUNNAR_FLY_TO', {
            detail: { fmGuid: action.fmGuid }
          }));
          toast.success('Flyger till objekt');
        }
        break;
      case "openViewer":
        if (action.fmGuid) {
          setViewer3dFmGuid(action.fmGuid);
          toast.success('Öppnar 3D-viewer');
        }
        break;
    }
  }, [setAiSelectedFmGuids, setActiveApp, onClose, setViewer3dFmGuid]);

  const getActionButton = (action: GunnarAction) => {
    switch (action.action) {
      case "selectInTree":
        return {
          icon: Navigation,
          label: `Visa ${action.fmGuids?.length || 0} objekt i Navigator`,
        };
      case "showFloor":
        return { icon: Layers, label: "Visa våningsplan" };
      case "highlight":
        return { icon: Eye, label: `Markera ${action.fmGuids?.length || 0} objekt` };
      case "switchTo2D":
        return { icon: Compass, label: "Växla till 2D" };
      case "switchTo3D":
        return { icon: Compass, label: "Växla till 3D" };
      case "flyTo":
        return { icon: Navigation, label: "Flyg till objekt" };
      case "openViewer":
        return { icon: Eye, label: "Öppna i 3D-viewer" };
      default:
        return null;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!open) return null;

  const chatContent = (
    <>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-primary/20 to-accent/20">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="font-semibold">Gunnar</h2>
            <p className="text-xs text-muted-foreground">
              {context?.currentBuilding?.name || "AI-assistent"}
            </p>
          </div>
        </div>
        {!embedded && (
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        )}
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4" ref={scrollRef}>
        <div className="space-y-4">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={cn(
                "flex",
                msg.role === "user" ? "justify-end" : "justify-start"
              )}
            >
              <div
                className={cn(
                  "max-w-[85%] rounded-lg px-4 py-2 text-sm",
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted"
                )}
              >
                <pre className="whitespace-pre-wrap font-sans">{msg.content}</pre>
              </div>
            </div>
          ))}
          {isLoading && messages[messages.length - 1]?.role === "user" && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-lg bg-muted px-4 py-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Tänker...</span>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="border-t border-border p-4 shrink-0">
        {/* Suggested follow-ups */}
        {suggestedFollowups.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {suggestedFollowups.map((q, i) => (
              <Button
                key={i}
                onClick={() => handleFollowupClick(q)}
                className="gap-1.5 text-xs h-7"
                variant="outline"
                size="sm"
              >
                {q}
              </Button>
            ))}
          </div>
        )}
        
        {pendingActions.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {pendingActions.map((action, i) => {
              const buttonInfo = getActionButton(action);
              if (!buttonInfo) return null;
              const Icon = buttonInfo.icon;
              return (
                <Button
                  key={i}
                  onClick={() => executeAction(action)}
                  className="gap-2"
                  variant="secondary"
                  size="sm"
                >
                  <Icon className="h-4 w-4" />
                  {buttonInfo.label}
                </Button>
              );
            })}
          </div>
        )}
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Fråga om dina fastigheter..."
            disabled={isLoading}
            className="flex-1"
          />
          <Button onClick={handleSend} disabled={isLoading || !input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Enter för att skicka • Gunnar förstår svenska och engelska
        </p>
      </div>
    </>
  );

  // Embedded mode: render directly without modal wrapper
  if (embedded) {
    return <div className="flex flex-col h-full">{chatContent}</div>;
  }

  // Modal mode
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
      <div className="flex h-[92vh] sm:h-[90vh] w-full max-w-2xl flex-col rounded-t-xl sm:rounded-xl border border-border bg-background shadow-2xl">
        {chatContent}
      </div>
    </div>
  );
}
