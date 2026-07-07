import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

const SESSION_KEY = 'gp_access_token';
const SESSION_EXPIRY_KEY = 'gp_token_expiry';
const SESSION_VERIFIER_KEY = 'gp_pkce_verifier';

function base64urlEncode(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function generatePkce(): Promise<{ verifier: string; challenge: string }> {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  const verifier = base64urlEncode(array.buffer);
  const encoded = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', encoded);
  const challenge = base64urlEncode(hash);
  return { verifier, challenge };
}

export interface GpAuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  accessToken: string | null;
  login: () => Promise<void>;
  logout: () => void;
  error: string | null;
}

export function useGpAuth(): GpAuthState {
  const [accessToken, setAccessToken] = useState<string | null>(() => {
    const token = sessionStorage.getItem(SESSION_KEY);
    const expiry = sessionStorage.getItem(SESSION_EXPIRY_KEY);
    if (token && expiry && Date.now() < parseInt(expiry)) return token;
    return null;
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAuthenticated = !!accessToken;

  const logout = useCallback(() => {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_EXPIRY_KEY);
    setAccessToken(null);
  }, []);

  const login = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      // 1. Get Keycloak config from edge function
      const { data: cfgData, error: cfgErr } = await supabase.functions.invoke('acc-to-geminus-plus', {
        body: { action: 'get-gp-auth-config' },
      });
      if (cfgErr || !cfgData?.authUrl) {
        throw new Error(cfgData?.error || cfgErr?.message || 'Kunde inte hämta Keycloak-konfiguration');
      }
      const { authUrl, tokenUrl, clientId } = cfgData as { authUrl: string; tokenUrl: string; clientId: string };

      // 2. Generate PKCE
      const { verifier, challenge } = await generatePkce();
      sessionStorage.setItem(SESSION_VERIFIER_KEY, verifier);

      // 3. Build redirect URI (our own keycloak-callback page)
      const redirectUri = `${window.location.origin}/keycloak-callback`;

      // 4. Open popup
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid profile email',
        code_challenge: challenge,
        code_challenge_method: 'S256',
      });
      const fullAuthUrl = `${authUrl}?${params.toString()}`;
      const popup = window.open(fullAuthUrl, 'keycloak-login', 'width=520,height=620,left=100,top=100');
      if (!popup) throw new Error('Popup blockerades av webbläsaren. Tillåt popups för denna sida.');

      // 5. Wait for postMessage from KeycloakCallback page
      const code = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => {
          window.removeEventListener('message', handler);
          reject(new Error('Timeout: ingen inloggning inom 5 minuter'));
        }, 5 * 60 * 1000);

        const handler = (event: MessageEvent) => {
          if (event.data?.type === 'keycloak-oauth-callback') {
            clearTimeout(timeout);
            window.removeEventListener('message', handler);
            resolve(event.data.code);
          } else if (event.data?.type === 'keycloak-oauth-error') {
            clearTimeout(timeout);
            window.removeEventListener('message', handler);
            reject(new Error(event.data.error || 'Keycloak-fel'));
          }
        };
        window.addEventListener('message', handler);
      });

      // 6. Exchange code for token via edge function (avoids CORS with Keycloak)
      const { data: tokenData, error: tokenErr } = await supabase.functions.invoke('acc-to-geminus-plus', {
        body: { action: 'exchange-keycloak-code', code, redirectUri, tokenUrl, clientId, verifier },
      });
      if (tokenErr || !tokenData?.access_token) {
        throw new Error(tokenData?.error || tokenErr?.message || 'Token-utbyte misslyckades');
      }

      const { access_token, expires_in = 300 } = tokenData;
      const expiry = Date.now() + (expires_in - 30) * 1000;
      sessionStorage.setItem(SESSION_KEY, access_token);
      sessionStorage.setItem(SESSION_EXPIRY_KEY, String(expiry));
      setAccessToken(access_token);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Auto-clear expired token
  useEffect(() => {
    const expiry = sessionStorage.getItem(SESSION_EXPIRY_KEY);
    if (!expiry) return;
    const ms = parseInt(expiry) - Date.now();
    if (ms <= 0) { logout(); return; }
    const t = setTimeout(logout, ms);
    return () => clearTimeout(t);
  }, [accessToken, logout]);

  return { isAuthenticated, isLoading, accessToken, login, logout, error };
}
