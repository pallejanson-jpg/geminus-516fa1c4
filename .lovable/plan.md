

## Plan: Fixa Geminus AI — Naturliga frågor tolkas fel av intent-routern

### Vad som går fel

**Rotorsaken**: `detectViewerIntent()` (rad 1133) har ett regex som fångar ALLT efter "hur många", "visa", "vilka", "finns det" som ett enda "system"-sökord:

```text
Fråga: "Hur många rum har Smedvig?"
Regex matchar: group2 = "rum har smedvig?"
→ system_query(system="rum har smedvig?")
→ Inga resultat
```

Samma problem uppstår för:
- "Hur många tillgångar finns?" → system_query("tillgångar finns?")
- "Vilka rum finns i Smedvig?" → system_query("rum finns i smedvig?")
- "Finns det ventilation i byggnaden?" → system_query("ventilation i byggnaden?")

**Dessa frågor borde gå till AI-loopen** (som har `get_building_summary` och `get_assets_by_category`), men fast-pathen fångar dem felaktigt och ger nonsens.

### Dessutom: `detectShortInput` (rad 1071) har `wordCount > 4` → alla normala meningar exkluderas, men det är korrekt — problemet är att `detectViewerIntent` sedan tar dem.

### Lösning

**Fil:** `supabase/functions/gunnar-chat/index.ts`

#### 1) Lägg till specifika mönster för räknefrågor FÖRE det breda regexet

Nya mönster i `detectViewerIntent()` (eller ny funktion `detectCountQuestion()`):

| Mönster | Resultat |
|---|---|
| `hur många rum (har\|finns\|i)` | `category_query("Space")` |
| `hur många tillgångar/assets` | `category_query("Instance")` |
| `hur många dörrar` | `category_query("Door")` |
| `hur många våningar` | `category_query("Building Storey")` |
| `hur många X` (okänt X) | `building_summary` (visar alla typer) |
| `vilka rum finns` | `category_query("Space")` |
| `vilka system finns` | `building_summary` |
| `antal rum\|antal tillgångar` | som ovan |

#### 2) Gör det breda regexet smartare

Ändra regexet på rad 1133 så att det **extraherar bara objekttypen**, inte hela meningen:
- Strippa bort "har", "finns", "i byggnaden", "i smedvig", "det", "alla" etc från `raw`
- Matcha det rensade resultatet mot `matchCategory()` och `KNOWN_SYSTEMS`

#### 3) Låt naturliga frågor gå till AI-loopen

Om det breda regexet inte kan matcha till en känd kategori eller system efter rensning → **returnera null** istället för att skicka hela meningen som `system_query`. Då går frågan vidare till AI-loopen som faktiskt kan förstå den.

### Vad detta löser

- "Hur många rum har Smedvig?" → `category_query("Space")` → "272 rum"
- "Vilka system finns?" → `building_summary` → visar top_asset_types
- "Finns det ventilation?" → `system_query("ventilation")` (korrekt)
- "Berätta om byggnaden" → `building_summary`
- Komplexa frågor som inte matchar → AI-loopen (som den ska)

### Filer som ändras
- `supabase/functions/gunnar-chat/index.ts`

