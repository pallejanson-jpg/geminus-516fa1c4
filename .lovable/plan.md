
# Plan: Implementera Elasticsearch DSL-actions i Senslinc Edge Function

## Sammanfattning

Utöka `senslinc-query` edge function med tre nya actions för att hämta tidsseriedata via Elasticsearch DSL:
- `get-indices` - Lista tillgängliga data workspaces
- `get-properties` - Hämta sensortyper för ett specifikt index
- `search-data` - Kör Elasticsearch DSL-queries för tidsseriedata

## Ändringar

### 1. Lägg till exponential backoff-funktion

Ersätt `senslincFetch` med en ny `senslincFetchWithRetry` som hanterar 429-svar:

```typescript
async function senslincFetchWithRetry(
  apiUrl: string, 
  endpoint: string, 
  token: string,
  options?: { method?: string; body?: unknown }
): Promise<unknown> {
  const maxRetries = 3;
  let delay = 1000;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(`${apiUrl}${endpoint}`, {
      method: options?.method || 'GET',
      headers: { 
        'Authorization': `JWT ${token}`,
        'Content-Type': 'application/json',
      },
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });
    
    if (response.status === 429) {
      if (attempt < maxRetries) {
        console.log(`[Senslinc] Rate limited, retry ${attempt + 1}/${maxRetries} after ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2;
        continue;
      }
      throw new Error('Rate limit exceeded after retries');
    }
    
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Senslinc API error: ${response.status} - ${text}`);
    }
    
    return response.json();
  }
  
  throw new Error('Max retries exceeded');
}
```

### 2. Uppdatera SenslincRequest interface

```typescript
interface SenslincRequest {
  action: 'test-connection' | 'get-equipment' | 'get-site-equipment' | 
          'get-sites' | 'get-lines' | 'get-machines' | 'get-dashboard-url' |
          'get-indices' | 'get-properties' | 'search-data';
  fmGuid?: string;
  siteCode?: string;
  indiceId?: number;      // För get-properties
  workspaceKey?: string;  // För search-data
  query?: Record<string, unknown>;  // Elasticsearch DSL query
}
```

### 3. Lägg till nya case-block

```typescript
case 'get-indices': {
  const authToken = token as string;
  const indices = await senslincFetchWithRetry(cleanApiUrl, '/api/indices', authToken);
  return jsonResponse({ success: true, data: indices });
}

case 'get-properties': {
  if (!indiceId) {
    return jsonResponse({ success: false, error: 'indiceId required' }, 400);
  }
  const authToken = token as string;
  const properties = await senslincFetchWithRetry(
    cleanApiUrl, 
    `/api/properties?indice=${indiceId}`, 
    authToken
  );
  return jsonResponse({ success: true, data: properties });
}

case 'search-data': {
  if (!workspaceKey || !query) {
    return jsonResponse({ success: false, error: 'workspaceKey and query required' }, 400);
  }
  const authToken = token as string;
  const results = await senslincFetchWithRetry(
    cleanApiUrl,
    `/api/data-workspaces/${encodeURIComponent(workspaceKey)}/_search`,
    authToken,
    { method: 'POST', body: query }
  );
  return jsonResponse({ success: true, data: results });
}
```

### 4. Uppdatera authedActions

```typescript
const authedActions = new Set<SenslincRequest['action']>([
  'get-equipment',
  'get-site-equipment',
  'get-sites',
  'get-lines',
  'get-machines',
  'get-dashboard-url',
  'get-indices',      // NY
  'get-properties',   // NY
  'search-data',      // NY
]);
```

---

## Fil som ändras

| Fil | Ändring |
|-----|---------|
| `supabase/functions/senslinc-query/index.ts` | Lägg till `senslincFetchWithRetry`, tre nya actions, uppdatera interface |

---

## Tekniska detaljer

```text
Nytt API-flöde:
┌──────────────────┐    ┌──────────────────┐    ┌───────────────────────────┐
│   get-indices    │───▶│  get-properties  │───▶│       search-data         │
│ Lista workspaces │    │ Sensortyper för  │    │  Elasticsearch DSL query  │
│                  │    │   ett index      │    │  med exponential backoff  │
└──────────────────┘    └──────────────────┘    └───────────────────────────┘
```

**Rate-limiting strategi:**
- Delay: 1s → 2s → 4s
- Max 3 retries
- Loggar varje retry för debugging
