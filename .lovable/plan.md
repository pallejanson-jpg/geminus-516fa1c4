

## Använd HDC Object API för att hämta byggnadsdata via GUID

### Bakgrund
Tessel HDC API har ingen dedikerad "buildings"-endpoint, men erbjuder ett generellt Object API som kan hämta alla objekt (inklusive byggnader) via deras GUID.

### Steg

**1. Lägg till `get-object-by-guid` action i edge function**
Ny action som anropar `GET /api/object/byguid/json/{guid}` for att hämta objektdata (inklusive byggnader) via GUID.

**2. Lägg till `get-classes` action**
Anropar `GET /api/config/classes/json` for att lista alla objektklasser i systemet (t.ex. "Byggnad", "Våning", "Rum"). Detta hjälper oss förstå vilka classId:n som finns.

**3. Lägg till `search-objects` action**
Anropar `GET /api/search/quick?query={term}` for att söka efter objekt i HDC. Kan användas for att hitta byggnader by namn.

**4. Uppdatera `get-buildings` action**
Istället for att returnera systeminfo, använd `get-classes` for att hitta byggnadsklassens ID, och sedan sök/lista byggnader via perspective/object API.

**5. Testa med våra databas-GUID:s**
Anropa `get-object-by-guid` med GUID:arna från vår building_settings-tabell for att verifiera mappningen.

### Teknisk detalj

```text
Nya actions i fm-access-query edge function:

case 'get-object-by-guid':
  GET /api/object/byguid/json/{guid}
  -> Returnerar objektdata med properties, classId, namn etc.

case 'get-classes':
  GET /api/config/classes/json
  -> Returnerar lista av alla klasser (Byggnad, Våning, Rum etc.)

case 'search-objects':
  GET /api/search/quick?query={term}
  -> Söker efter objekt by namn

case 'get-perspective-tree':
  GET /api/perspective/subtree/json/{perspId}/{classId}/{objectId}
  -> Hämtar trädstruktur under ett objekt
```

