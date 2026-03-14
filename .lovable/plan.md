

## Två delar: 1) Felmeddelande-fix, 2) ML-funktionalitetsidéer

---

### 1. Chunk-importfel (`TypeError: Importing a module script failed`)

**Orsak**: Browsern har cachat en gammal Vite-chunk-hash (`.vite/deps/chunk-XQLYTHWV.js`) som inte längre finns efter en ny deploy. `main.tsx` har redan auto-reload-logik för detta, men den triggas bara en gång (`sessionStorage`-flagga). Om första reload inte löser det (t.ex. SW serverar gammal cache) fastnar användaren.

**Fix**:
- Uppdatera **Service Worker** (`public/sw.js`) att rensa `.vite/deps`-chunks vid aktivering och inte cache-first:a dep-chunks
- Lägg till `?v=`-timestamp i `main.tsx` reload-logiken så att reload faktiskt hämtar färskt
- I `main.tsx`: utöka retry-logiken till max 2 försök istället för 1

---

### 2. ML-funktionalitet för Geminus — konkreta möjligheter

Givet att ni redan har Lovable AI Gateway (Gemini/GPT-5) och bildanalys (AI Asset Detection), finns dessa naturliga ML-tillägg:

| Funktion | Beskrivning | Komplexitet |
|---|---|---|
| **Prediktivt underhåll** | Analysera sensordata (Senslinc) med tidsseriemodeller för att förutsäga utrustningsfel innan de inträffar | Medel |
| **Energianomali-detektion** | ML-modell som lär sig normala energimönster per byggnad och varnar vid avvikelser | Medel |
| **Automatisk BIM-klassificering** | Redan delvis implementerad (BIP-classify). Utöka till automatisk IFC-typ-mappning och rumsklassificering | Låg |
| **Smart dokumentsökning (RAG)** | Redan delvis implementerad (index-documents). Förbättra med embedding-baserad vektorsökning istället för chunk-matching | Medel |
| **Bildbaserad tillståndsbedömning** | Fotografera utrustning → AI bedömer skick (1-5) och föreslår åtgärd, baserat på visuella mönster | Medel |
| **Rumsanvändnings-optimering** | Analysera sensor/bokningsdata för att föreslå omfördelning av ytor | Hög |
| **Automatisk felrapport-routing** | ML-klassificera inkommande felrapporter till rätt kategori, prioritet och ansvarig | Låg |
| **3D-anomali-markering** | Kombinera sensordata med BIM-position för att färgkoda rum/utrustning som avviker i 3D-viewern | Medel |

**Teknisk approach** för alla: Edge Functions + Lovable AI Gateway (ingen egen ML-infrastruktur krävs). Tidsserier och embeddings kan lagras i databasen. De flesta funktioner kan byggas med prompt engineering + structured output (tool calling) mot Gemini/GPT-5.

---

### Implementationsplan för chunk-felet

**Fil: `public/sw.js`**
- I `activate`-eventet: rensa alla caches som innehåller `.vite/deps` entries
- I fetch-handler: behandla `.vite/deps/`-resurser som network-first (inte cache-first)

**Fil: `src/main.tsx`**
- Öka retry-count till 2 (ny `sessionStorage`-räknare istället för boolean)
- Vid reload: lägg till `?_cb=timestamp` på URL:en för att tvinga cache-bust

