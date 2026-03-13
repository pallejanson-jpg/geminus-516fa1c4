

## Analys

Just nu finns det ingen dedikerad route för att starta enbart Geminus AI (chatten). AI:n nås idag via:
- Huvudappen (`/`) → klicka på Geminus AI-knappen
- Deep link: `/?gunnar=voice` → öppnar hela appen och auto-startar röstläge
- `/plugin` → visar FAB-menyn (kräver byggnadskontext)

Ingen av dessa ger en ren, fristående AI-chatt-sida.

## Plan

Skapa en ny standalone route `/ai` som renderar **enbart Geminus AI-chatten** i helskärm, utan app-layout, header, sidebar etc.

### Vad som byggs

1. **Ny sida `src/pages/AiChat.tsx`**
   - Minimal fullscreen-sida med bara `GunnarChat` i embedded-läge
   - Stöd för query-parametrar: `?building=GUID&voice=true`
   - Om `voice=true` → auto-starta röstläge
   - Tillbaka-knapp eller stäng-knapp som navigerar till `/`
   - Autentiserad (ProtectedRoute)

2. **Ny route i `src/App.tsx`**
   - Lägg till `<Route path="/ai" ...>` ovanför catch-all
   - Lazy-load `AiChat`-komponenten
   - Skyddad med `ProtectedRoute`

### Resultat

Direktlänk: **`/ai`** — öppnar bara AI-chatten, inget annat.  
Med röst: **`/ai?voice=true`**  
Med byggnadskontext: **`/ai?building=GUID`**

