import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { X, Send, Sparkles, Loader2, Info, Mic, MicOff, Volume2, VolumeX } from "lucide-react";
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
import { useNavigate } from "react-router-dom";
import { useWebSpeechRecognition } from "@/hooks/useWebSpeechRecognition";
import { getGunnarSettings, saveGunnarSettings, GUNNAR_SETTINGS_CHANGED_EVENT } from "@/components/settings/GunnarSettings";
import type { GunnarSettingsData } from "@/components/settings/GunnarSettings";

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

interface GunnarAction {
  action: string;
  fmGuids?: string[];
  floorFmGuid?: string;
  modelId?: string;
  visible?: boolean;
  fmGuid?: string;
  buildingFmGuid?: string;
  buildingName?: string;
  floorName?: string;
}

/** Extract follow-up suggestions from the AI response */
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

const CLIENT_KNOWN_ACTIONS = new Set(['flyTo', 'openViewer', 'showFloor', 'selectInTree', 'switchTo2D', 'switchTo3D', 'showFloorIn3D', 'isolateModel', 'showDrawing', 'openViewer3D', 'selectBuilding', 'changeLang', 'listVoices', 'selectVoice']);

/** Strip raw action tokens that leak without markdown link syntax */
function stripRawActionTokens(content: string): string {
  // Remove [action:type:param] bracket patterns (not inside markdown links)
  let cleaned = content.replace(/\[action:[^\]]+\]/g, "");
  // Remove markdown links whose action type is unknown (e.g. [label](action:search_help_docs:...))
  cleaned = cleaned.replace(/\[([^\]]+)\]\(action:([^:)]+)[^)]*\)/g, (_match, label, actionType) => {
    if (CLIENT_KNOWN_ACTIONS.has(actionType)) return _match; // keep known actions
    return label; // render unknown as plain text
  });
  // Remove bare action:type:param tokens not wrapped in markdown
  cleaned = cleaned.replace(/(?<!\()\baction:[a-z_]+:[^\s)]+/gi, "");
  return cleaned.replace(/\n{3,}/g, "\n\n").trim();
}

