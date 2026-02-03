
Mål
- Få 360+-panelen i Split View (3D+360°) att ladda riktiga Ivion-gränssnittet istället för att visa “Kodformatering”.

Vad som händer nu (orsak)
- I `src/pages/SplitViewer.tsx` byggs Ivion-URL:en som:
  - hårdkodad bas: `https://swg.iv.navvis.com`
  - path: `/main.html?site=...`
- I andra delar av appen (t.ex. Portfolio och IvionInventory) används den fungerande varianten:
  - `${baseUrl}/?site=${siteId}`
- När `/main.html?site=...` inte finns / inte är rätt entrypoint på den Ivion-instansen, returneras annat innehåll (t.ex. fel/JS/text), vilket i iframe kan se ut som “Kodformatering”.

Åtgärd (implementation)
1) Uppdatera URL-bygget i Split View så det matchar resten av appen
   - Fil: `src/pages/SplitViewer.tsx`
   - Ta bort `IVION_BASE_URL`-konstanten.
   - Hämta Ivion-bas-URL från appens konfiguration:
     - använd `appConfigs` från `AppContext` (helst), nyckel: `radar.url`
     - fallback till `https://swg.iv.navvis.com` om url saknas/är tom
     - trimma trailing slash
   - Bygg Ivion-URL med den beprövade formen:
     - `const ivionUrl = `${baseUrl}/?site=${ivionSiteId}`;`
   - (Valfritt men rekommenderat) Lägg en `console.log` med `baseUrl/fullUrl` för enklare felsökning.

2) Liten städning i `SplitViewer.tsx` (för att undvika förvirring)
   - Ta bort oanvända imports (ex. `toast` om den inte används) så vi inte får “dead code”.

3) Snabb verifiering (manuell test)
   - Gå till Centralstationen → Quick Actions → “3D+360°”.
   - Förväntat: 360+-panelen visar Ivion UI (inte “Kodformatering”).
   - Klicka även “Open in new tab” i 360+-panelen för att säkerställa att URL:en är korrekt där också.

Filer som ändras
- `src/pages/SplitViewer.tsx` (huvudfix: korrekt Ivion-URL och baseUrl från config)

Acceptanskriterier
- Split View öppnas utan att fastna på laddning.
- 360+-panelen visar Ivion som i `/ivion-inventory` (dvs korrekt viewer, inte “Kodformatering”).
- Centralstationen (med Ivion Site ID) fungerar direkt när man klickar “3D+360°”.

Tekniska detaljer (konkret pseudo-kod)
- I `SplitViewerContent`:
  - `const { appConfigs } = useContext(AppContext)` (eller skicka ner som prop från parent om du vill undvika extra context-call)
  - `const configured = appConfigs?.radar?.url?.trim()`
  - `const baseUrl = configured ? configured.replace(/\/$/, '') : 'https://swg.iv.navvis.com'`
  - `const ivionUrl = `${baseUrl}/?site=${ivionSiteId}``

Risker / edge cases
- Om användaren har satt en annan Ivion-bas-URL i inställningar så kommer Split View nu respektera den (vilket är önskat).
- Om Ivion-instansen blockerar inbäddning (X-Frame-Options/CSP) skulle den ändå inte gå i iframe; men då hade vi sett en “refused to display in a frame”-typ av symptom snarare än “Kodformatering”. Den här ändringen adresserar den mest sannolika orsaken: fel entrypoint-URL.
