
The user wants strategic advice on architecture: should Geminus continue with Supabase as a sync/cache layer, or pivot to a pure API-frontend pattern (live calls only) against Asset+, FM Access, and Senslinc?

Key context from memory:
- "Successive Enrichment" strategy (sync structural metadata, live IoT)
- Asset+ has 80k+ assets, sync engine with pagination constraints
- API profiles for multi-tenant credentials
- FM Access has hybrid (iframe + native React)
- Faciliate uses hybrid (proxy + sync)
- Senslinc is already mostly live (no big tables)
- Multiple constraints: Småviken 404, sync timeouts, dual-storage CRUD complexity

The user is questioning if dual storage + sync is overengineered now that Geminus is becoming a "unified frontend" to three live systems. This is a strategic/architectural question that deserves a recommendation plan, not implementation.

I'll present an analysis with a clear recommended path: **Hybrid model** (keep cache for performance-critical reads, drop sync for CRUD), with concrete next steps.
