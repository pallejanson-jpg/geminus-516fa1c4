

# Standalone Gunnar AI URL + PWA

## Nuläge

Routen `/ai` finns redan och renderar **bara** `GunnarChat` i fullskärm (`embedded` mode). Den är bakom `ProtectedRoute` (kräver inloggning).

**Din publicerade URL**: `https://gemini-spark-glow.lovable.app/ai`  
**Med röststyrning**: `https://gemini-spark-glow.lovable.app/ai?voice=true`  
**Med byggnadskontext**: `https://gemini-spark-glow.lovable.app/ai?building=<GUID>`

## Problem att lösa

iOS "Lägg till på hemskärmen" använder nuvarande URL, men manifestet pekar `start_url` till `/`. Det innebär att om du lägger till `/ai` på hemskärmen via Safari kan det ändå fungera, men manifestets metadata (namn, ikon) visar "My SWG" — inte "Gunnar AI".

## Plan

### 1. Separat manifest för AI-appen
Skapa `/manifest-ai.json` med:
- `name`: "Gunnar AI"
- `short_name`: "Gunnar"  
- `start_url`: "/ai"
- `display`: "standalone"
- Samma ikoner (eller en AI-specifik ikon om önskat)

### 2. Dynamiskt byta manifest i AiChat.tsx
I `useEffect`: hitta `<link rel="manifest">` i `<head>` och byt `href` till `/manifest-ai.json`. Återställ vid unmount. Detta gör att iOS/Android läser rätt manifest när användaren är på `/ai`.

### 3. PWA-specifika meta-taggar
Lägg till i samma `useEffect`:
- `apple-mobile-web-app-title`: "Gunnar AI"  
- `apple-mobile-web-app-capable`: "yes"

Dessa finns redan i `index.html` men med fel värden för AI-standalone.

### Filer att ändra

| Fil | Ändring |
|-----|---------|
| `public/manifest-ai.json` | Ny fil — AI-specifikt PWA-manifest |
| `src/pages/AiChat.tsx` | `useEffect` som byter manifest + meta-taggar |

### Resultat
Efter publicering: gå till `https://gemini-spark-glow.lovable.app/ai` i Safari → Dela → "Lägg till på hemskärmen" → appen heter "Gunnar AI" och öppnar direkt till AI-chatten i fullskärm.

