

## Update FM Access API URL and Test Connection

### What we'll do
1. Update the `FM_ACCESS_API_URL` secret from the current placeholder value (`"xx"`) to the correct URL: `https://landlord.bim.cloud`
2. Test the connection by calling the `test-connection` action on the edge function
3. Verify that token retrieval and version ID fetching work correctly

### Why
The FM Access integration is fully configured except for the API base URL, which is currently set to a placeholder. Once updated, the `/fm-access` dashboard and the 2D viewer mode should work end-to-end.

### Technical details
- Use the `add_secret` tool to update `FM_ACCESS_API_URL` to `https://landlord.bim.cloud`
- Call the `fm-access-query` edge function with `{"action": "test-connection"}` to verify
- No code changes are needed -- the edge function already uses this secret correctly

