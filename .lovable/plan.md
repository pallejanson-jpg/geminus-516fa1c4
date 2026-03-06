

# Plan: Förbättra Geminus Plugin Menu i FM Access

## Nuläge — Problem

Utifrån bilden och koden ser jag tre huvudproblem:

1. **GeminusPluginMenu syns inte i FMA+ (legacy iframe-vyn)**
   - Bilden visar FM Access i "fma_plus"-läge (hela gränssnittet är Tessels HDC-klient)
   - `FmaInternalView` renderar `GeminusPluginMenu` men **bara om `buildingFmGuid` finns** — och den FAB-knappen hamnar nere till höger, delvis dold av FM Access-gränssnittets egna knappar
   - Användaren förstår inte att det finns en meny att använda

2. **Gunnar saknar FM Access-kontext**
   - I `GeminusPluginMenu` skapas `GunnarChat` utan `context`-prop — den får ingen information om vilken byggnad, våning eller rum som är valt i FM Access
   - Gunnar kan inte svara på FM Access-specifika frågor

3. **Ilean är bara en placeholder**
   - Ilean-panelen i plugin-menyn visar bara en statisk text, ingen faktisk chat. Den riktiga `IleanButton`-komponenten med `useIleanData` används inte

## Lösning

### Task 1: Gör FAB-knappen synligare i FM Access
- Lägg till en **pulsande animation** på FAB-knappen första gången den visas i FM Access
- Lägg till en **tooltip** "Geminus-menyn" som visas automatiskt i 3 sekunder vid första laddning
- Flytta FAB:en till `bottom-6 right-20` i fma_plus-läge för att inte kollidera med FM Access-knappar

### Task 2: Skicka FM Access-kontext till Gunnar
- I `GeminusPluginMenu`, bygg ett `GunnarContext`-objekt baserat på `buildingFmGuid`, `buildingName`, `source` och `contextMetadata` (som innehåller `hdcObjectId` från postMessage-bryggan)
- Skicka detta som `context`-prop till `GunnarChat`
- Lägg till FM Access-specifik hälsning i `getContextualGreeting` (t.ex. "Du arbetar i FM Access för {buildingName}. Fråga mig om rum, dokument eller utrustning!")
- Gunnar kan då använda sina befintliga verktyg (queryAssets, aggregateAssets etc.) med rätt byggnadskontext

### Task 3: Aktivera riktig Ilean-chat i plugin-menyn
- Ersätt placeholder-panelen med en inbäddad version av Ilean-chatten som använder `useIleanData`-hooken
- Skicka `buildingFmGuid` som kontext så att Ilean kan ställa dokumentfrågor mot rätt byggnad via Senslinc
- Rendera meddelanden med `ReactMarkdown` och inkludera startfrågor

### Task 4: Uppdatera FmAccessNativeView med plugin-menyn
- `FmAccessNativeView` (FMA 2.0) renderar idag **ingen** `GeminusPluginMenu`
- Lägg till FAB:en även här med rätt `buildingFmGuid` och `buildingName`

## Filändringar

| Fil | Ändring |
|-----|---------|
| `src/components/viewer/GeminusPluginMenu.tsx` | Bygg GunnarContext från props, skicka till GunnarChat. Ersätt Ilean-placeholder med riktig chat via useIleanData. Lägg till puls-animation och tooltip vid första visning. |
| `src/components/chat/GunnarChat.tsx` | Lägg till FM Access-gren i `getContextualGreeting` |
| `src/components/fm-access/FmAccessNativeView.tsx` | Lägg till GeminusPluginMenu-rendering |
| `src/components/viewer/FmaInternalView.tsx` | Justera FAB-position för att undvika överlapp med FM Access-UI |

