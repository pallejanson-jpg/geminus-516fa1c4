
# Plan: Åtgärda 360° ↔ 3D Synkronisering

## Problemanalys

Jag har identifierat **två separata problem**:

### Problem 1: Ivion API-autentisering misslyckas
Felmeddelandena i loggarna visar:
```
"Bad credentials" - username/password login failed
"Ivion authentication failed. Username/password login was attempted but failed."
```

**Konsekvens:** Bildcachen (`imageCache`) förblir tom, vilket innebär att 3D → 360° synk inte kan fungera eftersom systemet inte vet var bilderna finns.

### Problem 2: Ingen postMessage-kommunikation från Ivion
NavVis IVION skickar inte automatiskt `camera-changed` events via `postMessage` till parent-fönstret. Vi kan skicka `subscribe`-kommandon men det är oklart om er Ivion-instans stöder detta.

---

## Lösning

### Del 1: Fixa Ivion-autentisering

**Alternativ A: Uppdatera credentials**
Om er Ivion-instans kräver **lokalt konto** (inte SSO/OAuth), behöver ni uppdatera IVION_USERNAME och IVION_PASSWORD med korrekta uppgifter.

**Alternativ B: Använd färsk token**
Om ni kan hämta en färsk access_token och refresh_token manuellt från Ivion, kan dessa läggas in som IVION_ACCESS_TOKEN och IVION_REFRESH_TOKEN.

**Hur ni får tag på tokens manuellt:**
1. Logga in på Ivion i webbläsaren
2. Öppna Developer Tools → Network
3. Hitta ett API-anrop som innehåller `x-authorization: Bearer XXX`
4. Kopiera token-värdet

### Del 2: Alternativ synk-strategi (utan API-beroende)

Eftersom Ivion-iframen laddar och användaren kan navigera i den, kan vi implementera en **URL-parser-baserad synk** som inte kräver API-anrop för bildcachen.

**Ny strategi:**
1. **3D → 360°**: Direkt URL-uppdatering med `&image=XXX` (kräver fortfarande bildcache)
2. **360° → 3D (ny fallback)**: 
   - Lägg till en "Synka hit"-knapp i 3D-sidan
   - Knappen öppnar en dialog där användaren klistrar in Ivion-URL:en (som de kopierar via Dela-ikonen)
   - Systemet parsar URL:en, hämtar bildpositionen via API, och uppdaterar 3D

### Del 3: Förbättrad felhantering och status

Visa tydligare status till användaren om:
- API-anslutning fungerar eller inte
- Hur många bilder som laddats
- Om synk är aktiv

---

## Tekniska ändringar

### 1. Felmeddelande i UI vid auth-problem

**Fil: `src/components/viewer/Ivion360View.tsx`**

Visa ett varningsmeddelande om bildcachen är tom men sync är aktiverad:

```typescript
// Om sync är aktiverad men ingen bildcache → visa varning
{syncEnabled && !isLoadingImages && imageCache.length === 0 && connectionStatus === 'error' && (
  <div className="absolute top-12 left-2 right-2 z-20 bg-amber-100 dark:bg-amber-900/40 
                  text-amber-800 dark:text-amber-200 text-xs px-3 py-2 rounded shadow">
    ⚠️ Kunde inte hämta bildpositioner. 
    <button onClick={handleRetryImageLoad} className="underline ml-1">
      Försök igen
    </button>
  </div>
)}
```

### 2. Manuell synk-dialog som fallback

**Fil: `src/pages/SplitViewer.tsx`**

Lägg till en dialog som dyker upp vid klick på "Synka 360° → 3D" om automatisk synk inte fungerar:

```typescript
{/* Fallback sync dialog */}
<Dialog open={showManualSyncDialog} onOpenChange={setShowManualSyncDialog}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Synka från 360°</DialogTitle>
    </DialogHeader>
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Automatisk synk är inte tillgänglig. Du kan synka manuellt:
      </p>
      <ol className="list-decimal list-inside text-sm space-y-2">
        <li>I 360°-vyn, klicka på <strong>Dela</strong>-ikonen (📤)</li>
        <li>Kopiera länken som visas</li>
        <li>Klistra in den nedan</li>
      </ol>
      <Input
        value={manualIvionUrl}
        onChange={(e) => setManualIvionUrl(e.target.value)}
        placeholder="https://swg.iv.navvis.com/?site=...&image=..."
      />
      <p className="text-xs text-muted-foreground">
        URL:en måste innehålla <code>&amp;image=XXX</code>
      </p>
    </div>
    <DialogFooter>
      <Button variant="outline" onClick={() => setShowManualSyncDialog(false)}>
        Avbryt
      </Button>
      <Button onClick={handleParseManualUrl} disabled={!manualIvionUrl.includes('image=')}>
        Synka
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

### 3. Retry-logik för bildladdning

**Fil: `src/hooks/useIvionCameraSync.ts`**

Lägg till en retry-funktion som användaren kan anropa:

```typescript
// Ny export: retryLoadImages
const retryLoadImages = useCallback(async () => {
  setIsLoadingImages(true);
  try {
    const { data, error } = await supabase.functions.invoke('ivion-poi', {
      body: { 
        action: 'get-images-for-site', 
        siteId: ivionSiteId,
        buildingFmGuid,
      },
    });
    
    if (data?.success && data?.images?.length > 0) {
      setImageCache(data.images);
      toast.success(`Laddade ${data.images.length} bildpositioner`);
    } else {
      toast.error('Kunde inte ladda bildpositioner', {
        description: data?.error || 'Kontrollera Ivion-konfigurationen'
      });
    }
  } catch (e) {
    toast.error('Anslutning till Ivion misslyckades');
  } finally {
    setIsLoadingImages(false);
  }
}, [ivionSiteId, buildingFmGuid]);
```

---

## Filer som ändras

| Fil | Ändring |
|-----|---------|
| `src/components/viewer/Ivion360View.tsx` | Lägg till varningsmeddelande vid tom bildcache, retry-knapp |
| `src/hooks/useIvionCameraSync.ts` | Exportera `retryLoadImages`-funktion |
| `src/pages/SplitViewer.tsx` | Lägg till manuell sync-dialog som fallback |

---

## Rekommenderad åtgärd

**Steg 1: Verifiera Ivion-credentials**
Kontrollera att IVION_USERNAME och IVION_PASSWORD är för ett **lokalt konto** (inte SSO). NavVis Ivion API stöder ofta bara lokala konton för programmatisk åtkomst.

**Steg 2: Implementera fallback-synk**
Jag implementerar manuell URL-parser-synk som backup så att ni kan synka även om automatiken inte fungerar.

**Steg 3: Testa med korrekta credentials**
När credentials fungerar kommer bildcachen att laddas och automatisk synk aktiveras.

---

## Sammanfattning

| Problem | Orsak | Lösning |
|---------|-------|---------|
| Ingen bildcache | API-auth misslyckas | Uppdatera credentials + retry-logik |
| 3D → 360° fungerar ej | Bildcache tom | Löses av ovanstående |
| 360° → 3D fungerar ej | PostMessage stöds ej | Manuell URL-input som fallback |
| Dålig UX vid fel | Ingen feedback | Varningsmeddelanden + status |

Den viktigaste åtgärden är att fixa Ivion-autentiseringen. Med fungerande credentials kommer den befintliga synk-logiken att fungera för 3D → 360°. För 360° → 3D erbjuder jag en manuell fallback tills eventuellt SDK-stöd finns.
