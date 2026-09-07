import React, { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';

/**
 * BuildingPicker — a collapsible Property (Complex) > Building tree, replacing
 * the flat <select><optgroup> picker. Each property starts collapsed and
 * expands via its own chevron/+, plus a global expand-all/collapse-all pair,
 * matching Geminus Plus's own tree view (see the archive screenshot this was
 * modeled after) more closely than a native select could.
 */

export interface BuildingOption {
  fmguid: string;
  name: string | null;
  complexFmguid: string | null;
  complexName: string | null;
}

interface BuildingGroup {
  complexFmguid: string | null;
  complexName: string | null;
  buildings: BuildingOption[];
}

export const NEW_BUILDING = '__new__';

function groupByComplex(buildings: BuildingOption[]): BuildingGroup[] {
  const groups: BuildingGroup[] = [];
  for (const b of buildings) {
    const last = groups[groups.length - 1];
    if (last && last.complexFmguid === b.complexFmguid) {
      last.buildings.push(b);
    } else {
      groups.push({ complexFmguid: b.complexFmguid, complexName: b.complexName, buildings: [b] });
    }
  }
  return groups;
}

interface BuildingPickerProps {
  buildings: BuildingOption[];
  loading: boolean;
  value: string; // fmguid, or NEW_BUILDING
  onChange: (fmguid: string) => void;
}

export default function BuildingPicker({ buildings, loading, value, onChange }: BuildingPickerProps) {
  const groups = groupByComplex(buildings);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(key: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function expandAll() {
    setExpanded(new Set(groups.map(g => g.complexFmguid ?? '__none__')));
  }
  function collapseAll() {
    setExpanded(new Set());
  }

  const selectedBuilding = buildings.find(b => b.fmguid === value);

  return (
    <div className="building-picker">
      <div className="building-picker-toolbar">
        <span className="building-picker-current">
          {value === NEW_BUILDING || !value
            ? '— New building (not in Geminus Plus) —'
            : selectedBuilding?.name ?? value}
        </span>
        <div className="row-actions" style={{ marginTop: 0 }}>
          <button type="button" className="secondary" onClick={expandAll} disabled={loading}>Expand all</button>
          <button type="button" className="secondary" onClick={collapseAll} disabled={loading}>Collapse all</button>
        </div>
      </div>

      <div className="building-picker-tree">
        <button
          type="button"
          className={`building-picker-row building-picker-new ${value === NEW_BUILDING || !value ? 'selected' : ''}`}
          onClick={() => onChange(NEW_BUILDING)}
        >
          — New building (not in Geminus Plus) —
        </button>

        {loading && <p className="muted" style={{ padding: '0.5rem 0.75rem' }}>Loading buildings…</p>}

        {groups.map(group => {
          const key = group.complexFmguid ?? '__none__';
          const isOpen = expanded.has(key);
          return (
            <div key={key} className="building-picker-group">
              <button type="button" className="building-picker-group-header" onClick={() => toggle(key)}>
                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span>{group.complexName ?? '(no property)'}</span>
                <span className="building-picker-count">{group.buildings.length}</span>
              </button>
              {isOpen && (
                <div className="building-picker-group-body">
                  {group.buildings.map(b => (
                    <button
                      key={b.fmguid}
                      type="button"
                      className={`building-picker-row ${value === b.fmguid ? 'selected' : ''}`}
                      onClick={() => onChange(b.fmguid)}
                    >
                      {b.name ?? b.fmguid}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
