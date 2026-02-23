import { useEffect, useState } from "react";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";

/**
 * Callback page for Autodesk 3-legged OAuth.
 * Opened as a popup from ApiSettingsModal.
 * Captures the authorization code from the URL and sends it back to the parent window.
 */
const AutodeskCallback = () => {
  const [status, setStatus] = useState<"processing" | "success" | "error">("processing");
  const [message, setMessage] = useState("Processing Autodesk login...");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const error = params.get("error");
    const errorDescription = params.get("error_description");

    if (error) {
      setStatus("error");
      setMessage(errorDescription || error || "Autodesk login failed.");
      if (window.opener) {
        window.opener.postMessage({ type: "autodesk-oauth-error", error: errorDescription || error }, "*");
      }
      return;
    }

    if (!code) {
      setStatus("error");
      setMessage("No authorization code received.");
      return;
    }

    // Send the code back to the parent window
    if (window.opener) {
      window.opener.postMessage({ type: "autodesk-oauth-callback", code }, "*");
      setStatus("success");
      setMessage("Login successful! You can close this window.");
      setTimeout(() => window.close(), 1500);
    } else {
      setStatus("error");
      setMessage("Could not communicate with the main window. Close this window and try again.");
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
