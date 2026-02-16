

## Senslinc IoT Integration Improvements

### Background

The Senslinc edge function (`senslinc-query/index.ts`) and Gunnar's AI tools are partially built but have two critical gaps blocking reliable IoT data retrieval.

---

### Problem 1: Authentication fails under load (HTTP 429)

The `getJwtToken` function tries two payloads (email, username) sequentially. If the Senslinc server returns **429 Too Many Requests**, the function immediately tries the next payload (which also gets 429), then throws an error. There is **no retry logic and no token caching**, so every single request triggers a fresh login -- amplifying the rate-limit problem.

### Problem 2: Gunnar cannot discover workspace keys

The `senslinc_search_data` tool requires a mandatory `workspace_key` parameter, but Gunnar has no way to discover valid workspace keys. He must guess, which always fails. A `senslinc_get_indices` tool is needed.

---

### Changes

#### File 1: `supabase/functions/senslinc-query/index.ts`

**A. Add token cache (55-minute TTL)**

A module-level variable stores the last successful JWT token with an expiry timestamp. Subsequent requests reuse the cached token, drastically reducing auth calls.

```typescript
let cachedToken: { token: string; expiresAt: number } | null = null;
const TOKEN_TTL_MS = 55 * 60 * 1000; // 55 minutes
```

**B. Add exponential backoff retry for 429 in `getJwtToken`**

Wrap the existing two-payload loop inside an outer retry loop (max 3 retries, delays: 1s, 2s, 4s). On 429, wait and retry instead of failing immediately.

```typescript
async function getJwtToken(apiUrl, email, password): Promise<string> {
  // Return cached token if valid
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  const maxRetries = 3;
  let delay = 1000;

  for (let retry = 0; retry <= maxRetries; retry++) {
    if (retry > 0) {
      await new Promise(r => setTimeout(r, delay));
      delay *= 2;
    }

    for (const attempt of attempts) {
      const response = await fetch(tokenUrl, { ... });

      if (response.status === 429) {
        break; // break inner loop, retry outer loop with backoff
      }

      if (response.ok) {
        const data = await response.json();
        cachedToken = { token: data.token, expiresAt: Date.now() + TOKEN_TTL_MS };
        return data.token;
      }
    }
  }
  throw new Error('Authentication failed after retries');
}
```

No other parts of `senslinc-query/index.ts` change -- all existing actions (get-sites, get-indices, search-data, etc.) remain the same.

---

#### File 2: `supabase/functions/gunnar-chat/index.ts`

**A. New tool definition: `senslinc_get_indices`**

Added to the `tools` array so Gunnar can discover available Elasticsearch workspaces/indices:

```typescript
{
  type: "function",
  function: {
    name: "senslinc_get_indices",
    description: "List available Senslinc Elasticsearch indices/workspaces. Use this to discover valid workspace_key values before calling senslinc_search_data.",
    parameters: { type: "object", properties: {}, required: [] },
  },
}
```

**B. New execution function**

```typescript
async function execSenslincGetIndices() {
  return callSenslincQuery("get-indices", {});
}
```

**C. New case in `executeTool` switch**

```typescript
case "senslinc_get_indices": return execSenslincGetIndices();
```

**D. Updated system prompt -- Senslinc workflow section**

Replace the current Senslinc instructions with a clear recommended chain:

```
SENSLINC (IoT / SENSOR DATA):
RECOMMENDED WORKFLOW:
1. senslinc_get_sites -- discover monitored buildings
2. senslinc_get_equipment(fm_guid) -- find sensors, get dashboard URL
3. senslinc_get_indices -- discover available workspace keys (REQUIRED before search_data)
4. senslinc_search_data(workspace_key, ...) -- query time-series data

IMPORTANT:
- ALWAYS call senslinc_get_indices first to discover valid workspace_key values
- Use senslinc_get_equipment to find machine_code values for filtering
- Present dashboard links as clickable Markdown links
- Summarize readings with min/max/avg and flag anomalies
```

---

### Summary

| Change | File | Purpose |
|--------|------|---------|
| Token cache (55 min TTL) | senslinc-query/index.ts | Reduce auth calls |
| Retry with backoff for 429 | senslinc-query/index.ts | Survive rate limiting |
| `senslinc_get_indices` tool | gunnar-chat/index.ts | Workspace discovery |
| Updated system prompt | gunnar-chat/index.ts | Guide Gunnar's IoT workflow |

