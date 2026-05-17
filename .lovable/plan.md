# Köra appen lokalt + lösa Google-login

## Bakgrund

Appen är en ren **Vite + React** frontend (ingen egen Node-backend i repo). All "backend" ligger i Lovable Cloud (Supabase): databas, edge functions, auth. Det betyder att du kan köra frontend var som helst — det enda du behöver är att den når Supabase-projektet `diqfthpfncdojlnqnicq` via `VITE_SUPABASE_URL` och `VITE_SUPABASE_PUBLISHABLE_KEY`.

Google-loginen är däremot inte ren Supabase OAuth — den går via **Lovable Managed OAuth** (`@lovable.dev/cloud-auth-js` i `src/integrations/lovable/index.ts`). Den routar via Lovables OAuth-broker (`oauth.lovable.app` + en proxy på `*.lovable.app` / godkända custom domains). Det är det som blir problemet lokalt: `http://localhost:5173` är inte ett godkänt redirect-ursprung i den managed flödet.

---

## Två alternativ för Google-login lokalt

### Alternativ A — Behåll Lovable Managed Google (enklast)
Funkar bara från `*.lovable.app` eller en aktiv custom domain. Lokalt fungerar det INTE eftersom OAuth-brokern inte tillåter `localhost` som redirect.
- Praktisk lösning: testa auth-flödet i preview/published URL och kör övrig utveckling lokalt utan inloggning (mocka `useAuth` i dev), eller
- Använd en lokal tunnel (Cloudflare Tunnel / ngrok) som pekar mot en custom domain som redan är tillagd i Lovable.

### Alternativ B — Egna Google OAuth-credentials direkt mot Supabase (rekommenderat för lokalt)
Slå på "vanlig" Supabase Google-provider med dina egna client ID/secret. Då fungerar `http://localhost:5173` så länge du lägger till det som redirect URL i Google Cloud + Supabase.

Steg:
1. I Google Cloud Console: skapa OAuth Client (Web), lägg till redirect URI:
   - `https://diqfthpfncdojlnqnicq.supabase.co/auth/v1/callback`
   - `http://localhost:5173`
2. I Lovable Cloud → Users → Auth Settings → Google: klistra in Client ID + Secret (stänger av managed-läget för Google).
3. Byt anropet i `src/pages/Login.tsx` från `lovable.auth.signInWithOAuth(...)` till `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })`.
4. Lägg till `http://localhost:5173` under Site URL / Redirect URLs i Cloud auth-inställningarna.

---

## Köra frontend på din lokala Node-server

Två varianter beroende på vad "lokal Node JS-server" betyder:

**1. Bara Vite dev-server (utveckling)**
```bash
git clone <repo>
bun install            # eller npm install
cp .env.example .env   # se nedan
bun run dev            # http://localhost:5173
```

`.env` lokalt:
```
VITE_SUPABASE_URL=https://diqfthpfncdojlnqnicq.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<anon key från befintlig .env>
VITE_SUPABASE_PROJECT_ID=diqfthpfncdojlnqnicq
```

**2. Bygga + servera via Node (prod-likt)**
```bash
bun run build          # producerar /dist
# servera /dist med valfri Node-server, t.ex.:
npx serve dist -l 3000
# eller egen Express:
#   app.use(express.static('dist'))
#   app.get('*', (_,res)=>res.sendFile('dist/index.html'))
```
Viktigt: SPA-fallback till `index.html` måste finnas, annars 404 på direktnavigering.

---

## Tekniska detaljer / checklista

- **Edge functions, DB, storage** kräver inga ändringar — de bor kvar i Lovable Cloud och nås via samma URL/anon-key.
- **Service worker** (`public/sw.js`) kan cacha gamla OAuth-svar lokalt — avregistrera den i DevTools → Application om login beter sig konstigt.
- **PWA-manifest** påverkar inte funktion men `start_url` är hårdkodad mot rotpath, ok lokalt.
- **CORS**: Supabase tillåter alla origins för anon-key, så inget extra behövs.
- **Secrets**: alla `*_API_KEY`/`*_PASSWORD` ligger som edge function secrets i Cloud — du ska INTE kopiera dem till din lokala maskin. Frontend behöver dem aldrig.
- **Auth state efter login**: `useAuth` lyssnar via `onAuthStateChange` och funkar identiskt oavsett provider — inga andra kodändringar krävs om du väljer Alternativ B.

---

## Vad jag föreslår att vi gör

1. Bekräfta vilket alternativ du vill ha (A behåller managed, B byter till egna Google-credentials).
2. Om B: jag uppdaterar `Login.tsx` till `supabase.auth.signInWithOAuth` och dokumenterar Google Cloud-stegen. Du sätter Client ID/Secret i Cloud auth-UI:t själv.
3. Jag lägger till en kort `README`-sektion "Köra lokalt" med stegen ovan.
