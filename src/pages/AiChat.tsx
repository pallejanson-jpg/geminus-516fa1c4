import { useSearchParams } from "react-router-dom";
import { useMemo, useState, useCallback, useEffect, lazy, Suspense } from "react";
import GeminusAIChat from "@/components/chat/GunnarChat";
import type { GeminusAIContext } from "@/components/chat/GunnarChat";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2 } from "lucide-react";

const NativeViewerShell = lazy(() => import("@/components/viewer/NativeViewerShell"));

interface BuildingOption {
  fmGuid: string;
  name: string;
}

const AiChat = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [autoVoice, setAutoVoice] = useState(searchParams.get("voice") === "true");
  const [buildings, setBuildings] = useState<BuildingOption[]>([]);
  const [selectedFmGuid, setSelectedFmGuid] = useState<string>(searchParams.get("building") || "");

  // Fetch buildings with BIM models from building_settings
  useEffect(() => {
    supabase
      .from("building_settings")
      .select("fm_guid, display_name")
      .order("display_name")
      .then(({ data }) => {
        if (data?.length) {
          setBuildings(data.map((b: any) => ({ fmGuid: b.fm_guid, name: b.display_name || b.fm_guid })));
        }
      });
  }, []);

  const selectedBuilding = useMemo(
    () => buildings.find(b => b.fmGuid === selectedFmGuid) ?? null,
    [buildings, selectedFmGuid]
  );

  const handleBuildingChange = useCallback((fmGuid: string) => {
    setSelectedFmGuid(fmGuid);
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (fmGuid) next.set("building", fmGuid); else next.delete("building");
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const context = useMemo<GeminusAIContext>(() => ({
    activeApp: "ai-standalone",
    currentBuilding: selectedBuilding ? { fmGuid: selectedBuilding.fmGuid, name: selectedBuilding.name } : undefined,
  }), [selectedBuilding]);

  const handleClose = useCallback(() => {}, []);
  const handleAutoVoiceConsumed = useCallback(() => setAutoVoice(false), []);
  const handleViewerClose = useCallback(() => {}, []);

  // Swap PWA manifest + meta tags
  useEffect(() => {
    const manifestLink = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    const originalHref = manifestLink?.getAttribute("href");
    if (manifestLink) manifestLink.setAttribute("href", "/manifest-ai.json");
    const setMeta = (name: string, content: string) => {
      let el = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
      if (!el) { el = document.createElement("meta"); el.name = name; document.head.appendChild(el); }
      return { el, prev: el.getAttribute("content") };
    };
    const title = setMeta("apple-mobile-web-app-title", "Geminus AI");
    const capable = setMeta("apple-mobile-web-app-capable", "yes");
    const prevTitle = document.title;
    document.title = "Geminus AI";
    return () => {
      if (manifestLink && originalHref) manifestLink.setAttribute("href", originalHref);
      if (title.prev !== null) title.el.setAttribute("content", title.prev);
      if (capable.prev !== null) capable.el.setAttribute("content", capable.prev);
      document.title = prevTitle;
    };
  }, []);

  const buildingDropdown = (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-background/95 backdrop-blur shrink-0">
      <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
      <Select value={selectedFmGuid || "__none__"} onValueChange={v => handleBuildingChange(v === "__none__" ? "" : v)}>
        <SelectTrigger className="h-8 text-sm border-0 shadow-none bg-transparent focus:ring-0 w-full max-w-xs">
          <SelectValue placeholder="Select building…" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">No building selected</SelectItem>
          {buildings.map(b => (
            <SelectItem key={b.fmGuid} value={b.fmGuid}>{b.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  // Split layout: viewer left, AI right (desktop with building selected)
  if (selectedBuilding) {
    return (
      <div className="h-screen w-screen flex flex-col bg-background overflow-hidden">
        {buildingDropdown}
        <div className="flex flex-1 min-h-0">
          {/* 3D Viewer — hidden on narrow screens */}
          <div className="hidden md:flex flex-col flex-1 min-w-0 border-r border-border">
            <Suspense fallback={<div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">Loading viewer…</div>}>
              <NativeViewerShell
                buildingFmGuid={selectedBuilding.fmGuid}
                onClose={handleViewerClose}
                hideBackButton
                hideMobileOverlay
                showGeminusMenu={false}
              />
            </Suspense>
          </div>
          {/* AI Chat */}
          <div className="flex flex-col w-full md:w-[420px] md:shrink-0 min-h-0 overflow-hidden">
            <GeminusAIChat
              open={true}
              onClose={handleClose}
              context={context}
              embedded
              autoVoice={autoVoice}
              onAutoVoiceConsumed={handleAutoVoiceConsumed}
            />
          </div>
        </div>
      </div>
    );
  }

  // No building: centered card with dropdown inside
  return (
    <div className="h-screen w-screen bg-black/90 flex items-center justify-center">
      <div
        className="relative flex flex-col overflow-hidden rounded-2xl shadow-2xl border border-white/10 bg-background"
        style={{ width: "min(440px, 100vw)", height: "min(720px, 100vh)" }}
      >
        {buildingDropdown}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <GeminusAIChat
            open={true}
            onClose={handleClose}
            context={context}
            embedded
            autoVoice={autoVoice}
            onAutoVoiceConsumed={handleAutoVoiceConsumed}
          />
        </div>
      </div>
    </div>
  );
};

export default AiChat;
