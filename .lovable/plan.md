
# Plan: Röststyrning för appen

## Sammanfattning

Implementera röststyrning som låter användare navigera och styra appen genom talkommandon. Systemet ska:
1. Lyssna på röstkommandon och konvertera till text (Speech-to-Text)
2. Tolka kommandon och matcha mot app-åtgärder
3. Utföra åtgärder automatiskt (navigera, söka, öppna 3D, etc.)

---

## Arkitektur

```text
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Mikrofon      │────>│  Speech-to-Text  │────>│  Kommandotolk   │
│   (Browser)     │     │  (ElevenLabs)    │     │  (Lokal logik)  │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                                         │
                              ┌───────────────────────────┘
                              ▼
                    ┌─────────────────┐
                    │  App Actions    │
                    │  (AppContext)   │
                    └─────────────────┘
```

### Två alternativa implementationer

**Alternativ A: ElevenLabs Realtime STT (Rekommenderat)**
- Ultra-låg latens för streaming tal-till-text
- Kräver ELEVENLABS_API_KEY via connector
- Professionellt och snabbt

**Alternativ B: Web Speech API (Inbyggt i webbläsaren)**
- Gratis, ingen API-nyckel behövs
- Fungerar direkt i Chrome/Edge/Safari
- Enklare att komma igång men mindre precis

---

## Del 1: Kommandon som stöds

### Navigationskommandon
| Röstkommando (svenska) | Åtgärd |
|------------------------|--------|
| "Öppna hem" / "Gå till hem" | `setActiveApp('home')` |
| "Öppna portfolio" / "Visa portfolio" | `setActiveApp('portfolio')` |
| "Öppna navigator" / "Starta navigator" | `setActiveApp('navigation')` |
| "Öppna karta" / "Visa karta" | `setActiveApp('map')` |
| "Öppna insights" | `setActiveApp('insights')` |
| "Öppna 3D-visaren" | `setActiveApp('assetplus_viewer')` |

### Sökkommandon
| Röstkommando | Åtgärd |
|--------------|--------|
| "Sök [byggnad/rum]" | Öppnar sökning med termen |
| "Hitta [namn]" | Söker och visar resultat |

### 3D-kommandon
| Röstkommando | Åtgärd |
|--------------|--------|
| "Visa [byggnad] i 3D" | `setViewer3dFmGuid(matchedBuilding.fmGuid)` |
| "Stäng 3D" | `setViewer3dFmGuid(null)` |

### Assistentkommandon
| Röstkommando | Åtgärd |
|--------------|--------|
| "Prata med Gunnar" / "Öppna Gunnar" | Öppnar AI-chatten |
| "Fråga Gunnar: [fråga]" | Skickar fråga direkt till Gunnar |

### Hjälpkommando
| Röstkommando | Åtgärd |
|--------------|--------|
| "Hjälp" / "Vilka kommandon finns?" | Visar lista över kommandon |

---

## Del 2: Kommandotolk (Command Parser)

**Ny fil:** `src/hooks/useVoiceCommands.ts`

