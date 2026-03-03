

# FM Access 2.0 — Uppdaterad plan

## Princip: Frontend-refactoring, direkt mot FM Access API

Ingen synkning till lokal databas. All data hämtas live via den befintliga edge-funktionen `fm-access-query` som agerar autentiserad proxy mot HDC-API:t. Vi bygger om frontenden i Geminus med nativa React-komponenter som speglar FM Access gränssnittets olika delar.

## Arkitektur

```text
┌─────────────────────────────────────┐
│  Geminus React Frontend             │
│  (nya nativa komponenter)           │
├─────────────────────────────────────┤
│  fm-access-query (edge function)    │
│  Auth + proxy, redan klar           │
├─────────────────────────────────────┤
│  FM Access / HDC API (backend)      │
│  All data bor här, ingen kopia      │
└─────────────────────────────────────┘
```

## Befintliga API-actions (alla klara att använda)

| Action | Vad den ger |
|--------|------------|
| `get-hierarchy` | Fullständigt trädvy (Fastighet → Byggnad → Plan → Rum) |
| `get-perspective-tree` | Subtree från valfri nod |
| `get-object-by-guid` | Detaljerad objektinfo med egenskaper |
| `search-objects` | Fritextsök |
| `get-drawings` | Ritningslistor per byggnad |
| `get-documents` | Dokumentlistor per byggnad |
| `get-document` | Enskilt dokument |
| `get-drawing-pdf` | PDF-nedladdning av ritning |
| `get-floors` | Våningar per byggnad |
| `get-classes` | Tillgängliga klasser/typer |
| `create-object` / `update-object` / `delete-object` | CRUD |
| `proxy` | Generisk passthrough till valfri HDC-endpoint |

## Vad vi bygger (speglar FM Access UI-delar)

### 1. Nativ hierarki-navigator
- Trädvy: Fastighet → Byggnad → Plan → Rum → Objekt
- Data direkt från `get-hierarchy` / `get-perspective-tree`
- Expand/collapse, ikoner per klasstyp (102 Fastighet, 103 Byggnad, 105 Plan, 107 Rum)
- Klick på nod → visa detaljer i sidopanel

### 2. Objektdetaljpanel
- Visa alla egenskaper från `get-object-by-guid`
- Inline-redigering → `update-object`
- Skapa nytt objekt under vald nod → `create-object`
- Radera → `delete-object`

### 3. Sökvy
- Sökfält med live-resultat via `search-objects`
- Klick på resultat → navigera i trädet + visa detaljer

### 4. Ritningar & Dokument
- Lista ritningar per byggnad via `get-drawings`
- Lista dokument via `get-documents`
- PDF-visning/nedladdning via `get-drawing-pdf`
- Förhandsvisning av dokument via `get-document`

### 5. 2D-ritningsvisning (Fas 2)
- Behåll befintlig iframe-lösning (`/viewer/2d`) tills F12-analysen visar om SVG-data kan hämtas direkt
- Integrera iframe bättre med det nya nativa UI:t (sidopanel + ritning)

## Filer som skapas/ändras

| Fil | Åtgärd |
|-----|--------|
| `src/components/fm-access/FmAccessNativeView.tsx` | Ny huvudkomponent (ersätter FmAccessDashboard + FmaInternalView) |
| `src/components/fm-access/FmAccessTree.tsx` | Hierarki-trädvy |
| `src/components/fm-access/FmAccessObjectPanel.tsx` | Objektdetaljer + CRUD |
| `src/components/fm-access/FmAccessSearch.tsx` | Sökkomponent |
| `src/components/fm-access/FmAccessDocuments.tsx` | Ritningar + dokument |
| `src/hooks/useFmAccessApi.ts` | Hook som wrappar alla `fm-access-query`-anrop |
| `src/components/layout/MainContent.tsx` | Uppdatera routing till nya vyn |

## Vad vi INTE gör

- Ingen synkning till lokal Supabase-databas
- Ingen duplicering av data — allt hämtas live från FM Access
- Ingen ny edge function — befintliga `fm-access-query` har full täckning
- Ingen ändring av befintlig synk-logik (den finns kvar för de som vill använda den)

## Implementationsordning

1. **`useFmAccessApi` hook** — centraliserad API-wrapper
2. **FmAccessTree** — hierarki-navigering
3. **FmAccessObjectPanel** — objektdetaljer med CRUD
4. **FmAccessSearch** — sökfunktion
5. **FmAccessDocuments** — ritningar och dokument
6. **FmAccessNativeView** — samla allt i en layout
7. **Routing** — koppla in i MainContent

