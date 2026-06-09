/**
 * FmaV2Diagnostics — probes FM Access endpoints to verify connectivity and discover API responses.
 * Can be removed once the integration is fully working.
 */
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Download } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface ProbeResult {
  label: string;
  path: string;
  method: string;
  status: number | string;
  success: boolean;
  preview: string;
  durationMs: number;
}

async function probe(label: string, path: string, method = 'GET', body?: object): Promise<ProbeResult> {
  const t0 = Date.now();
  try {
    const { data, error } = await supabase.functions.invoke('fm-access-query', {
      body: { action: 'proxy', path, method, ...(body ? { body } : {}) },
    });
    const durationMs = Date.now() - t0;
    if (error) return { label, path, method, status: 'edge-error', success: false, preview: error.message, durationMs };
    const preview = JSON.stringify(data?.data ?? data).substring(0, 400);
    return { label, path, method, status: data?.status ?? '?', success: !!data?.success, preview, durationMs };
  } catch (e: any) {
    return { label, path, method, status: 'exception', success: false, preview: e.message, durationMs: Date.now() - t0 };
  }
}

// Known root: classId=104, objectId=41855 from search results
// Known plan: classId=105, objectId=32129 from network capture
// Plan: classId=105, objectId=32129 ("2 Tr" floor, confirmed)
// Known classes: 106=Ritning, 138=?, 139=Fönster, 124=?, 109=?, 110=?
const PROBES: Array<{ label: string; path: string; method?: string; body?: object }> = [
  // ── Find BLM Demo root ──
  { label: 'Kfast full object (has parentId?)', path: '/api/object/byguid/json/9dc70023-dc72-49c7-9012-0bcc0ac22f63' },
  { label: 'Kfast object list (full metadata)', path: '/api/object/list/json/103/41854' },
  { label: 'Search: Demo', path: '/api/search/quick?query=Demo' },
  { label: 'Search: BLM', path: '/api/search/quick?query=BLM' },
  { label: 'Perspective tree parent via path', path: '/api/perspective/path/json/8/103/41854' },
  { label: 'Perspective 8 class 102 obj 41853', path: '/api/perspective/json/8/102/41853' },
  { label: 'Perspective 8 class 102 obj 41852', path: '/api/perspective/json/8/102/41852' },
  { label: 'Perspective 8 class 102 obj 41856', path: '/api/perspective/json/8/102/41856' },
  { label: 'Perspective 8 class 101 obj 1', path: '/api/perspective/json/8/101/1' },
  { label: 'Perspective 8 class 100 obj 1', path: '/api/perspective/json/8/100/1' },
  { label: 'Object parent endpoint', path: '/api/object/parent/json/8/103/41854' },
  // ── Grid via perspective 9 (same pattern as tree but perspective 9) ──
  { label: 'Grid p9: class 138 under floor 32129', path: '/api/perspective/json/9/138/32129' },
  { label: 'Grid p9: class 139 (Fönster) under floor 32129', path: '/api/perspective/json/9/139/32129' },
  { label: 'Grid p9: class 106 (Ritning) under floor 32129', path: '/api/perspective/json/9/106/32129' },
  { label: 'Grid p9: class 107 (Rum?) under floor 32129', path: '/api/perspective/json/9/107/32129' },
  { label: 'Grid p9: class 110 under floor 32129', path: '/api/perspective/json/9/110/32129' },

  // ── Grid metadata with correct array body format ──
  { label: 'Grid meta 138 + array body', path: '/api/perspective/metadata/json/9?childClassId=138&offset=0&limit=20', method: 'POST',
    body: [{ classId: 105, objectId: 32129 }] },
  { label: 'Grid meta 139 + array body', path: '/api/perspective/metadata/json/9?childClassId=139&offset=0&limit=20', method: 'POST',
    body: [{ classId: 105, objectId: 32129 }] },

  // ── Class config (full labels) ──
  { label: 'Class config (all classes)', path: '/api/config/classes/json' },

  // ── Find root of tree ──
  { label: 'Search: BLM', path: '/api/search/quick?query=BLM' },
  { label: 'Search: Kfast', path: '/api/search/quick?query=Kfast' },
  { label: 'Perspective 8 for class 103/31214 (from XHR)', path: '/api/perspective/json/8/103/31214' },
];

const FmaV2Diagnostics: React.FC = () => {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<ProbeResult[]>([]);
  const [done, setDone] = useState(false);

  const runDiagnostics = async () => {
    setRunning(true);
    setResults([]);
    setDone(false);
    const all: ProbeResult[] = [];
    for (const p of PROBES) {
      const r = await probe(p.label, p.path, p.method, p.body);
      all.push(r);
      setResults([...all]);
    }
    setDone(true);
    setRunning(false);
    console.log('[FmaV2 Diagnostics]', JSON.stringify(all, null, 2));
  };

  const download = () => {
    const blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob), download: 'fma-diagnostics-v2.json',
    });
    a.click();
  };

  return (
    <div className="flex flex-col h-full p-4 gap-4">
      <div>
        <h2 className="text-sm font-semibold mb-1">FM Access Diagnostics v2</h2>
        <p className="text-xs text-muted-foreground mb-3">
          Provar {PROBES.length} endpoints med korrekta IDs från nätverkskapturingen.
        </p>
        <div className="flex gap-2">
          <Button size="sm" onClick={runDiagnostics} disabled={running} className="gap-1.5">
            {running && <Loader2 size={13} className="animate-spin" />}
            {running ? 'Kör…' : 'Kör diagnostik v2'}
          </Button>
          {done && <Button size="sm" variant="outline" onClick={download} className="gap-1.5">Ladda ned</Button>}
        </div>
      </div>

      {results.length > 0 && (
        <ScrollArea className="flex-1 border border-border rounded-md">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted">
              <tr>
                <th className="text-left px-3 py-1.5 font-medium">Endpoint</th>
                <th className="text-left px-3 py-1.5 font-medium w-16">Status</th>
                <th className="text-left px-3 py-1.5 font-medium">Svar</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={i} className="border-t border-border/50">
                  <td className="px-3 py-1.5">
                    <div className="font-medium">{r.label}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">{r.method} {r.path}</div>
                  </td>
                  <td className="px-3 py-1.5">
                    <span className={`font-mono font-bold ${r.success ? 'text-green-500' : r.status === 404 ? 'text-orange-400' : 'text-red-400'}`}>
                      {String(r.status)}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 font-mono text-[10px] max-w-sm">
                    <div className="truncate">{r.preview}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollArea>
      )}
      {done && <p className="text-xs text-muted-foreground">✓ Klart. Ladda ned JSON och dela med Claude.</p>}
    </div>
  );
};

export default FmaV2Diagnostics;
