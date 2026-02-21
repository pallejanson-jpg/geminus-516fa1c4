import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { X, Send, Sparkles, Loader2, Navigation, Compass, Eye, Layers, MapPin, Search, AlertTriangle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useApp } from "@/context/AppContext";
import { toast } from "sonner";
import { VIEW_MODE_REQUESTED_EVENT } from "@/lib/viewer-events";
import { supabase } from "@/integrations/supabase/client";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";

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
}

interface GunnarAction {
  action: string;
  fmGuids?: string[];
  floorFmGuid?: string;
  modelId?: string;
  visible?: boolean;
  fmGuid?: string;
}

/** Extract follow-up suggestions from the AI response (numbered list after "Förslag:" or "Suggestions:") */
function extractFollowups(content: string): string[] {
  const blockMatch = content.match(/\*\*(?:Förslag|Suggestions):\*\*\s*([\s\S]*?)$/i);
  if (!blockMatch) return [];
  const block = blockMatch[1];
  const items: string[] = [];
  const lineRegex = /^\d+\.\s+(.+)/gm;
  let m;
  while ((m = lineRegex.exec(block)) !== null) {
    items.push(m[1].trim());
  }
  return items;
}

/** Remove the follow-up block from displayed content */
function stripFollowups(content: string): string {
  return content.replace(/\n*\*\*(?:Förslag|Suggestions):\*\*[\s\S]*$/, "").trim();
}

