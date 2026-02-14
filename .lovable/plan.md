

## Fix: FMA+ startar inte "In App"

### Orsak
Problemet beror pa att `appConfigs` sparas i `localStorage` och laddas vid start med en **ytlig merge**:

```typescript
return { ...DEFAULT_APP_CONFIGS, ...JSON.parse(stored) };
```

Nar anvandaren tidigare anvande appen hade `fma_plus.openMode` vardet `'external'` (det gamla standardvardet). Hela det sparade `fma_plus`-objektet skriver over det nya standardvardet `'internal'`. Aven om anvandaren aldrig andrat installningen manuellt, sa ligger det gamla vardet kvar.

### Losning
Andra laddningslogiken i `AppContext.tsx` till en **djup merge per app** sa att nya standardvarden (som `openMode: 'internal'`) appliceras korrekt, men anvandarens egna anpassningar (URL, losenord etc.) bevaras.

### Andringar

**`src/context/AppContext.tsx`** (rad 225-235)

Ersatt den ytliga mergen med en per-app deep merge:

```typescript
const [appConfigs, setAppConfigs] = useState(() => {
    const stored = typeof window !== 'undefined' 
        ? window.localStorage.getItem('appConfigs') : null;
    if (stored) {
        try {
            const parsed = JSON.parse(stored);
            // Deep merge: for each app, merge stored values ON TOP of defaults
            const merged: Record<string, any> = {};
            for (const key of Object.keys(DEFAULT_APP_CONFIGS)) {
                merged[key] = { ...DEFAULT_APP_CONFIGS[key], ...(parsed[key] || {}) };
            }
            // Keep any extra keys from stored that aren't in defaults
            for (const key of Object.keys(parsed)) {
                if (!merged[key]) merged[key] = parsed[key];
            }
            return merged;
        } catch (e) {
            return DEFAULT_APP_CONFIGS;
        }
    }
    return DEFAULT_APP_CONFIGS;
});
```

Detta loser problemet utan att anvandaren behover rensa sin localStorage manuellt. Alla sparade URL:er, losenord och andra installningar bevaras -- men nya standardvarden fran `DEFAULT_APP_CONFIGS` (som `openMode: 'internal'` for FMA+) appliceras korrekt om anvandaren inte explicit har andrat dem.

### Sidoeffekt
Ingen -- anvandarens medvetet andrade installningar bevaras. Det enda som andras ar att saknade nycklar i sparade konfigurationer fylls i med standardvarden.