### Logik
```typescript
interface VoiceCommand {
  patterns: RegExp[];  // Mönster att matcha mot
  action: (ctx: AppContext, match: RegExpMatchArray) => void;
  description: string;
}

const VOICE_COMMANDS: VoiceCommand[] = [
  {
    patterns: [
      /^(öppna|gå till|visa) (hem|home|startsidan)$/i,
      /^start$/i,
    ],
    action: (ctx) => ctx.setActiveApp('home'),
    description: "Öppna hem",
  },
  {
    patterns: [
      /^(öppna|gå till|visa) (portfolio|portfölj|fastigheter)$/i,
    ],
    action: (ctx) => ctx.setActiveApp('portfolio'),
    description: "Öppna portfolio",
  },
  {
    patterns: [
      /^(öppna|starta|visa) (navigator|navigatorn|träd|trädvy)$/i,
    ],
    action: (ctx) => ctx.setActiveApp('navigation'),
    description: "Öppna navigator",
  },
  {
    patterns: [
      /^(öppna|visa) (karta|kartan|map)$/i,
    ],
    action: (ctx) => ctx.setActiveApp('map'),
    description: "Öppna karta",
  },
  {
    patterns: [
      /^(öppna|visa) (3d|tre-d|viewer|visare)$/i,
    ],
    action: (ctx) => ctx.setActiveApp('assetplus_viewer'),
    description: "Öppna 3D-visare",
  },
  {
    patterns: [
      /^visa (.+) i 3d$/i,
      /^öppna (.+) i 3d$/i,
    ],
    action: (ctx, match) => {
      const searchTerm = match[1];
      // Sök i navigatorTreeData efter matchande byggnad
      const building = findBuilding(ctx.navigatorTreeData, searchTerm);
      if (building) {
        ctx.setViewer3dFmGuid(building.fmGuid);
      }
    },
    description: "Visa byggnad i 3D",
  },
  {
    patterns: [
      /^(stäng|avsluta) 3d$/i,
    ],
    action: (ctx) => ctx.setViewer3dFmGuid(null),
    description: "Stäng 3D-visare",
  },
  {
    patterns: [
      /^(sök|hitta|leta efter) (.+)$/i,
    ],
    action: (ctx, match) => {
      const searchTerm = match[2];
      // Trigger global search
      // Öppna sökfält och sätt sökterm
    },
    description: "Sök efter objekt",
  },
];
```

---

## Del 3: Voice Control Button/Panel

**Ny fil:** `src/components/voice/VoiceControlButton.tsx`

### UI-komponenten
- Flytande mikrofon-knapp i hörnet (på mobil)
- Pulserar när den lyssnar
- Visar transkriberad text i en liten popup
- Visar feedback för utförda kommandon

```typescript
interface VoiceControlButtonProps {
  onCommand: (command: string) => void;
}

export default function VoiceControlButton({ onCommand }: VoiceControlButtonProps) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [feedback, setFeedback] = useState("");
  
  // ElevenLabs useScribe hook ELLER Web Speech API
  
  return (
    <div className="fixed bottom-20 right-4 z-50 flex flex-col items-end gap-2">
      {/* Transkription-popup */}
      {transcript && (
        <div className="bg-card border rounded-lg px-3 py-2 text-sm shadow-lg">
          "{transcript}"
        </div>
      )}
      
      {/* Feedback-popup */}
      {feedback && (
        <div className="bg-primary text-primary-foreground rounded-lg px-3 py-2 text-sm">
          ✓ {feedback}
        </div>
      )}
      
      {/* Mikrofon-knapp */}
      <Button
        onClick={toggleListening}
        size="lg"
        className={cn(
          "h-14 w-14 rounded-full shadow-lg",
          isListening && "animate-pulse bg-red-500"
        )}
      >
        {isListening ? <MicOff /> : <Mic />}
      </Button>
    </div>
  );
}
```

---

## Del 4: ElevenLabs Integration (Alternativ A)

### Steg 1: Anslut ElevenLabs connector

Använda `connect` tool med `connector_id: elevenlabs` för att konfigurera API-nyckeln.

### Steg 2: Skapa Edge Function för token