function getContextualGreeting(context?: GunnarContext): string {
   if (context?.activeApp === 'support') {
     return `Hi! You're in the support section. Ask me about how the platform works, available features, or how to solve a specific problem!`;
   }
   if (context?.activeApp === 'fma_plus' || context?.activeApp === 'fma_native') {
     const bName = context?.currentBuilding?.name;
     if (bName) {
       return `Hi! You're working in FM Access for **${bName}**. Ask me about rooms, equipment, documents, drawings, or work orders!`;
     }
     return `Hi! You're working in FM Access. Select a building and I can answer questions about rooms, documents, and equipment.`;
   }
   if (context?.currentBuilding?.name) {
     return `Hi! I see you're looking at **${context.currentBuilding.name}**. Ask me about floors, rooms, areas, assets, drawings, fault reports, or issues!`;
   }
   if (context?.activeApp === 'assetplus_viewer' || context?.activeApp === 'native_viewer') {
     return `Hi! You're in the 3D viewer. I can help you navigate, explore floors, show models, or find specific objects. Try asking "How many rooms are there?" or "Show floor 2 in 3D".`;
   }
   if (context?.activeApp === 'navigator') {
     return `Hi! You're in the Navigator. I can help you find rooms, assets, or building components. What are you looking for?`;
   }
   if (context?.activeApp === 'portfolio') {
    return `Hi! I'm Geminus AI, your facility assistant. I can tell you about all buildings in the portfolio — ask about rooms, areas, floors, drawings, or specific assets!`;
   }
   return `Hi! I'm Geminus AI, your AI assistant for facility data. Ask me about:\n\n• Buildings, floors, rooms, and areas\n• Equipment and assets\n• Drawings from FM Access\n• Fault reports and issues\n• 3D model navigation\n• IoT sensor data\n• Platform help\n\nWhat would you like to know?`;
}

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/gunnar-chat`;

const GunnarChat = React.forwardRef<HTMLDivElement, GunnarChatProps>(function GunnarChat({ open, onClose, context, embedded, autoVoice, onAutoVoiceConsumed }, _ref) {
  const navigate = useNavigate();
  const { setAiSelectedFmGuids, setActiveApp, setSelectedFacility, setViewer3dFmGuid } = useApp();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [suggestedFollowups, setSuggestedFollowups] = useState<string[]>([]);
  const [proactiveInsights, setProactiveInsights] = useState<string[]>([]);
  const [voiceOutputEnabled, setVoiceOutputEnabled] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
   const scrollRef = useRef<HTMLDivElement>(null);
   const messagesEndRef = useRef<HTMLDivElement>(null);
   const inputRef = useRef<HTMLInputElement>(null);
  const { toast: toastHook } = useToast();
  const prevContextRef = useRef<string>("");
  const proactiveFetchedRef = useRef<string>("");
  const abortRef = useRef<AbortController | null>(null);
  const spokenMessageKeyRef = useRef<string>("");
  const ttsUnlockedRef = useRef(false);
  // Local override for building context set via selectBuilding (avoids AppContext navigation)
  const [localBuildingContext, setLocalBuildingContext] = useState<{ fmGuid: string; name: string } | null>(null);

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

  const currentBuildingRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const buildingKey = context?.currentBuilding?.fmGuid;
    if (buildingKey !== currentBuildingRef.current) {
      currentBuildingRef.current = buildingKey;
      // Only reset if conversation is empty or just has the initial greeting
      // Don't reset if user has an active conversation (more than 1 message)
      if (messages.length <= 1) {
        setMessages([{ role: "assistant", content: getContextualGreeting(context) }]);
        setSuggestedFollowups([]);
        setProactiveInsights([]);
        proactiveFetchedRef.current = "";
      }
    }
  }, [context?.currentBuilding?.fmGuid]);

   useEffect(() => {
     // Use messagesEndRef for reliable auto-scroll inside Radix ScrollArea
     if (messagesEndRef.current) {
       messagesEndRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
     }
   }, [messages, proactiveInsights]);

  useEffect(() => {
    if (open && inputRef.current) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  /** Clean text for TTS: remove markdown, normalize for natural prosody */
  const cleanSpeechText = useCallback((text: string) => {
    return stripFollowups(text)
      // Remove markdown links but keep label
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
      // Remove markdown formatting
      .replace(/[*_`#>]/g, "")
      // Convert list markers to pauses
      .replace(/^[-•]\s+/gm, ", ")
      .replace(/^\d+\.\s+/gm, ", ")
      // Add natural pauses after sentences
      .replace(/\.\s+/g, ". ... ")
      // Collapse whitespace
      .replace(/\s+/g, " ")
      .trim();
  }, []);

  /** Pick the best available voice for a language */
  const getBestVoice = useCallback((lang: string, preferredName?: string | null): SpeechSynthesisVoice | null => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
    const voices = window.speechSynthesis.getVoices();
    
    // If user chose a specific voice, use it
    if (preferredName) {
      const match = voices.find(v => v.name === preferredName);
      if (match) return match;
    }
    
    // Filter by language
    const langPrefix = lang.split('-')[0];
    const langVoices = voices.filter(v => v.lang.startsWith(langPrefix));
    if (langVoices.length === 0) return null;
    
    // Quality scoring: prefer neural/wavenet/studio voices
    const highQualityKeywords = ['neural', 'wavenet', 'studio'];
    const qualityKeywords = ['natural', 'premium', 'enhanced', 'google', 'microsoft', 'siri', 'samantha', 'daniel'];
    const scored = langVoices.map(v => {
      let score = 0;
      const nameLower = v.name.toLowerCase();
      for (const kw of highQualityKeywords) {
        if (nameLower.includes(kw)) score += 20;
      }
      for (const kw of qualityKeywords) {
        if (nameLower.includes(kw)) score += 10;
      }
      // Prefer non-local voices (usually higher quality network voices)
      if (!v.localService) score += 5;
      // Exact lang match is better
      if (v.lang === lang) score += 3;
      // Default voice gets a small boost
      if (v.default) score += 1;
      return { voice: v, score };
    });
    
    scored.sort((a, b) => b.score - a.score);
    return scored[0]?.voice || null;
  }, []);

  const speakAssistant = useCallback((text: string) => {
    if (!voiceOutputEnabled || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const cleaned = cleanSpeechText(text);
    if (!cleaned) return;
    window.speechSynthesis.cancel();
    const settings = getGunnarSettings();
    
    // Split on sentences AND commas/semicolons for more natural phrasing
    const segments = cleaned.split(/(?<=[.!?;,])\s+/).filter(s => s.trim());
    
    const bestVoice = getBestVoice(settings.speechLang, settings.voiceName);
    
    // Prosody tuning — slower for more natural delivery
    const baseRate = settings.speechLang === 'sv-SE' ? 0.85 : 0.88;
    
    segments.forEach((segment, i) => {
      const utterance = new SpeechSynthesisUtterance(segment.replace(/\.\.\./g, ''));
      utterance.lang = settings.speechLang;
      utterance.rate = baseRate;
      // Slight pitch variation between segments for natural prosody
      utterance.pitch = 1.0 + (i % 2 === 0 ? 0.03 : -0.03);
      utterance.volume = 0.9;
      if (bestVoice) utterance.voice = bestVoice;
      if (i === 0) utterance.onstart = () => setIsSpeaking(true);
      if (i === segments.length - 1) {
        utterance.onend = () => setIsSpeaking(false);
        utterance.onerror = () => setIsSpeaking(false);
      }
      window.speechSynthesis.speak(utterance);
    });
  }, [cleanSpeechText, voiceOutputEnabled, getBestVoice]);

  // Compute effective context: merge local building override with prop context
  const effectiveContext = useMemo<GunnarContext | undefined>(() => {
    if (!localBuildingContext) return context;
    return {
      ...context,
      activeApp: context?.activeApp || 'ai-standalone',
      currentBuilding: localBuildingContext,
    };
  }, [context, localBuildingContext]);

  const streamChat = useCallback(
    async (userMessages: Message[], currentContext?: GunnarContext, advisorMode?: boolean) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error("You must be logged in to use Gunnar.");
      }

      const controller = new AbortController();
      abortRef.current = controller;
      const timeout = setTimeout(() => controller.abort(), 60000);

      try {
        const resp = await fetch(CHAT_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            messages: userMessages,
            context: currentContext,
            ...(advisorMode ? { advisor: true } : {}),
          }),
          signal: controller.signal,
        });

      if (!resp.ok) {
          const errorData = await resp.json().catch(() => ({}));
          if (resp.status === 429) throw { status: 429, message: "Too many requests. Please wait and try again." };
          if (resp.status === 402) throw { status: 402, message: "AI credits used up. Contact your administrator." };
          if (resp.status === 401) throw { status: 401, message: "You are not logged in. Please log in and try again." };
          if (resp.status === 503) throw { status: 503, message: "AI service temporarily unavailable. Try again shortly." };
          throw new Error(errorData.error || `Request failed (${resp.status})`);
        }
        if (!resp.body) throw new Error("No response");

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
      } finally {
        clearTimeout(timeout);
        abortRef.current = null;
      }
    },
    []
  );

  /** Trim conversation history: keep last 8 turns, strip action tokens from assistant messages */
  const trimHistory = useCallback((msgs: Message[]): Message[] => {
    const trimmed = msgs.slice(-12);
    return trimmed.map(m => {
      if (m.role === 'assistant') {
        // Strip action links to reduce token count
        const cleaned = m.content
          .replace(/\[([^\]]*)\]\(action:[^)]+\)/g, '$1')
          .replace(/\*\*(?:Förslag|Suggestions):\*\*[\s\S]*$/i, '')
          .trim();
        return { ...m, content: cleaned };
      }
      return m;
    });
  }, []);

  const sendMessage = async (text: string, advisorMode?: boolean) => {
    if ((!text.trim() && !advisorMode) || isLoading) return;
    const userMessage: Message = { role: "user", content: advisorMode ? "Analyze this building and give me advice" : text.trim() };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);
    setSuggestedFollowups([]);
    setProactiveInsights([]);

    try {
      const apiMessages = trimHistory(newMessages.filter((_, i) => i > 0));
      const response = await streamChat(apiMessages, effectiveContext, advisorMode);

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
      const isAbort = error instanceof DOMException && error.name === "AbortError";
      const errStatus = (error as any)?.status;
      const errMsg = isAbort
        ? "Request timed out. Please try again."
        : (error as any)?.message || (error instanceof Error ? error.message : "Could not fetch response");
      
      toastHook({
        variant: "destructive",
        title: errStatus === 429 ? "Rate limit" : errStatus === 402 ? "Credits" : errStatus === 503 ? "Service error" : "Error",
        description: errMsg,
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

  const speechSettings = getGunnarSettings();

  const {
    isListening,
    interimTranscript,
    isSupported: isVoiceSupported,
    start: startListening,
    stop: stopListening,
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
    if (isListening) stopListening();
    else startListening();
  }, [isListening, isLoading, isVoiceSupported, startListening, stopListening]);

  /** Toggle TTS with iOS unlock on first enable */
  const toggleVoiceOutput = useCallback(() => {
    if (voiceOutputEnabled) {
      window.speechSynthesis?.cancel();
      setVoiceOutputEnabled(false);
    } else {
      // iOS requires a user-gesture-initiated speak() to unlock the API
      if (!ttsUnlockedRef.current && 'speechSynthesis' in window) {
        const unlock = new SpeechSynthesisUtterance('');
        unlock.volume = 0;
        window.speechSynthesis.speak(unlock);
        ttsUnlockedRef.current = true;
      }
      setVoiceOutputEnabled(true);
    }
  }, [voiceOutputEnabled]);

  // Auto-start voice mode when opened via deep link (?gunnar=voice)
  useEffect(() => {
    if (autoVoice && open && isVoiceSupported && !isListening) {
      setVoiceOutputEnabled(true);
      // Small delay to let the UI render first
      const timer = setTimeout(() => {
        startListening();
        onAutoVoiceConsumed?.();
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [autoVoice, open, isVoiceSupported]); // eslint-disable-line react-hooks/exhaustive-deps

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
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // Whether we're in embedded side-panel mode (not standalone /ai, not overlay)
  const isEmbeddedPanel = !!embedded && context?.activeApp !== 'ai-standalone';
  const isStandaloneAi = context?.activeApp === 'ai-standalone';
  // Standalone plugin: embedded but without a viewer listening (PWA mode)
  const isStandalonePlugin = !!embedded && !!(context as any)?.contextMetadata?.standalone;
  // True for BOTH standalone AI and standalone plugin — never navigate away
  const isStandaloneContext = isStandaloneAi || isStandalonePlugin;

  // In standalone mode (/ai), never close back to "/" after action navigation.
  const closeAfterAction = useCallback(() => {
    if (embedded || isStandaloneAi) return;
    onClose();
  }, [embedded, isStandaloneAi, onClose]);




  const viewerReturnToSuffix = isStandaloneAi ? '&returnTo=%2Fai' : '';

  /** Viewer/app actions that require the full Geminus app */
  const VIEWER_ACTIONS = new Set([
    'selectInTree', 'showFloor', 'highlight', 'flyTo',
    'switchTo2D', 'switchTo3D', 'openViewer', 'showFloorIn3D',
    'isolateModel', 'showDrawing', 'openViewer3D',
  ]);

  const executeAction = useCallback((action: GunnarAction) => {
    // In standalone context (AI PWA or Plugin PWA), block ALL viewer/app actions
    if (isStandaloneContext && VIEWER_ACTIONS.has(action.action)) {
      toast.info('Den här funktionen kräver Geminus-appen med 3D-viewer. Öppna huvudappen för att visa detta.');
      return;
    }

    switch (action.action) {
      case "selectInTree":
        if (action.fmGuids?.length) {
          setAiSelectedFmGuids(action.fmGuids);
          setActiveApp('navigator');
          closeAfterAction();
          toast.success(`Showing ${action.fmGuids.length} objects in Navigator`);
        }
        break;
      case "showFloor":
        if (action.floorFmGuid) {
          window.dispatchEvent(new CustomEvent('GUNNAR_SHOW_FLOOR', { detail: { floorFmGuid: action.floorFmGuid } }));
          toast.success('Switching floor');
        }
        break;
      case "highlight":
        if (action.fmGuids?.length) {
          window.dispatchEvent(new CustomEvent('GUNNAR_HIGHLIGHT', { detail: { fmGuids: action.fmGuids } }));
          toast.success(`Highlighting ${action.fmGuids.length} objects`);
        }
        break;
      case "switchTo2D":
        window.dispatchEvent(new CustomEvent(VIEW_MODE_REQUESTED_EVENT, { detail: { mode: '2d' } }));
        toast.success('Switching to 2D');
        break;
      case "switchTo3D":
        window.dispatchEvent(new CustomEvent(VIEW_MODE_REQUESTED_EVENT, { detail: { mode: '3d' } }));
        toast.success('Switching to 3D');
        break;
      case "flyTo":
        if (action.fmGuid) {
          window.dispatchEvent(new CustomEvent('GUNNAR_FLY_TO', { detail: { fmGuid: action.fmGuid } }));
          toast.success('Flying to object');
        }
        break;
      case "openViewer":
        if (action.fmGuid) {
          if (isEmbeddedPanel) {
            setViewer3dFmGuid(action.fmGuid);
            window.dispatchEvent(new CustomEvent(VIEW_MODE_REQUESTED_EVENT, { detail: { mode: '3d' } }));
            toast.success('Öppnar 3D-viewer');
          } else {
            navigate(`/viewer?building=${action.fmGuid}&mode=3d${viewerReturnToSuffix}`);
            closeAfterAction();
            toast.success('Öppnar 3D-viewer');
          }
        }
        break;
      case "showFloorIn3D":
        if (action.buildingFmGuid && action.floorFmGuid) {
          const floorName = action.floorName || '';
          if (isEmbeddedPanel) {
            setViewer3dFmGuid(action.buildingFmGuid);
            setTimeout(() => {
              window.dispatchEvent(new CustomEvent(VIEW_MODE_REQUESTED_EVENT, { detail: { mode: '3d' } }));
              window.dispatchEvent(new CustomEvent('GUNNAR_SHOW_FLOOR', { detail: { floorFmGuid: action.floorFmGuid } }));
            }, 300);
            toast.success(`Visar ${floorName || 'våning'} i 3D`);
          } else {
            navigate(`/viewer?building=${action.buildingFmGuid}&mode=3d&floor=${action.floorFmGuid}&floorName=${encodeURIComponent(floorName)}${viewerReturnToSuffix}`);
            closeAfterAction();
            toast.success(`Visar ${floorName || 'våning'} i 3D`);
          }
        }
        break;
      case "isolateModel":
        if (action.buildingFmGuid && action.modelId) {
          if (isEmbeddedPanel) {
            setViewer3dFmGuid(action.buildingFmGuid);
            setTimeout(() => {
              window.dispatchEvent(new CustomEvent(VIEW_MODE_REQUESTED_EVENT, { detail: { mode: '3d' } }));
              window.dispatchEvent(new CustomEvent('GUNNAR_ISOLATE_MODEL', { detail: { modelId: action.modelId } }));
            }, 300);
            toast.success(`Isolerar modell`);
          } else {
            navigate(`/viewer?building=${action.buildingFmGuid}&mode=3d${viewerReturnToSuffix}`);
            setTimeout(() => {
              window.dispatchEvent(new CustomEvent('GUNNAR_ISOLATE_MODEL', { detail: { modelId: action.modelId } }));
            }, 500);
            closeAfterAction();
            toast.success(`Isolerar modell`);
          }
        }
        break;
      case "showDrawing":
        if (action.buildingFmGuid) {
          const floorName = action.floorName || '';
          if (isEmbeddedPanel) {
            setViewer3dFmGuid(action.buildingFmGuid);
            setTimeout(() => {
              window.dispatchEvent(new CustomEvent(VIEW_MODE_REQUESTED_EVENT, { detail: { mode: '2d' } }));
            }, 300);
            toast.success(`Visar ritning${floorName ? ` för ${floorName}` : ''}`);
          } else {
            navigate(`/viewer?building=${action.buildingFmGuid}&mode=2d&floorName=${encodeURIComponent(floorName)}${viewerReturnToSuffix}`);
            closeAfterAction();
            toast.success(`Visar ritning${floorName ? ` för ${floorName}` : ''}`);
          }
        }
        break;
      case "openViewer3D":
        if (action.buildingFmGuid) {
          if (isEmbeddedPanel) {
            setViewer3dFmGuid(action.buildingFmGuid);
            setTimeout(() => {
              window.dispatchEvent(new CustomEvent(VIEW_MODE_REQUESTED_EVENT, { detail: { mode: '3d' } }));
              if (action.floorFmGuid) {
                window.dispatchEvent(new CustomEvent('GUNNAR_SHOW_FLOOR', { detail: { floorFmGuid: action.floorFmGuid } }));
              }
            }, 300);
            toast.success('Öppnar 3D-viewer');
          } else {
            const floorPart = action.floorFmGuid ? `&floor=${action.floorFmGuid}` : '';
            navigate(`/viewer?building=${action.buildingFmGuid}&mode=3d${floorPart}${viewerReturnToSuffix}`);
            closeAfterAction();
            toast.success('Öppnar 3D-viewer');
          }
        }
        break;
      case "selectBuilding":
        if (action.buildingFmGuid) {
          const bName = action.buildingName || 'byggnaden';
          // Set local building context — avoids AppContext navigation/reset
          setLocalBuildingContext({ fmGuid: action.buildingFmGuid, name: bName });
          // Send follow-up with explicit building reference
          void sendMessage(`Berätta om ${bName}`);
        }
        break;
    }
  }, [setAiSelectedFmGuids, setActiveApp, closeAfterAction, setViewer3dFmGuid, navigate, viewerReturnToSuffix, isEmbeddedPanel, isStandaloneContext]);

  /** Parse action:type:payload links and dispatch the appropriate action */
  const handleActionLink = useCallback((href: string) => {
    const parts = href.replace(/^action:/, '').split(':');
    const actionType = parts[0];
    
    switch (actionType) {
      case "flyTo":
        executeAction({ action: "flyTo", fmGuid: parts[1] });
        break;
      case "openViewer":
        executeAction({ action: "openViewer", fmGuid: parts[1] });
        break;
      case "showFloor":
        executeAction({ action: "showFloor", floorFmGuid: parts[1] });
        break;
      case "selectInTree":
        executeAction({ action: "selectInTree", fmGuids: parts[1]?.split(",").filter(Boolean) });
        break;
      case "switchTo2D":
        executeAction({ action: "switchTo2D" });
        break;
      case "switchTo3D":
        executeAction({ action: "switchTo3D" });
        break;
      case "showFloorIn3D":
        executeAction({ 
          action: "showFloorIn3D", 
          buildingFmGuid: parts[1], 
          floorFmGuid: parts[2],
          floorName: parts[3] ? decodeURIComponent(parts[3]) : undefined,
        });
        break;
      case "isolateModel":
        executeAction({ 
          action: "isolateModel", 
          buildingFmGuid: parts[1], 
          modelId: parts[2],
        });
        break;
      case "showDrawing":
        executeAction({ 
          action: "showDrawing", 
          buildingFmGuid: parts[1], 
          floorName: parts[2] ? decodeURIComponent(parts[2]) : undefined,
        });
        break;
      case "openViewer3D":
        executeAction({ 
          action: "openViewer3D", 
          buildingFmGuid: parts[1], 
          floorFmGuid: parts[2],
        });
        break;
      case "selectBuilding":
        executeAction({
          action: "selectBuilding",
          buildingFmGuid: parts[1],
          buildingName: parts[2] ? decodeURIComponent(parts[2]) : undefined,
        });
        break;
      case "changeLang": {
        const lang = parts[1] as 'sv-SE' | 'en-US';
        if (lang === 'sv-SE' || lang === 'en-US') {
          saveGunnarSettings({ speechLang: lang, voiceName: null });
          const label = lang === 'sv-SE' ? 'Svenska' : 'English';
          const confirmMsg: Message = { role: "assistant", content: `✅ Språk ändrat till **${label}**. Både röstinmatning och uppläsning använder nu ${label}.` };
          setMessages(prev => [...prev, confirmMsg]);
          toast.success(`Language changed to ${label}`);
        }
        break;
      }
      case "listVoices": {
        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
          const currentSettings = getGunnarSettings();
          const allVoices = window.speechSynthesis.getVoices();
          const langPrefix = currentSettings.speechLang.split('-')[0];
          const filtered = allVoices.filter(v => v.lang.startsWith(langPrefix));
          if (filtered.length === 0) {
            setMessages(prev => [...prev, { role: "assistant", content: "No voices available for the selected language in this browser." }]);
          } else {
            const buttons = filtered.map(v => `[🔊 ${v.name}](action:selectVoice:${encodeURIComponent(v.name)})`).join('\n');
            setMessages(prev => [...prev, { role: "assistant", content: `Choose a voice:\n\n${buttons}` }]);
          }
        }
        break;
      }
      case "selectVoice": {
        const voiceName = parts[1] ? decodeURIComponent(parts[1]) : null;
        saveGunnarSettings({ voiceName });
        const confirmMsg: Message = { role: "assistant", content: `✅ Röst ändrad till **${voiceName || 'System default'}**.` };
        setMessages(prev => [...prev, confirmMsg]);
        toast.success(`Voice changed to ${voiceName || 'System default'}`);
        break;
      }
      default:
        console.warn(`Unknown action type: ${actionType}`);
        toast.info("This action is not available.");
        break;
    }
    } catch (err) {
      console.error("Action execution failed:", err);
      toast.error("Something went wrong executing that action.");
    }
  }, [executeAction]);

  const KNOWN_ACTIONS = new Set(['flyTo', 'openViewer', 'showFloor', 'selectInTree', 'switchTo2D', 'switchTo3D', 'showFloorIn3D', 'isolateModel', 'showDrawing', 'openViewer3D', 'selectBuilding', 'changeLang', 'listVoices', 'selectVoice']);

  /** Custom renderers for react-markdown to intercept action links */
  const markdownComponents: Components = useMemo(() => ({
    a: ({ href, children }) => {
      if (href?.startsWith("action:")) {
        // Sanitize: only render as button if the action type is known
        const actionType = href.replace(/^action:/, '').split(':')[0];
        if (!KNOWN_ACTIONS.has(actionType)) {
          // Unknown action token — render as plain text, strip GUIDs
          return <span>{children}</span>;
        }
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
            <h2 className="font-semibold">Geminus AI</h2>
            <p className="text-xs text-muted-foreground">
              {context?.currentBuilding?.name || "AI Property Assistant"}
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
      <ScrollArea className="flex-1 min-h-0 p-4" ref={scrollRef}>
        <div className="space-y-4">
          {messages.map((msg, i) => (
            <div key={i} className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
              <div className={cn(
                "max-w-[85%] rounded-lg px-4 py-2 text-sm",
                msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
              )}>
                {msg.role === "assistant" ? (
                  <div className="prose prose-sm dark:prose-invert max-w-none [&>p]:my-1 [&>ul]:my-1 [&>ol]:my-1">
                    <ReactMarkdown components={markdownComponents}>{stripRawActionTokens(msg.content)}</ReactMarkdown>
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
                Current status
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
                <span>Thinking...</span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="border-t border-border p-3 sm:p-4 shrink-0">
        {suggestedFollowups.length > 0 && (
          <div className="mb-2 sm:mb-3 flex flex-wrap gap-1.5 sm:gap-2">
            {suggestedFollowups.map((q, i) => (
              <Button key={i} onClick={() => handleFollowupClick(q)} className="gap-1 text-xs h-7" variant="outline" size="sm">
                {q}
              </Button>
            ))}
          </div>
        )}
        {/* Quick action: FM Advisor */}
        {messages.length <= 2 && !isLoading && (
          <div className="mb-2 sm:mb-3">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs h-7 border-primary/30 text-primary hover:bg-primary/10"
              onClick={() => sendMessage("", true)}
            >
              <Sparkles className="h-3 w-3" />
              Give me advice
            </Button>
          </div>
        )}
        <div className="flex flex-col gap-1 sm:gap-0">
          {/* Mic/speaker row - mobile only */}
          <div className="flex items-center gap-1 sm:hidden">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              onClick={toggleVoiceOutput}
              title={voiceOutputEnabled ? 'Disable voice output' : 'Enable voice output'}
            >
              {voiceOutputEnabled ? (
                <Volume2 className={cn("h-3 w-3", isSpeaking && "animate-pulse text-primary")} />
              ) : (
                <VolumeX className="h-3 w-3 text-muted-foreground" />
              )}
            </Button>
            {isVoiceSupported && (
              <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={toggleListening} disabled={isLoading}>
                {isListening ? <MicOff className="h-3 w-3 text-destructive" /> : <Mic className="h-3 w-3" />}
              </Button>
            )}
          </div>
          {/* Input row */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            {/* Mic/speaker - desktop only */}
            <div className="hidden sm:flex items-center gap-1 shrink-0">
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0"
              onClick={toggleVoiceOutput}
                title={voiceOutputEnabled ? 'Disable voice output' : 'Enable voice output'}
              >
                {voiceOutputEnabled ? (
                  <Volume2 className={cn("h-4 w-4", isSpeaking && "animate-pulse text-primary")} />
                ) : (
                  <VolumeX className="h-4 w-4 text-muted-foreground" />
                )}
              </Button>
              {isVoiceSupported && (
                <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={toggleListening} disabled={isLoading}>
                  {isListening ? <MicOff className="h-4 w-4 text-destructive" /> : <Mic className="h-4 w-4" />}
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
              className="flex-1 min-w-0"
            />
            <Button onClick={handleSend} disabled={isLoading || !input.trim()} size="icon" className="h-9 w-9 shrink-0">
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </>
  );

  if (embedded) {
    // Skip the internal header — parent component provides its own header with close button
    const embeddedContent = (
      <>
        {/* Messages */}
        <ScrollArea className="flex-1 min-h-0 p-3" ref={scrollRef}>
          <div className="space-y-3">
            {messages.map((msg, i) => (
              <div key={i} className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
                <div className={cn(
                  "max-w-[85%] rounded-lg px-3 py-2 text-sm",
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

            {proactiveInsights.length > 0 && messages.length <= 1 && (
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
                  <Info className="h-3.5 w-3.5" />
                  Current status
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
                  <span>Thinking...</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        {/* Compact input */}
        <div className="border-t border-border p-2 sm:p-3 shrink-0">
          {suggestedFollowups.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {suggestedFollowups.map((q, i) => (
                <Button key={i} onClick={() => handleFollowupClick(q)} className="gap-1 text-xs h-7" variant="outline" size="sm">
                  {q}
                </Button>
              ))}
            </div>
          )}
          <div className="flex flex-col gap-1 sm:gap-0">
            {/* Mic/speaker row - mobile only */}
            <div className="flex items-center gap-1 sm:hidden">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
              onClick={toggleVoiceOutput}
                title={voiceOutputEnabled ? 'Disable voice output' : 'Enable voice output'}
              >
                {voiceOutputEnabled ? (
                  <Volume2 className={cn("h-3 w-3", isSpeaking && "animate-pulse text-primary")} />
                ) : (
                  <VolumeX className="h-3 w-3 text-muted-foreground" />
                )}
              </Button>
              {isVoiceSupported && (
                <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={toggleListening} disabled={isLoading}>
                  {isListening ? <MicOff className="h-3 w-3 text-destructive" /> : <Mic className="h-3 w-3" />}
                </Button>
              )}
            </div>
            {/* Input row */}
            <div className="flex items-center gap-1.5 sm:gap-2">
              {/* Mic/speaker - desktop only */}
              <div className="hidden sm:flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
              onClick={toggleVoiceOutput}
                  title={voiceOutputEnabled ? 'Disable voice output' : 'Enable voice output'}
                >
                  {voiceOutputEnabled ? (
                    <Volume2 className={cn("h-3.5 w-3.5", isSpeaking && "animate-pulse text-primary")} />
                  ) : (
                    <VolumeX className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </Button>
                {isVoiceSupported && (
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={toggleListening} disabled={isLoading}>
                    {isListening ? <MicOff className="h-3.5 w-3.5 text-destructive" /> : <Mic className="h-3.5 w-3.5" />}
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
                className="flex-1 min-w-0 h-8 sm:h-9 text-sm"
              />
              <Button onClick={handleSend} disabled={isLoading || !input.trim()} className="h-8 w-8 sm:h-9 sm:w-9 shrink-0" size="icon">
                <Send className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </Button>
            </div>
          </div>
        </div>
      </>
    );
    return <div className="flex flex-col h-full min-h-0">{embeddedContent}</div>;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
      <div className="flex h-[92vh] sm:h-[90vh] w-full max-w-2xl flex-col rounded-t-xl sm:rounded-xl border border-border bg-background shadow-2xl">
        {chatContent}
      </div>
    </div>
  );
});

export default GunnarChat;
