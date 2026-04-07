import React, { useState, useEffect, useCallback, useContext } from 'react';
import { Plus, Trash2, Play, RotateCcw, ChevronDown, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { AppContext } from '@/context/AppContext';
import { resolveXeokitViewer } from './RoomVisualizationPanel';
import { rgbToFloat } from '@/lib/visualization-utils';
import { emit } from '@/lib/event-bus';

// ─── Data model ───────────────────────────────────────────────
export interface ColorFilterCondition {
  id: string;
  target: 'category' | 'property';
  field: string;
  operator: 'equals' | 'contains' | 'gt' | 'lt' | 'gte' | 'lte';
  value: string;
}

export interface ColorFilterRule {
  id: string;
  name: string;
  color: string; // hex
  enabled: boolean;
  conditions: ColorFilterCondition[];
  logic: 'AND' | 'OR';
}

const STORAGE_KEY = 'objectColorFilterRules';

const IFC_CATEGORIES = [
  'IfcDoor', 'IfcWall', 'IfcWindow', 'IfcSlab', 'IfcSpace',
  'IfcColumn', 'IfcBeam', 'IfcStair', 'IfcRoof', 'IfcRailing',
  'IfcCovering', 'IfcFurnishingElement', 'IfcFlowTerminal',
  'IfcFlowSegment', 'IfcBuildingElementProxy',
];

const OPERATORS: { value: ColorFilterCondition['operator']; label: string }[] = [
  { value: 'equals', label: '=' },
  { value: 'contains', label: '∋' },
  { value: 'gt', label: '>' },
  { value: 'lt', label: '<' },
  { value: 'gte', label: '≥' },
  { value: 'lte', label: '≤' },
];

const DEFAULT_COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899'];

function newCondition(): ColorFilterCondition {
  return { id: crypto.randomUUID(), target: 'category', field: '', operator: 'equals', value: '' };
}

function newRule(): ColorFilterRule {
  return {
    id: crypto.randomUUID(),
    name: '',
    color: DEFAULT_COLORS[Math.floor(Math.random() * DEFAULT_COLORS.length)],
    enabled: true,
    conditions: [newCondition()],
    logic: 'AND',
  };
}

function loadRules(): ColorFilterRule[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveRules(rules: ColorFilterRule[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
}

// Hex → [r,g,b] 0-255
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function evalCondition(cond: ColorFilterCondition, metaObj: any, attrs: Record<string, any> | null): boolean {
  if (cond.target === 'category') {
    const objType = (metaObj.type || '').toLowerCase();
    const fieldLower = cond.field.toLowerCase();
    if (cond.operator === 'equals') return objType === fieldLower;
    if (cond.operator === 'contains') return objType.includes(fieldLower);
    return false;
  }

  // Property-based
  if (!attrs) return false;
  const fieldLower = cond.field.toLowerCase().replace(/[\s_-]/g, '');
  let rawValue: any = undefined;
  for (const [k, v] of Object.entries(attrs)) {
    if (k.toLowerCase().replace(/[\s_-]/g, '') === fieldLower) {
      rawValue = v;
      break;
    }
  }
  if (rawValue === undefined || rawValue === null) return false;

  const strVal = String(rawValue).toLowerCase();
  const condVal = cond.value.toLowerCase();

  switch (cond.operator) {
    case 'equals': return strVal === condVal;
    case 'contains': return strVal.includes(condVal);
    case 'gt': return parseFloat(strVal) > parseFloat(condVal);
    case 'lt': return parseFloat(strVal) < parseFloat(condVal);
    case 'gte': return parseFloat(strVal) >= parseFloat(condVal);
    case 'lte': return parseFloat(strVal) <= parseFloat(condVal);
    default: return false;
  }
}

// ─── Component ────────────────────────────────────────────────
interface ObjectColorFilterPanelProps {
  viewerRef: React.MutableRefObject<any>;
  buildingFmGuid?: string;
}

const ObjectColorFilterPanel: React.FC<ObjectColorFilterPanelProps> = ({ viewerRef, buildingFmGuid }) => {
  const { allData } = useContext(AppContext);
  const [rules, setRules] = useState<ColorFilterRule[]>(loadRules);
  const [open, setOpen] = useState(false);
  const [matchCount, setMatchCount] = useState<number | null>(null);

  // Persist on change
  useEffect(() => { saveRules(rules); }, [rules]);

  // Build attribute lookup from allData keyed by fmGuid (lowercased)
  const attrMap = React.useMemo(() => {
    const m = new Map<string, Record<string, any>>();
    allData.forEach((a: any) => {
      if (a.fmGuid) m.set(a.fmGuid.toLowerCase(), a.attributes || {});
    });
    return m;
  }, [allData]);

  const updateRule = useCallback((ruleId: string, patch: Partial<ColorFilterRule>) => {
    setRules(prev => prev.map(r => r.id === ruleId ? { ...r, ...patch } : r));
  }, []);

  const addRule = useCallback(() => {
    setRules(prev => [...prev, newRule()]);
  }, []);

  const removeRule = useCallback((ruleId: string) => {
    setRules(prev => prev.filter(r => r.id !== ruleId));
  }, []);

  const addCondition = useCallback((ruleId: string) => {
    setRules(prev => prev.map(r =>
      r.id === ruleId ? { ...r, conditions: [...r.conditions, newCondition()] } : r
    ));
  }, []);

  const updateCondition = useCallback((ruleId: string, condId: string, patch: Partial<ColorFilterCondition>) => {
    setRules(prev => prev.map(r =>
      r.id === ruleId
        ? { ...r, conditions: r.conditions.map(c => c.id === condId ? { ...c, ...patch } : c) }
        : r
    ));
  }, []);

  const removeCondition = useCallback((ruleId: string, condId: string) => {
    setRules(prev => prev.map(r =>
      r.id === ruleId ? { ...r, conditions: r.conditions.filter(c => c.id !== condId) } : r
    ));
  }, []);

  const applyRules = useCallback(() => {
    const xv = resolveXeokitViewer(viewerRef);
    if (!xv?.metaScene?.metaObjects || !xv?.scene) return;

    const enabledRules = rules.filter(r => r.enabled && r.conditions.length > 0);
    const metaObjects = xv.metaScene.metaObjects;
    const scene = xv.scene;
    let count = 0;
    let hasSpaceMatch = false;

    // Reset all first
    const allIds = scene.objectIds || [];
    allIds.forEach((id: string) => {
      const entity = scene.objects?.[id];
      if (entity) { entity.colorize = null; entity.opacity = 1.0; }
    });

    if (enabledRules.length === 0) {
      setMatchCount(0);
      (window as any).__colorFilterActive = false;
      (window as any).__spacesForceVisible = false;
      emit('FORCE_SHOW_SPACES', { show: false });
      return;
    }

    // First pass: check if any rule could match IfcSpace (to force spaces visible before colorizing)
    const couldMatchSpaces = enabledRules.some(r =>
      r.conditions.some(c =>
        c.target === 'category' && c.field.toLowerCase() === 'ifcspace'
      ) || r.conditions.some(c => c.target === 'property')
    );

    if (couldMatchSpaces) {
      // Force spaces visible so they can be colorized
      (window as any).__spacesForceVisible = true;
      emit('FORCE_SHOW_SPACES', { show: true });
      // Make all IfcSpace entities visible immediately
      Object.values(metaObjects).forEach((mo: any) => {
        if ((mo.type || '').toLowerCase() === 'ifcspace') {
          const entity = scene.objects?.[mo.id];
          if (entity) { entity.visible = true; entity.pickable = true; }
        }
      });
    }

    Object.values(metaObjects).forEach((metaObj: any) => {
      const fmGuid = (metaObj.originalSystemId || metaObj.id || '').toLowerCase();
      const attrs = attrMap.get(fmGuid) || null;

      for (const rule of enabledRules) {
        const results = rule.conditions.map(c => evalCondition(c, metaObj, attrs));
        const match = rule.logic === 'AND' ? results.every(Boolean) : results.some(Boolean);
        if (match) {
          const entity = scene.objects?.[metaObj.id];
          if (entity) {
            entity.colorize = rgbToFloat(hexToRgb(rule.color));
            entity.opacity = 0.85;
            const objType = (metaObj.type || '').toLowerCase();
            if (objType === 'ifcspace') {
              entity.visible = true;
              entity.pickable = true;
              hasSpaceMatch = true;
            }
            count++;
          }
          break; // first matching rule wins
        }
      }
    });

    // If we forced spaces visible but none matched, undo the force
    if (couldMatchSpaces && !hasSpaceMatch) {
      (window as any).__spacesForceVisible = false;
      emit('FORCE_SHOW_SPACES', { show: false });
    }

    // Set global flag so other systems (architect colors, space toggle) don't overwrite
    (window as any).__colorFilterActive = count > 0;
    setMatchCount(count);
  }, [rules, viewerRef, attrMap]);

  const resetColors = useCallback(() => {
    const xv = resolveXeokitViewer(viewerRef);
    if (!xv?.scene) return;
    const allIds = xv.scene.objectIds || [];
    allIds.forEach((id: string) => {
      const entity = xv.scene.objects?.[id];
      if (entity) { entity.colorize = null; entity.opacity = 1.0; }
    });
    (window as any).__colorFilterActive = false;
    (window as any).__spacesForceVisible = false;
    emit('FORCE_SHOW_SPACES', { show: false });
    setMatchCount(null);
  }, [viewerRef]);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button className="flex items-center justify-between w-full py-1.5 sm:py-2 hover:bg-muted/50 rounded-md transition-colors px-1">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className={cn("p-1 sm:p-1.5 rounded-md", rules.some(r => r.enabled) ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
              <Filter className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </div>
            <span className="text-xs sm:text-sm font-medium">Object color rules</span>
            {matchCount !== null && <span className="text-[10px] text-muted-foreground">({matchCount})</span>}
          </div>
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 pt-1 pl-2">
        {rules.map((rule) => (
          <div key={rule.id} className="border rounded-md p-2 space-y-2 bg-muted/30">
            {/* Rule header */}
            <div className="flex items-center gap-1.5">
              <input
                type="color"
                value={rule.color}
                onChange={e => updateRule(rule.id, { color: e.target.value })}
                className="w-5 h-5 rounded border-0 cursor-pointer p-0"
              />
              <Input
                value={rule.name}
                onChange={e => updateRule(rule.id, { name: e.target.value })}
                placeholder="Rule name"
                className="h-6 text-xs flex-1"
              />
              <Switch
                checked={rule.enabled}
                onCheckedChange={v => updateRule(rule.id, { enabled: v })}
                className="scale-75"
              />
              <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => removeRule(rule.id)}>
                <Trash2 className="h-3 w-3 text-destructive" />
              </Button>
            </div>

            {/* Logic toggle */}
            {rule.conditions.length > 1 && (
              <div className="flex items-center gap-1 text-[10px]">
                <span className="text-muted-foreground">Match</span>
                <button
                  className={cn("px-1.5 py-0.5 rounded text-[10px] font-medium", rule.logic === 'AND' ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground")}
                  onClick={() => updateRule(rule.id, { logic: 'AND' })}
                >ALL</button>
                <button
                  className={cn("px-1.5 py-0.5 rounded text-[10px] font-medium", rule.logic === 'OR' ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground")}
                  onClick={() => updateRule(rule.id, { logic: 'OR' })}
                >ANY</button>
              </div>
            )}

            {/* Conditions */}
            {rule.conditions.map((cond) => (
              <div key={cond.id} className="flex flex-wrap items-center gap-1">
                <Select value={cond.target} onValueChange={v => updateCondition(rule.id, cond.id, { target: v as any })}>
                  <SelectTrigger className="h-6 text-[10px] w-[72px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="category">Category</SelectItem>
                    <SelectItem value="property">Property</SelectItem>
                  </SelectContent>
                </Select>

                {cond.target === 'category' ? (
                  <Select value={cond.field} onValueChange={v => updateCondition(rule.id, cond.id, { field: v })}>
                    <SelectTrigger className="h-6 text-[10px] w-[100px]"><SelectValue placeholder="Type" /></SelectTrigger>
                    <SelectContent>
                      {IFC_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c.replace('Ifc', '')}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={cond.field}
                    onChange={e => updateCondition(rule.id, cond.id, { field: e.target.value })}
                    placeholder="Property"
                    className="h-6 text-[10px] w-[80px]"
                  />
                )}

                <Select value={cond.operator} onValueChange={v => updateCondition(rule.id, cond.id, { operator: v as any })}>
                  <SelectTrigger className="h-6 text-[10px] w-[44px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {OPERATORS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>

                {cond.target !== 'category' && (
                  <Input
                    value={cond.value}
                    onChange={e => updateCondition(rule.id, cond.id, { value: e.target.value })}
                    placeholder="Value"
                    className="h-6 text-[10px] w-[60px]"
                  />
                )}

                {rule.conditions.length > 1 && (
                  <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => removeCondition(rule.id, cond.id)}>
                    <Trash2 className="h-2.5 w-2.5 text-muted-foreground" />
                  </Button>
                )}
              </div>
            ))}

            <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1.5" onClick={() => addCondition(rule.id)}>
              <Plus className="h-2.5 w-2.5 mr-0.5" /> Condition
            </Button>
          </div>
        ))}

        {/* Actions */}
        <div className="flex items-center gap-1.5 pt-1">
          <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={addRule}>
            <Plus className="h-3 w-3 mr-0.5" /> Rule
          </Button>
          <Button size="sm" className="h-6 text-[10px] px-2" onClick={applyRules} disabled={rules.length === 0}>
            <Play className="h-3 w-3 mr-0.5" /> Apply
          </Button>
          <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={resetColors}>
            <RotateCcw className="h-3 w-3 mr-0.5" /> Reset
          </Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

export default ObjectColorFilterPanel;
