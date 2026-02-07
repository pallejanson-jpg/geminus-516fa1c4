import { useEffect, useState } from "react";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";

/**
 * Callback page for Autodesk 3-legged OAuth.
 * Opened as a popup from ApiSettingsModal.
 * Captures the authorization code from the URL and sends it back to the parent window.
 */
const AutodeskCallback = () => {
  const [status, setStatus] = useState<"processing" | "success" | "error">("processing");
  const [message, setMessage] = useState("Bearbetar Autodesk-inloggning...");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const error = params.get("error");
    const errorDescription = params.get("error_description");

    if (error) {
      setStatus("error");
      setMessage(errorDescription || error || "Autodesk-inloggningen misslyckades.");
      // Notify parent window
      if (window.opener) {
        window.opener.postMessage({ type: "autodesk-oauth-error", error: errorDescription || error }, "*");
      }
      return;
    }

    if (!code) {
      setStatus("error");
      setMessage("Ingen auktoriseringskod mottogs.");
      return;
    }

    // Send the code back to the parent window
    if (window.opener) {
      window.opener.postMessage({ type: "autodesk-oauth-callback", code }, "*");
      setStatus("success");
      setMessage("Inloggning lyckades! Du kan stänga detta fönster.");
      // Auto-close after a short delay
      setTimeout(() => window.close(), 1500);
    } else {
      setStatus("error");
      setMessage("Kunde inte kommunicera med huvudfönstret. Stäng detta fönster och försök igen.");
    }
  }, []);

  return (
    <div className="flex items-center justify-center min-h-screen bg-background p-4">
      <div className="text-center space-y-4 max-w-sm">
        {status === "processing" && (
          <Loader2 className="h-10 w-10 animate-spin mx-auto text-primary" />
        )}
        {status === "success" && (
          <CheckCircle2 className="h-10 w-10 mx-auto text-green-600" />
        )}
        {status === "error" && (
          <AlertCircle className="h-10 w-10 mx-auto text-red-600" />
        )}
        <p className="text-lg font-medium">{message}</p>
      </div>
    </div>
  );
};

export default AutodeskCallback;