**Ny fil:** `supabase/functions/elevenlabs-scribe-token/index.ts`

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY");
  if (!ELEVENLABS_API_KEY) {
    return new Response(JSON.stringify({ error: "ElevenLabs not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const response = await fetch(
    "https://api.elevenlabs.io/v1/single-use-token/realtime_scribe",
    {
      method: "POST",
      headers: { "xi-api-key": ELEVENLABS_API_KEY },
    }
  );

  const { token } = await response.json();

  return new Response(JSON.stringify({ token }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
```

### Steg 3: React-komponent med useScribe

```typescript
import { useScribe } from "@elevenlabs/react";

function VoiceControlWithElevenLabs({ onCommand }) {
  const scribe = useScribe({
    modelId: "scribe_v2_realtime",
    commitStrategy: "vad",
    onCommittedTranscript: (data) => {
      const command = data.text.toLowerCase().trim();
      onCommand(command);
    },
  });
  
  const start = async () => {
    const { data } = await supabase.functions.invoke("elevenlabs-scribe-token");
    if (data?.token) {
      await scribe.connect({ token: data.token, microphone: { noiseSuppression: true } });
    }
  };
  
  // ...
}
```

---

## Del 5: Web Speech API (Alternativ B - Gratis)

**Fallback utan API-nyckel:**

```typescript
function useWebSpeechRecognition() {
  const [transcript, setTranscript] = useState("");
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  const start = useCallback(() => {
    const SpeechRecognition = 
      window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      toast.error("Röststyrning stöds inte i denna webbläsare");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "sv-SE";  // Svenska
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      const result = event.results[event.results.length - 1];
      setTranscript(result[0].transcript);
      
      if (result.isFinal) {
        // Skicka till kommandotolk
        onCommand(result[0].transcript);
      }
    };

    recognition.onend = () => setIsListening(false);
    recognition.onerror = (e) => console.error("Speech error:", e);

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, [onCommand]);

  return { start, stop, isListening, transcript };
}
```

---

## Del 6: Integration i AppLayout

**Ändra:** `src/components/layout/AppLayout.tsx`

```typescript
import VoiceControlButton from '@/components/voice/VoiceControlButton';
import { useVoiceCommands } from '@/hooks/useVoiceCommands';

const AppLayout: React.FC = () => {
  const appContext = useContext(AppContext);
  const { executeCommand } = useVoiceCommands(appContext);
  const isMobile = useIsMobile();

  return (
    <AppProvider>
      <div className="flex h-screen ...">
        {/* Existing layout */}
        
        {/* Voice control button - show on mobile or optionally desktop */}
        {isMobile && (
          <VoiceControlButton onCommand={executeCommand} />
        )}
      </div>
    </AppProvider>
  );
};
```

---

## Nya filer att skapa

| Fil | Beskrivning |
|-----|-------------|
| `src/hooks/useVoiceCommands.ts` | Kommandotolk med alla stödda kommandon |
| `src/hooks/useWebSpeechRecognition.ts` | Web Speech API-implementation |
| `src/components/voice/VoiceControlButton.tsx` | Flytande mikrofon-knapp |
| `supabase/functions/elevenlabs-scribe-token/index.ts` | Token-endpoint för ElevenLabs |

## Filer att ändra

| Fil | Ändringar |
|-----|-----------|
| `src/components/layout/AppLayout.tsx` | Lägg till VoiceControlButton |
| `package.json` | Lägg till @elevenlabs/react (om ElevenLabs används) |

---

## Implementationsordning

1. **Fas 1: Web Speech API (snabbstart)**
   - Implementera useWebSpeechRecognition hook
   - Skapa VoiceControlButton med grundläggande UI
   - Implementera kommandotolk med navigationskommandon

2. **Fas 2: Kommandoexpansion**
   - Lägg till sökkommandon
   - Lägg till 3D-kommandon med byggnadsmatchning
   - Integrera med Gunnar för avancerade frågor

3. **Fas 3: ElevenLabs-uppgradering (valfritt)**
   - Anslut ElevenLabs connector
   - Skapa token-endpoint
   - Byt till useScribe för bättre kvalitet

---

## Förväntade resultat

1. **Mikrofon-knapp** visas på mobila enheter
2. **Tryck och prata** - användaren trycker på knappen och säger ett kommando
3. **Transkription visas** i realtid medan användaren pratar
4. **Kommando tolkas** och utförs automatiskt
5. **Feedback visas** som bekräftelse ("Öppnade Portfolio")

### Exempel på användarflöde:
```
Användare: [trycker på mikrofon-knappen]
Användare: "Öppna portfolio"
App: [visar "Öppna portfolio" i transkriptions-popup]
App: [navigerar till Portfolio-vyn]
App: [visar "✓ Öppnade Portfolio" som feedback]
```

---

## Alternativ för att börja

Vill du att jag:

**A) Börjar med Web Speech API** (gratis, funkar direkt i de flesta webbläsare)?

**B) Sätter upp ElevenLabs först** (bättre kvalitet, kräver API-nyckel)?
