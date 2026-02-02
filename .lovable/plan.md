
# Plan: Kostnadsfri AI Avatar-video för Onboarding

## Sammanfattning
Skapa en "talande AI-avatar"-upplevelse för onboarding helt utan externa kostnader genom att kombinera:

1. **Lovable AI (google/gemini-2.5-flash-image)** - Generera en personlig avatar-bild baserad på användarens roll
2. **Web Speech API** - Redan implementerat för text-to-speech
3. **CSS-animationer** - "Talking head"-effekt med pulsering och ljuseffekter
4. **Canvas/SVG ljudvågor** - Visuell feedback när avataren "pratar"

Detta ger en videokänsla utan att faktiskt generera video - helt gratis!

---

## Arkitektur

```text
┌─────────────────────────────────────────────────────────────────┐
│                      Onboarding Flow                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   1. Användare väljer roll + mål                                │
│                    │                                            │
│                    ▼                                            │
│   2. Edge Function: generate-onboarding-avatar                  │
│      ├── Anropar Gemini för manus (befintligt)                  │
│      └── Anropar Gemini Image för avatar-bild                   │
│                    │                                            │
│                    ▼                                            │
│   3. Frontend: OnboardingComplete                               │
│      ├── Visar genererad avatar-bild                            │
│      ├── Animerar avatar med CSS när TTS spelar                 │
│      ├── Visar ljudvågor/visualizer                             │
│      └── Synkad text-highlight (karaoke-stil)                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Del 1: Edge Function för Avatar-generering

### Ny fil: `supabase/functions/generate-onboarding-avatar/index.ts`

Genererar BÅDE manus och avatar-bild i samma anrop:

```typescript
// Prompt för avatar-generering baserat på roll
const avatarPrompts: Record<string, string> = {
  fm_technician: "Professional-looking facility manager avatar, wearing safety vest, friendly smile, digital twin theme, futuristic office background, soft lighting, portrait style",
  property_manager: "Professional property manager avatar, business attire, confident expression, modern office with city view, warm lighting, portrait style",
  consultant: "Expert consultant avatar, smart casual attire, approachable demeanor, technology-focused background, professional lighting, portrait style",
  other: "Friendly professional avatar, neutral business attire, welcoming expression, modern workspace background, balanced lighting, portrait style"
};

// Anropa Lovable AI med bildgenerering
const imageResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${LOVABLE_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "google/gemini-2.5-flash-image",
    messages: [{ role: "user", content: avatarPrompt }],
    modalities: ["image", "text"]
  }),
});

// Extrahera base64-bild från svaret
const imageUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
```

Returnerar:
- `script` - AI-genererat manus (befintligt)
- `avatarImage` - Base64-bild av avataren

---

## Del 2: Uppdaterad OnboardingComplete-komponent

### Visuell layout

```text
┌─────────────────────────────────────┐
│         Your AI Guide               │
│                                     │
│      ┌───────────────────┐          │
│      │                   │          │
│      │   [Avatar-bild]   │  ← Pulserar vid tal
│      │    (animerad)     │          │
│      │                   │          │
│      └───────────────────┘          │
│                                     │
│      ════════════════════           │  ← Ljudvåg-visualizer
│                                     │
│      "Welcome to Geminus!           │  ← Text med highlight
│       As a Property Manager..."     │     på aktuell mening
│                                     │
│      [▶ Play] [⏸ Pause] [🔄 Replay] │
│                                     │
│      [Start Exploring →]            │
│                                     │
└─────────────────────────────────────┘
```

### Nya funktioner

**2.1 Avatar-bild med animationer:**
```tsx
<div className={cn(
  "relative w-32 h-32 rounded-full overflow-hidden mx-auto",
  isSpeaking && "animate-pulse ring-4 ring-primary/50"
)}>
  <img src={avatarImage} alt="AI Guide" className="w-full h-full object-cover" />
  {isSpeaking && (
    <div className="absolute inset-0 bg-primary/10 animate-ping" />
  )}
