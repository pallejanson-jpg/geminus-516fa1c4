import { useEffect, useState } from "react";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";

/**
 * Callback page for Keycloak authorization_code flow (Geminus Plus).
 * Opened as a popup from FormaToGeminusPlusPanel / IfcToGeminusPlusPanel.
 * Sends the code back to the opener via postMessage, then closes.
 */
const KeycloakCallback = () => {
  const [status, setStatus] = useState<"processing" | "success" | "error">("processing");
  const [message, setMessage] = useState("Ansluter till Geminus Plus...");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const error = params.get("error");
    const errorDescription = params.get("error_description");

    if (error) {
      setStatus("error");
      setMessage(errorDescription || error || "Keycloak login misslyckades.");
      if (window.opener) {
        window.opener.postMessage({ type: "keycloak-oauth-error", error: errorDescription || error }, "*");
      }
      return;
    }

    if (!code) {
      setStatus("error");
      setMessage("Ingen auktoriseringskod mottogs.");
      return;
    }

    if (window.opener) {
      window.opener.postMessage({ type: "keycloak-oauth-callback", code }, "*");
      setStatus("success");
      setMessage("Inloggning lyckades! Stänger fönstret...");
      setTimeout(() => window.close(), 1200);
    } else {
      setStatus("error");
      setMessage("Kunde inte kommunicera med huvudfönstret. Stäng detta fönster och försök igen.");
    }
  }, []);

  return (
    <div className="flex items-center justify-center min-h-screen bg-background p-4">
      <div className="text-center space-y-4 max-w-sm">
        {status === "processing" && <Loader2 className="h-10 w-10 animate-spin mx-auto text-primary" />}
        {status === "success" && <CheckCircle2 className="h-10 w-10 mx-auto text-green-600" />}
        {status === "error" && <AlertCircle className="h-10 w-10 mx-auto text-red-600" />}
        <p className="text-base font-medium">{message}</p>
        <p className="text-xs text-muted-foreground">Geminus Plus · Keycloak SSO</p>
      </div>
    </div>
  );
};

export default KeycloakCallback;
