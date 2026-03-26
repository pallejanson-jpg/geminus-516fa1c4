

# Fix: Ilean Can't Find FM Access Documents

## Problem
When using Ilean for Labradorgatan 18 (or any building), it says "no documents found." Documents exist in FM Access but the sync pipeline only stores **metadata** (names) in `fm_access_documents` — it never downloads/extracts the actual document **content** into `document_chunks` for semantic search.

## Current Flow (broken)
```text
FM Access API → sync-documents → fm_access_documents (metadata only)
                               → document_chunks (drawing NAMES only, ~1 line each)
```

Ilean searches `document_chunks` by `building_fm_guid` + keywords → finds almost nothing because chunks contain only short drawing titles like "Ritning A-00 Plan 1".

## Fix: Index FM Access Document Content

### 1. `supabase/functions/fm-access-sync/index.ts` — enhance `sync-documents`

After storing metadata in `fm_access_documents`, also index **all collected nodes** (not just drawings) into `document_chunks`:

- For each node in the perspective tree, build a richer content string from available fields: `objectName`, `className`, `parentFloorName`, any description/properties
- Also collect **rooms** (classId 107) with their names/properties as chunks — these are often what users ask about
- Index structural nodes too (floors with room lists) so Ilean can answer "what rooms are on floor X?"

Currently only drawings (classId 106) are indexed. Expand to index **all non-building nodes** (floors, rooms, documents, equipment) so the full building knowledge is searchable.

### 2. `supabase/functions/fm-access-sync/index.ts` — also index `fm_access_drawings` content

For each drawing, if a PDF URL exists, try to fetch and extract text via the existing `index-documents` AI extraction pipeline. This is optional/expensive but would give Ilean actual document content.

**Simpler alternative (recommended):** Just index the full hierarchy tree as structured text chunks — room names, floor names, object names, class types. This already gives Ilean enough to answer "what documents/rooms/drawings exist?"

### 3. Concrete change in `sync-documents` action

After the existing drawing indexing loop (~line 239), add a second loop that indexes **all collected document nodes + structural nodes** into `document_chunks`:

```ts
// Index ALL nodes as document_chunks for semantic search
for (const node of allNodes) {
  const content = [
    node.objectName || node.ObjectName || "",
    node.className || "",
    `Typ: ${node.classId || ""}`,
  ].filter(Boolean).join(" | ");
  
  if (content.trim().length > 3) {
    await supabase.from("document_chunks").upsert({
      source_type: "fm_access",
      source_id: `doc-${node.objectId || node.ObjectId}`,
      building_fm_guid: b.fm_guid,
      file_name: node.objectName || "FM Access dokument",
      content,
      chunk_index: 0,
      metadata: { system: "fm_access", type: "document", classId: node.classId },
    }, { onConflict: "source_type,source_id,chunk_index", ignoreDuplicates: false });
  }
}
```

Also index the **full structural tree** (rooms on each floor):

```ts
// Index rooms (classId 107) for richer search
const rooms: any[] = [];
if (Array.isArray(treeData)) {
  treeData.forEach((n: any) => collectByClassId(n, 107, rooms));
} else if (treeData) {
  collectByClassId(treeData, 107, rooms);
}

for (const room of rooms) {
  const content = [
    room.objectName || room.ObjectName || "",
    room._parentFloorName || "",
    "Rum",
  ].filter(Boolean).join(" | ");
  
  if (content.trim()) {
    await supabase.from("document_chunks").upsert({
      source_type: "fm_access",
      source_id: `room-${room.objectId || room.ObjectId}`,
      building_fm_guid: b.fm_guid,
      file_name: room.objectName || "FM Access rum",
      content,
      chunk_index: 0,
      metadata: { system: "fm_access", type: "room" },
    }, { onConflict: "source_type,source_id,chunk_index", ignoreDuplicates: false });
  }
}
```

### 4. Also index floors (classId 105)

Same pattern — collect floors and index their names so Ilean can answer "which floors exist?"

## Files to modify

| File | Change |
|------|--------|
| `supabase/functions/fm-access-sync/index.ts` | Index all FM Access nodes (documents, rooms, floors) into `document_chunks`, not just drawing titles |

## After deployment
The user needs to re-run the FM Access document sync (from Settings or via Gunnar) to populate `document_chunks` for Labradorgatan 18. After that, Ilean will find the indexed content.

## Expected outcome
- Ilean finds FM Access documents, rooms, and drawings when asked
- Search covers all building hierarchy nodes, not just drawing names