</div>
```

**2.2 Ljudvåg-visualizer:**
```tsx
const AudioVisualizer: React.FC<{ isActive: boolean }> = ({ isActive }) => (
  <div className="flex items-center justify-center gap-1 h-8">
    {[...Array(5)].map((_, i) => (
      <div 
        key={i}
        className={cn(
          "w-1 bg-primary rounded-full transition-all",
          isActive ? "animate-sound-wave" : "h-1"
        )}
        style={{ animationDelay: `${i * 0.1}s` }}
      />
    ))}
  </div>
);
```

**2.3 Mening-för-mening highlight:**
Dela upp scriptet i meningar och highlighta den som just talas (synkad med Web Speech API:s `boundary`-events).

---

## Del 3: CSS-animationer

### Nya Tailwind-animationer i `tailwind.config.ts`:

```javascript
keyframes: {
  'sound-wave': {
    '0%, 100%': { height: '4px' },
    '50%': { height: '24px' },
  },
  'avatar-glow': {
    '0%, 100%': { boxShadow: '0 0 20px rgba(var(--primary), 0.3)' },
    '50%': { boxShadow: '0 0 40px rgba(var(--primary), 0.6)' },
  }
},
animation: {
  'sound-wave': 'sound-wave 0.5s ease-in-out infinite',
  'avatar-glow': 'avatar-glow 1.5s ease-in-out infinite',
}
```

---

## Del 4: Förbättrad Speech Sync

### Boundary Events för text-highlight

```typescript
const utterance = new SpeechSynthesisUtterance(script);

// Split script into sentences
const sentences = script.match(/[^.!?]+[.!?]+/g) || [script];
let currentSentenceIndex = 0;

utterance.onboundary = (event) => {
  if (event.name === 'sentence') {
    setHighlightedSentence(currentSentenceIndex);
    currentSentenceIndex++;
  }
};
```

---

## Filer som ändras/skapas

| Fil | Ändring |
|-----|---------|
| `supabase/functions/generate-onboarding-avatar/index.ts` | **NY** - Kombinerad manus + avatar-generering |
| `src/components/onboarding/OnboardingComplete.tsx` | Lägg till avatar-bild, animationer, visualizer |
| `src/components/onboarding/AudioVisualizer.tsx` | **NY** - Ljudvåg-komponent |
| `src/pages/Onboarding.tsx` | Uppdatera för att hantera avatarImage |
| `tailwind.config.ts` | Lägg till nya animationer |
| `supabase/config.toml` | Registrera ny edge function |

---

## Fördelar med denna lösning

| Aspekt | Fördel |
|--------|--------|
| **Kostnad** | Helt gratis - använder endast Lovable AI (ingår) |
| **Hastighet** | Snabbare än videogenerering (~2-5 sek vs minuter) |
| **Personalisering** | Unik avatar per roll |
| **Interaktivitet** | Användaren kan pausa/återuppta |
| **Tillgänglighet** | Text alltid synlig, inte beroende av video |
| **Offline-fallback** | Fungerar även om bild misslyckas |

---

## Fallback-strategi

Om bildgenerering misslyckas:
1. Visa en stiliserad ikon-avatar (sparkles/robot-ikon)
2. TTS och text fungerar fortfarande
3. Logga fel för debugging

---

## Framtida förbättringar (valfritt)

Om ni senare vill uppgradera till riktig video:
- **Synthesia** - Skapa templates för varje roll
- **HeyGen** - Alternativ videoplattform
- Denna lösning kan enkelt bytas ut eftersom gränssnittet redan är video-liknande

---

## Testning efter implementation

1. **Avatar-generering:** Kör onboarding som olika roller → verifiera att unika avatarer genereras
2. **TTS + Animation:** Klicka Play → verifiera att avatar pulserar och ljudvågor animeras
3. **Text-highlight:** Verifiera att meningar highlightas i takt med talet
4. **Fallback:** Testa med skapad avatar-generering misslyckad → verifiera att fallback-ikon visas
5. **Performance:** Kontrollera att total laddningstid < 5 sekunder

