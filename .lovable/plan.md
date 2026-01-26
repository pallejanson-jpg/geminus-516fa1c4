
# Plan: Importera brandsymboler till annotation_symbols

## Sammanfattning
Denna plan importerar de 8 uppladdade brandsymbolerna till `annotation_symbols`-tabellen med:
- Ett nytt numeriskt `symbol_id`-fält som börjar på 100
- Filnamnet (utan filändelse) som namn/beskrivning
- Bilderna uppladdade till `symbol-icons` storage bucket

## Ändringar

### 1. Databasschema - Lägg till symbol_id kolumn

**Ny migration** för att lägga till ett numeriskt symbol_id:

```sql
ALTER TABLE annotation_symbols 
ADD COLUMN symbol_id INTEGER UNIQUE;

-- Uppdatera befintliga symboler med symbol_id 1-99 (reserverat)
UPDATE annotation_symbols 
SET symbol_id = (ROW_NUMBER() OVER (ORDER BY created_at))
WHERE symbol_id IS NULL;
```

### 2. Kopiera bilder till projekt och ladda upp till storage

**Bilder att importera** (från user-uploads):
| Fil | symbol_id | Namn/Beskrivning |
|-----|-----------|------------------|
| Brandfilt.png | 100 | Brandfilt |
| Brandredskap.png | 101 | Brandredskap |
| Brandsläckare_CO2.png | 102 | Brandsläckare CO2 |
| Brandmonitor.png | 103 | Brandmonitor |
| Brandlarmsknapp.png | 104 | Brandlarmsknapp |
| Branddörr.png | 105 | Branddörr |
| Brandsläckare_Fett.png | 106 | Brandsläckare Fett |
| Brandslang.png | 107 | Brandslang |

### 3. Infoga symboler i databasen

Efter att bilderna laddats upp till `symbol-icons` bucket, infogas poster:

```sql
INSERT INTO annotation_symbols (symbol_id, name, category, color, icon_url, is_default) VALUES
(100, 'Brandfilt', 'Fire', '#A11D1D', '{storage-url}/Brandfilt.png', false),
(101, 'Brandredskap', 'Fire', '#A11D1D', '{storage-url}/Brandredskap.png', false),
(102, 'Brandsläckare CO2', 'Fire', '#A11D1D', '{storage-url}/Brandslackare_CO2.png', false),
(103, 'Brandmonitor', 'Fire', '#A11D1D', '{storage-url}/Brandmonitor.png', false),
(104, 'Brandlarmsknapp', 'Fire', '#A11D1D', '{storage-url}/Brandlarmsknapp.png', false),
(105, 'Branddörr', 'Fire', '#A11D1D', '{storage-url}/Branddorr.png', false),
(106, 'Brandsläckare Fett', 'Fire', '#A11D1D', '{storage-url}/Brandslackare_Fett.png', false),
(107, 'Brandslang', 'Fire', '#A11D1D', '{storage-url}/Brandslang.png', false);
```

### 4. Uppdatera SymbolSettings-komponenten

**Fil**: `src/components/settings/SymbolSettings.tsx`

Lägg till visning av `symbol_id` i gränssnittet och inkludera det i formuläret.

---

## ZIP-filhantering

Jag kan **inte** direkt importera från en ZIP-fil i chatten. Alternativen är:

**Alternativ 1 - Manuellt (rekommenderat)**:
Packa upp zip-filen på din dator och ladda upp bilderna individuellt via chatten (som du gjorde nu). Jag importerar dem sedan.

**Alternativ 2 - Bulk-import via UI**:
Jag kan skapa en import-funktion i SymbolSettings där du kan ladda upp flera filer samtidigt och de automatiskt skapas som symboler med sekventiella symbol_id:n.

---

## Implementation

### Steg 1: Databasmigration
Lägger till `symbol_id INTEGER UNIQUE` kolumn.

### Steg 2: Kopiera bilder
Kopierar de 8 uppladdade bilderna till `public/symbols/` eller direkt till storage.

### Steg 3: Infoga data
Kör INSERT-satser för att skapa symbolposterna.

### Steg 4: UI-uppdatering
Visar symbol_id i symbolinställningarna och möjliggör framtida bulk-import.

---

## Filändringar

| Fil | Typ | Beskrivning |
|-----|-----|-------------|
| SQL Migration | Ny | Lägg till symbol_id kolumn |
| public/symbols/*.png | Ny | Kopiera 8 brandsymboler |
| SQL Insert | Ny | Infoga 8 symbolposter |
| src/components/settings/SymbolSettings.tsx | Ändra | Visa symbol_id, bulk-import |

---

## Fråga om ZIP-hantering

Vill du att jag implementerar en bulk-import-funktion i UI:t där du kan ladda upp flera bilder samtidigt? Det skulle göra det enkelt att importera fler symboler i framtiden utan att behöva ladda upp dem en och en i chatten.
