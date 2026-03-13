import { useSearchParams, useNavigate } from "react-router-dom";
import { useMemo, useState, useCallback } from "react";
import GunnarChat from "@/components/chat/GunnarChat";
import type { GunnarContext } from "@/components/chat/GunnarChat";

const AiChat = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [autoVoice, setAutoVoice] = useState(searchParams.get("voice") === "true");

  const buildingGuid = searchParams.get("building");

  const context = useMemo<GunnarContext>(() => ({
    activeApp: "ai-standalone",
    currentBuilding: buildingGuid ? { fmGuid: buildingGuid, name: "" } : undefined,
  }), [buildingGuid]);

  const handleClose = useCallback(() => {
    navigate("/");
  }, [navigate]);

  const handleAutoVoiceConsumed = useCallback(() => {
    setAutoVoice(false);
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
