

# Plan: BIP Auto-Klassificering via GitLab-data (Steg 1)

## Datakälla

BIP-koderna finns som öppen JSON-data i GitLab-repot `bim-alliance/bip-koder/bipkoder-data`. Ingen API-nyckel behövs -- raw-filer kan hämtas direkt via GitLab raw URL:er.

Datastrukturen har 5 värdelistor, varav 3 är relevanta:

```text
input/data/
  maincategory/   ~80 filer   { mc_id, mc_code, mc_title, mc_schema }
  subcategory/    ~400 filer  { sc_id, sc_maincategory, sc_code, sc_title, sc_usercode_syntax, sc_bsabE, aff, etim }
  property/       ~60 filer   { pr_id, prop_title, prop_datatype, prop_class }
  schema/         ~15 filer   (discipliner: ventilation, VS, el, tele, etc.)
```

Typbeteckningarna (subcategory) innehåller redan `sc_code` (BIP-kod), `sc_usercode_syntax` (typbeteckning), `sc_bsabE`, `aff` och `etim` -- exakt det vi behöver.

## Strategi

1. **Importera BIP-referensdata** till en `bip_reference`-tabell genom en admin-edge-function som hämtar JSON-filerna direkt från GitLab raw.
2. **AI-klassificering** via Gemini Flash som matchar ett assets egenskaper (namn, typ, IFC-kategori, attribut) mot de ~400 BIP-typbeteckningarna.
3. **Klassificeringsknapp** i `UniversalPropertiesDialog` som triggar edge function och visar resultat.

## Ändringar

### 1. Databasmigrering: `bip_reference`-tabell

```sql
CREATE TABLE bip_reference (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref_type text NOT NULL,          -- 'maincategory', 'subcategory', 'property', 'schema'
  ref_id integer,
  code text,                       -- mc_code eller sc_code
  title text NOT NULL,
  parent_id integer,               -- sc_maincategory -> mc_id
  usercode_syntax text,            -- t.ex. 'EA2xx-i'
  bsab_e text,
  aff text,
  etim text,
  schema_id integer,               -- mc_schema -> schema
  raw_data jsonb DEFAULT '{}',
  updated_at timestamptz DEFAULT now()
);
```

RLS: Alla autentiserade kan läsa. Admin kan skriva.

### 2. Edge function: `bip-import/index.ts`

Admin-only funktion som:
- Hämtar fillistan från GitLab-repots `input/data/maincategory/`, `subcategory/`, `property/`, `schema/` via GitLab API (`https://gitlab.com/api/v4/projects/bim-alliance%2Fbip-koder%2Fbipkoder-data/repository/tree?path=input/data/maincategory&per_page=100`)
- Hämtar varje JSON-fil via raw URL
- Upserterar i `bip_reference`
- Returnerar antal importerade poster

### 3. Edge function: `bip-classify/index.ts`

Tar emot assetets egenskaper och:
1. Hämtar alla `subcategory`-poster från `bip_reference` (cacheas i edge function-minnet, ~400 poster)
2. Bygger en prompt med assetets data + samtliga BIP-typbeteckningar
3. Anropar Gemini Flash via Lovable AI Gateway med tool calling for strukturerad output
4. Returnerar top 3-5 matchade BIP-koder med konfidens, BSAB-E, AFF, typbeteckning

### 4. UI: Klassificeringsknapp i `UniversalPropertiesDialog.tsx`

- Ny knapp "Klassificera (BIP)" i footer-sektionen (bredvid Edit/Save/Push)
- Vid klick: spinner, anropar `bip-classify`, visar resultat i en expanderbar sektion
- Varje förslag visar: typbeteckning, titel, BIP-kod, BSAB-E, AFF, konfidens
- "Välj"-knapp per förslag som sparar till `attributes.bipTypeId`, `attributes.bipBsabE`, `attributes.bipAff`
- Stöd för batch vid multi-select

### 5. Ny sektion "Klassificering" i egenskapspanelen

I `allProperties`-memot, lägg till en `classification`-sektion som visar sparade BIP/BSAB-koder om de finns i assetets attribut.

## Filer

| Fil | Aktion |
|-----|--------|
| Migration SQL | Skapa `bip_reference` tabell + RLS |
| `supabase/functions/bip-import/index.ts` | Ny: hämta BIP-data från GitLab |
| `supabase/functions/bip-classify/index.ts` | Ny: AI-klassificering via Gemini Flash |
| `src/components/common/UniversalPropertiesDialog.tsx` | Klassificeringsknapp + resultatsektion + klassificeringssektion |