function getContextualGreeting(context?: GunnarContext): string {
  if (context?.currentBuilding?.name) {
    return `Hej! Jag ser att du tittar på **${context.currentBuilding.name}**. Fråga mig om våningar, rum, ytor, tillgångar, arbetsordrar eller ärenden!`;
  }
  if (context?.activeApp === 'assetplus_viewer') {
    return `Hej! Du är i 3D-viewern. Jag kan hjälpa dig navigera, utforska våningar eller hitta specifika objekt. Prova att fråga "Hur många rum finns det?" eller "Visa plan 2".`;
  }
  if (context?.activeApp === 'navigator') {
    return `Hej! Du är i Navigatorn. Jag kan hjälpa dig hitta rum, tillgångar eller byggnadsdelar. Vad letar du efter?`;
  }
  if (context?.activeApp === 'portfolio') {
    return `Hej! Jag är Gunnar, din fastighetsassistent. Jag kan berätta om alla byggnader i portföljen — fråga om rum, ytor, våningar eller specifika tillgångar!`;
  }
  return `Hej! Jag är Gunnar, din AI-assistent för fastighetsdata. Fråga mig om:\n\n• Byggnader, våningar, rum och ytor\n• Utrustning och tillgångar\n• Arbetsordrar och ärenden\n• Navigation i 3D-modellen\n• Skapa felanmälningar\n\nVad vill du veta?`;
}

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/gunnar-chat`;

export default function GunnarChat({ open, onClose, context, embedded }: GunnarChatProps) {
  const { setAiSelectedFmGuids, setActiveApp, clearAiSelection, setViewer3dFmGuid } = useApp();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [suggestedFollowups, setSuggestedFollowups] = useState<string[]>([]);
  const [proactiveInsights, setProactiveInsights] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast: toastHook } = useToast();
  const prevContextRef = useRef<string>("");
  const proactiveFetchedRef = useRef<string>("");

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
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ messages: [], context, proactive: true }),
        });

        if (resp.ok) {
          const data = await resp.json();
          if (data.proactive_insights?.length) {
            setProactiveInsights(data.proactive_insights);
          }
        }
      } catch (e) {
        console.error("Failed to fetch proactive insights:", e);
      }
    };
    fetchInsights();
  }, [context?.currentBuilding?.fmGuid]);

  useEffect(() => {
    const contextKey = JSON.stringify(context);
    if (contextKey !== prevContextRef.current) {
      prevContextRef.current = contextKey;
      setMessages([{ role: "assistant", content: getContextualGreeting(context) }]);
      setSuggestedFollowups([]);
      setProactiveInsights([]);
      proactiveFetchedRef.current = "";
    }
  }, [context]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, proactiveInsights]);

  useEffect(() => {
    if (open && inputRef.current) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  const streamChat = useCallback(
    async (userMessages: Message[], currentContext?: GunnarContext) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error("Du måste vara inloggad för att använda Gunnar.");
      }

      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ messages: userMessages, context: currentContext }),
      });

      if (!resp.ok) {
        const errorData = await resp.json().catch(() => ({}));
        if (resp.status === 429) throw new Error("För många förfrågningar. Vänta en stund.");
        if (resp.status === 402) throw new Error("AI-krediter slut. Kontakta administratören.");
        throw new Error(errorData.error || `Begäran misslyckades med status ${resp.status}`);
      }
      if (!resp.body) throw new Error("Inget svar");

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
                  return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: assistantContent } : m);
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

  const sendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;
    const userMessage: Message = { role: "user", content: text.trim() };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);
    setSuggestedFollowups([]);
    setProactiveInsights([]); // Clear insights once user starts chatting

    try {
      const apiMessages = newMessages.filter((_, i) => i > 0);
      const response = await streamChat(apiMessages, context);

      const followups = extractFollowups(response);
      if (followups.length > 0) {
        setSuggestedFollowups(followups);
        const cleaned = stripFollowups(response);
        setMessages((prev) => {
          const copy = [...prev];
          if (copy[copy.length - 1]?.role === "assistant") {
            copy[copy.length - 1] = { ...copy[copy.length - 1], content: cleaned };
          }
          return copy;
        });
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

  const handleSend = () => sendMessage(input);

  const handleFollowupClick = (question: string) => {
    sendMessage(question);
  };

  const executeAction = useCallback((action: GunnarAction) => {
    switch (action.action) {
      case "selectInTree":
        if (action.fmGuids?.length) {
          setAiSelectedFmGuids(action.fmGuids);
          setActiveApp('navigator');
          onClose();
          toast.success(`Visar ${action.fmGuids.length} objekt i Navigatorn`);
        }
        break;
      case "showFloor":
        if (action.floorFmGuid) {
          window.dispatchEvent(new CustomEvent('GUNNAR_SHOW_FLOOR', { detail: { floorFmGuid: action.floorFmGuid } }));
          toast.success('Byter våning');
        }
        break;
      case "highlight":
        if (action.fmGuids?.length) {
          window.dispatchEvent(new CustomEvent('GUNNAR_HIGHLIGHT', { detail: { fmGuids: action.fmGuids } }));
          toast.success(`Markerar ${action.fmGuids.length} objekt`);
        }
        break;
      case "switchTo2D":
        window.dispatchEvent(new CustomEvent(VIEW_MODE_REQUESTED_EVENT, { detail: { mode: '2d' } }));
        toast.success('Byter till 2D');
        break;
      case "switchTo3D":
        window.dispatchEvent(new CustomEvent(VIEW_MODE_REQUESTED_EVENT, { detail: { mode: '3d' } }));
        toast.success('Byter till 3D');
        break;
      case "flyTo":
        if (action.fmGuid) {
          window.dispatchEvent(new CustomEvent('GUNNAR_FLY_TO', { detail: { fmGuid: action.fmGuid } }));
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

  /** Parse action:type:payload links and dispatch the appropriate action */
  const handleActionLink = useCallback((href: string) => {
    const match = href.match(/^action:(\w+):(.*)$/);
    if (!match) return;
    const [, actionType, payload] = match;
    switch (actionType) {
      case "flyTo":
        executeAction({ action: "flyTo", fmGuid: payload });
        break;
      case "openViewer":
        executeAction({ action: "openViewer", fmGuid: payload });
        break;
      case "showFloor":
        executeAction({ action: "showFloor", floorFmGuid: payload });
        break;
      case "selectInTree":
        executeAction({ action: "selectInTree", fmGuids: payload.split(",").filter(Boolean) });
        break;
      case "switchTo2D":
        executeAction({ action: "switchTo2D" });
        break;
      case "switchTo3D":
        executeAction({ action: "switchTo3D" });
        break;
    }
  }, [executeAction]);

  /** Custom renderers for react-markdown to intercept action links */
  const markdownComponents: Components = useMemo(() => ({
    a: ({ href, children }) => {
      if (href?.startsWith("action:")) {
        return (
          <Button
            variant="outline"
            size="sm"
            className="inline-flex items-center gap-1 h-6 px-2 py-0 text-xs align-baseline mx-0.5"
            onClick={(e) => {
              e.preventDefault();
              handleActionLink(href);
            }}
          >
            {children}
          </Button>
        );
      }
      return <a href={href} target="_blank" rel="noopener noreferrer" className="underline text-primary">{children}</a>;
    },
  }), [handleActionLink]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
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
              {context?.currentBuilding?.name || "AI Fastighetsassistent"}
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
            <div key={i} className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
              <div className={cn(
                "max-w-[85%] rounded-lg px-4 py-2 text-sm",
                msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
              )}>
                {msg.role === "assistant" ? (
                  <div className="prose prose-sm dark:prose-invert max-w-none [&>p]:my-1 [&>ul]:my-1 [&>ol]:my-1">
                    <ReactMarkdown components={markdownComponents}>{msg.content}</ReactMarkdown>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                )}
              </div>
            </div>
          ))}

          {/* Proactive insights banner */}
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
        {suggestedFollowups.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {suggestedFollowups.map((q, i) => (
              <Button key={i} onClick={() => handleFollowupClick(q)} className="gap-1.5 text-xs h-7" variant="outline" size="sm">
                {q}
              </Button>
            ))}
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

  if (embedded) {
    return <div className="flex flex-col h-full">{chatContent}</div>;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
      <div className="flex h-[92vh] sm:h-[90vh] w-full max-w-2xl flex-col rounded-t-xl sm:rounded-xl border border-border bg-background shadow-2xl">
        {chatContent}
      </div>
    </div>
  );
}
