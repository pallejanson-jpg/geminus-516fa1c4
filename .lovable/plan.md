

## Plan

### Del 1: Ändra text — "Import Excel"

Enkel textändring i `CreateBuildingPanel.tsx`:

- **Rad 765**: "Inventera via Excel" → "Import Excel"
- **Rad 768**: Byt den svenska beskrivningen till engelska: "Download a template pre-filled with floors and rooms, fill in assets offline, and import back."
- **Rad 785**: "Importera Excel" → "Import Excel" (redan nästan rätt, bara ta bort svenska)

---

### Del 2: Samarbetsfunktion — Co-Presence i 3D-viewern

Det du beskriver är en **co-presence**-funktion: flera användare ser varandra i realtid i 3D-viewern, med avatarer som visar var de befinner sig, plus video/röst-kommunikation.

#### Arkitekturval

| Alternativ | Fördel | Nackdel |
|---|---|---|
| **Lovable Cloud Realtime** (inbyggt) | Redan tillgängligt, inga extra kostnader, perfekt för position/cursor-synk | Ingen video/röst |
| **Daily.co** (WebRTC) | Enkel API, bra React SDK, video+röst+skärmdelning | Externt konto krävs |
| **LiveKit** (WebRTC, open source) | Self-hostable, bra React SDK, låg latens | Kräver server |
| **Microsoft Teams SDK** | Välkänt, enterprise | Komplex setup, kräver Azure AD |

**Rekommendation:** Dela upp i två delar:

1. **Co-presence (position + avatarer)** — Bygg med **Lovable Cloud Realtime** (Presence-kanaler). Varje användare broadcastar sin kameraposition + aktiva vy → andra ser en animerad avatar/markör i 3D. Inget externt beroende.

2. **Video/röst** — Integrera **Daily.co** eller **LiveKit** som ett litet videofönster i viewern. Daily har enklast React-integration och gratis tier (10 000 min/månad).

#### Föreslagen implementation (framtida plan)

**Fas 1 — Co-presence utan video:**
- Ny Realtime-kanal per byggnad: `presence:building:{id}`
- Varje användare skickar: `{ userId, displayName, avatarUrl, cameraEye, cameraLook, activeFloor }`
- I viewern: rendera en liten 3D-avatar (sfär/ikon) vid varje annan användares kameraposition
- Sidopanel: lista aktiva användare med "fly to" knapp

**Fas 2 — Video/röst:**
- Integrera Daily.co eller LiveKit
- Litet videofönster (bild-i-bild) per deltagare, förankrat i viewern
- Mute/unmute, skärmdelning

Det här är ett stort feature — vill du att jag börjar med **Del 1 (textändringen)** nu, och sedan planerar vi co-presence som ett separat projekt?

