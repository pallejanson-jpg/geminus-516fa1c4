

## Plan: Excel-import med mallnedladdning och orphan-stöd

### Sammanfattning
Bygga en Excel-importfunktion med nedladdningsbar mall per byggnad. Mallen förfylls med kolumnrubriker och hjälpdata (våningsnamn, rumsnamn) så att användaren skriver klartext istället för GUID:er. Systemet slår upp GUID:er automatiskt vid import. Stöd för både objekt med rumsrelation och orphans (enbart byggnadsrelation).

### Steg 1 — Orphan-stöd i edge function
**`supabase/functions/asset-plus-create/index.ts`**
- Gör `parentSpaceFmGuid` valfritt
- Lägg till `parentBuildingFmGuid` som alternativ — om inget rum anges, koppla objektet direkt till byggnaden i Asset+
- Uppdatera validering: kräv antingen `parentSpaceFmGuid` ELLER `parentBuildingFmGuid`
- Vid lokal lagring: sätt `building_fm_guid` men lämna `in_room_fm_guid` null

### Steg 2 — Mall-nedladdning (klientbaserad)
**Ny fil: `src/components/import/ExcelTemplateDownload.tsx`**
- Knapp "Ladda ner Excel-mall" i CreateBuildingPanel (samma vy som IFC-upload)
- Användaren väljer byggnad → systemet hämtar alla våningar och rum för den byggnaden från `assets`-tabellen
- Genererar en `.xlsx`-fil med:
  - **Kolumner**: Designation (obligatorisk), CommonName, Våning, Rum, Beskrivning, + valfria egenskaper
  - **Blad 2 "Hjälpdata"**: lista med alla våningsnamn och rumsnamn för byggnaden
  - **Data-validering (dropdowns)** i kolumnerna Våning och Rum som refererar till Blad 2
- Använder `xlsx` (SheetJS) biblioteket för generering i webbläsaren

### Steg 3 — Excel-import
**Nya filer:**
- `src/components/import/ExcelImportDialog.tsx` — huvuddialog med steg-för-steg-flöde
- `src/components/import/ImportPreview.tsx` — tabell med förhandsgranskning och validering

**Flöde:**
1. Användaren laddar upp ifylld Excel
2. Parsning med SheetJS → visa rader i tabell
3. Automatisk namnuppslag: "Plan 4" → matchas mot assets med `category=IfcBuildingStorey` och `common_name ILIKE 'Plan 4'` → hämta `fm_guid`. Samma för rum.
4. Validering: markera rader som saknar obligatoriska fält eller där namn inte matchar
5. Användaren godkänner → batch-skapa via `asset-plus-create` edge function
6. Visa resultat (antal skapade / misslyckade)

### Steg 4 — Integration i befintlig UI
**`src/components/settings/CreateBuildingPanel.tsx`**
- Lägg till sektion under IFC-upload: "Inventera via Excel"
- Två knappar: "Ladda ner mall" + "Importera Excel"

### Nytt paket
- `xlsx` (SheetJS) — klientbaserad Excel-generering och parsning

### Tekniskt flöde
```text
Välj byggnad → Ladda ner mall (.xlsx med dropdowns)
     ↓
Fyll i offline (designation, commonName, våning, rum)
     ↓
Ladda upp → Parse → Namnuppslag (klartext → GUID)
     ↓
Validering → Preview-tabell → Godkänn
     ↓
Batch-skapa via asset-plus-create (max 100/anrop)
     ↓
Resultat: X skapade, Y misslyckade
```

