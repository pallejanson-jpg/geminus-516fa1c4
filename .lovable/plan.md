

# Geminus AI + Panel — Komplett produktionsplan

## Sammanfattning

Tre delar: (1) Standalone AI safety + voice, (2) Plugin-panel som PWA, (3) Backend prompt-uppdatering.

**Dina publicerade URL:er efter implementering:**
- **Geminus AI**: `https://gemini-spark-glow.lovable.app/ai`
- **Geminus Panel**: `https://gemini-spark-glow.lovable.app/plugin`

---

## Del 1: Standalone AI — Safety + Voice

### 1a. Blockera extern navigation (`GunnarChat.tsx`)
- Ersätt `window.open()` i `standaloneNavigate` med `toast.info("Den här funktionen kräver Geminus-appen med 3D-viewer")`
- Användaren stannar alltid kvar i chatten

### 1b. Continuous voice (`useWebSpeechRecognition.ts`)
- `continuous = true` + 2.5s silence-timeout
- Ackumulera alla `isFinal`-resultat innan leverans

### 1c. Standalone-prompt (`gunnar-chat/index.ts`)
- Standalone-instruktion: förbjud viewer-actions, svara med data + tydligt "öppna Geminus-appen för 3D"
- Nytt `list_buildings`-verktyg för "vilka byggnader har jag?"

---

## Del 2: Plugin-panel som PWA (NYTT)

### 2a. Nytt manifest (`public/manifest-plugin.json`)
```json
{
  "name": "Geminus Panel",
  "short_name": "Geminus",
  "start_url": "/plugin",
  "display": "standalone",
  "background_color": "#0f172a",
  "theme_color": "#0f172a",
  "icons": [samma ikoner som manifest-ai.json]
}
```

### 2b. Dynamisk manifest-swap i `PluginPage.tsx`
Samma mönster som `AiChat.tsx`: `useEffect` som byter manifest till `manifest-plugin.json`, sätter `apple-mobile-web-app-title: "Geminus Panel"`, `apple-mobile-web-app-capable: "yes"`, och uppdaterar `document.title`. Återställs vid unmount.

### 2c. Bakgrundsfärg
Plugin-sidan har `bg-transparent` idag (designad för iframe-overlay). I PWA-standalone-läge syns detta som vitt/tomt. Lösning: byt till `bg-background` som default — fungerar bättre både som PWA och som iframe (iframe-hosten kan styra bakgrund via CSS).

---

## Filer att ändra

| Fil | Ändring |
|-----|---------|
| `src/components/chat/GunnarChat.tsx` | `standaloneNavigate` → toast, aldrig `window.open` |
| `src/hooks/useWebSpeechRecognition.ts` | `continuous: true`, silence-timeout, ackumulering |
| `supabase/functions/gunnar-chat/index.ts` | Standalone-prompt + `list_buildings` |
| `public/manifest-plugin.json` | **Ny fil** — PWA-manifest för panelen |
| `src/pages/PluginPage.tsx` | Dynamisk manifest-swap + `bg-background` |

