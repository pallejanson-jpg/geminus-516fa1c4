

# Plan: Samla API-dokumentation i Geminus och gör den sökbar för AI

## Nuläge
- API-dokumentation finns som hårdkodad `API_CATEGORIES`-array i `RightSidebar.tsx` — bara Asset+ och FM Access endpoints
- Faciliate och Senslinc saknas helt i UI:t
- Dokumentationen i `docs/api/` (Asset+, FM Access, Senslinc, Faciliate, Congeria, Ivion) är inte indexerad för Geminus AI
- Geminus AI har `search_help_docs`-verktyget men det söker bara i `document_chunks` som fylls via Knowledge Base Sources

## Mål
1. Komplett API-dokumentationsvy i användarmenyn med alla integrationer
2. Geminus AI kan svara på frågor om alla API:er

## Ändringar

### A. Utöka API_CATEGORIES i RightSidebar.tsx
Lägg till endpoints för **Faciliate**, **Senslinc** och **Ivion** baserat på befintlig dokumentation i `docs/api/`:

- **Faciliate**: REST v2 API — arbetsordrar, hyreskontrakt, byggnader
- **Senslinc**: Sensorer, mätdata, larm
- **Ivion**: Platser, POI:er, panoramabilder

### B. Skapa en dedikerad API Documentation-sida
Ny fil: `src/pages/ApiDocs.tsx` — en komplett referenssida med:
- Sökbar lista av alla integrationer
- Expanderbara sektioner per system (Asset+, FM Access, Faciliate, Senslinc, Ivion)
- Autentiseringsflöden, endpoints, parametrar
- Länk från user-dropdown i `AppHeader.tsx`

### C. Indexera API-dokumentationen för Geminus AI
Lägg till API-dokumentationen som förindexerade `document_chunks` via en migration eller edge function-action:
- Chunka innehållet från `docs/api/*/overview.md` + `openapi.yaml`
- Spara med `source_type = 'api_docs'` i `document_chunks`
- Alternativt: lägg till varje `docs/api/*/overview.md` som en Knowledge Base Source som kan indexeras via befintligt UI

### D. Uppdatera Geminus AI system prompt
I `gunnar-chat/index.ts`, lägg till instruktion att använda `search_help_docs` även för API-frågor, och att API-dokumentation finns indexerad.

## Filer som ändras

| Fil | Ändring |
|---|---|
| `src/components/layout/RightSidebar.tsx` | Utöka `API_CATEGORIES` med Faciliate, Senslinc, Ivion |
| `src/pages/ApiDocs.tsx` | **NY** — dedikerad API-dokumentationssida |
| `src/App.tsx` | Lägg till route `/api-docs` |
| `src/components/layout/AppHeader.tsx` | Lägg till "API Documentation" i user-dropdown |
| `supabase/functions/gunnar-chat/index.ts` | Uppdatera system prompt för API-frågors hantering |
| `supabase/functions/index-documents/index.ts` | Lägg till action `index-api-docs` som chunkar docs/api-filerna |

## Implementationsordning
1. Utöka API_CATEGORIES med alla integrationer
2. Skapa ApiDocs-sidan och koppla i router + header
3. Indexera API-dokumentation i document_chunks
4. Uppdatera Geminus AI prompt

