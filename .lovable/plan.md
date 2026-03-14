

## Plan: Bredare inputfält i Geminus AI (mobil-fokus)

### Problem
Mic- och högtalar-knapparna tar för mycket plats bredvid inputfältet, speciellt på mobil (314px viewport). Inputfältet blir för smalt och man ser knappt vad man skriver.

### Lösning
Flytta mic/högtalare-knapparna till en egen rad ovanför inputfältet på mobil. På desktop behålls nuvarande layout (allt på en rad).

### Ändringar i `src/components/chat/GunnarChat.tsx`

**Båda input-sektionerna (rad ~668 och ~771):**

1. Wrappa mic/högtalare + input i en `flex-col` container på mobil, `flex-row` på desktop
2. Mic/högtalare-knappar hamnar i en liten rad ovanför inputfältet på mobil (med `sm:hidden` / `hidden sm:flex` pattern)
3. Inputfältet tar hela bredden på mobil — bara Send-knappen bredvid
4. Minska knappstorlek ytterligare på mobil: `h-6 w-6` istället för `h-7 w-7`

**Resultat på mobil:**
```text
[🔊] [🎤]              ← liten rad med ikoner
[Ställ en fråga...............] [➤]  ← full bredd input
```

**Resultat på desktop (oförändrat):**
```text
[🔊][🎤] [Ställ en fråga...............] [➤]
```

