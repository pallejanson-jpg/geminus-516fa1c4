import { useSearchParams } from "react-router-dom";
import { useMemo, useState, useCallback, useEffect } from "react";
import GunnarChat from "@/components/chat/GunnarChat";
import type { GunnarContext } from "@/components/chat/GunnarChat";

const AiChat = () => {
  const [searchParams] = useSearchParams();
  const [autoVoice, setAutoVoice] = useState(searchParams.get("voice") === "true");

  const buildingGuid = searchParams.get("building");

  const context = useMemo<GunnarContext>(() => ({
    activeApp: "ai-standalone",
    currentBuilding: buildingGuid ? { fmGuid: buildingGuid, name: "" } : undefined,
  }), [buildingGuid]);

  // Standalone /ai should never auto-close back to home route.
  const handleClose = useCallback(() => {}, []);

  const handleAutoVoiceConsumed = useCallback(() => {
    setAutoVoice(false);
  }, []);

  // Swap PWA manifest + meta tags so "Add to Home Screen" uses Gunnar AI branding
  useEffect(() => {
    const manifestLink = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    const originalHref = manifestLink?.getAttribute("href");

    if (manifestLink) {
      manifestLink.setAttribute("href", "/manifest-ai.json");
    }

    // Set apple-specific PWA meta tags
    const setMeta = (name: string, content: string) => {
      let el = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
      if (!el) {
        el = document.createElement("meta");
        el.name = name;
        document.head.appendChild(el);
      }
      return { el, prev: el.getAttribute("content") };
    };

    const title = setMeta("apple-mobile-web-app-title", "Gunnar AI");
    title.el.setAttribute("content", "Gunnar AI");

    const capable = setMeta("apple-mobile-web-app-capable", "yes");
    capable.el.setAttribute("content", "yes");

    // Update document title
    const prevTitle = document.title;
    document.title = "Gunnar AI";

    return () => {
      if (manifestLink && originalHref) {
        manifestLink.setAttribute("href", originalHref);
      }
      if (title.prev !== null) title.el.setAttribute("content", title.prev);
      if (capable.prev !== null) capable.el.setAttribute("content", capable.prev);
      document.title = prevTitle;
    };
  }, []);

  return (
    <div className="h-screen w-screen bg-background">
      <GunnarChat
        open={true}
        onClose={handleClose}
        context={context}
        embedded
        autoVoice={autoVoice}
        onAutoVoiceConsumed={handleAutoVoiceConsumed}
      />
    </div>
  );
};

export default AiChat;
