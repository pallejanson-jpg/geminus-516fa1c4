import React, { createContext, useState, useCallback, useContext, useEffect, ReactNode } from 'react';
import { fetchLocalAssets } from '@/services/geminus-plus-service';
import { isModelName, isAModelName } from '@/lib/building-utils';
import type { Facility, NavigatorNode } from '@/lib/types';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './TenantContext';

interface DataContextType {
  allData: Facility[];
  setAllData: (data: Facility[]) => void;
  isLoadingData: boolean;
  navigatorTreeData: NavigatorNode[];
  refreshInitialData: () => Promise<void>;
}

interface DataContextType {
  allData: Facility[];
  setAllData: (data: Facility[]) => void;
  isLoadingData: boolean;
  navigatorTreeData: NavigatorNode[];
  refreshInitialData: () => Promise<void>;
}

export const DataContext = createContext<DataContextType>({
  allData: [],
  setAllData: () => {},
  isLoadingData: false,
  navigatorTreeData: [],
  refreshInitialData: async () => {},
});

export const useData = () => useContext(DataContext);

export const DataProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { selectedTenantId } = useTenant();
  const [allData, setAllData] = useState<Facility[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [navigatorTreeData, setNavigatorTreeData] = useState<NavigatorNode[]>([]);

  const buildNavigatorTree = useCallback((items: Facility[]): NavigatorNode[] => {
    // STRICT HIERARCHY: Property (Complex) → Building → Building Storey → Space → Instance
    const complexItems = items.filter(item => item.category === 'Complex');
    const buildings = items.filter(item =>
      item.category === 'Building' || item.category === 'IfcBuilding'
    );
    const storeys = items.filter(item =>
      item.category === 'Building Storey' || item.category === 'IfcBuildingStorey'
    );
    const spaces = items.filter(item =>
      item.category === 'Space' || item.category === 'IfcSpace'
    );
    const instances = items.filter(item => item.category === 'Instance');

    const buildingMap = new Map<string, NavigatorNode>();

    if (buildings.length > 0) {
      buildings.forEach((building: any) => {
        buildingMap.set(building.fmGuid, { ...building, children: [] });
      });
    } else {
      const buildingInfo = new Map<string, { commonName?: string; name?: string; complexCommonName?: string }>();
      storeys.forEach((storey: any) => {
        const bguid = storey.buildingFmGuid;
        if (bguid && !buildingInfo.has(bguid)) {
          const attrs = storey.attributes || {};
          buildingInfo.set(bguid, {
            commonName: attrs.buildingCommonName || attrs.buildingDesignation || undefined,
            name: attrs.buildingDesignation || undefined,
            complexCommonName: storey.complexCommonName || attrs.complexCommonName || undefined,
          });
        }
      });
      buildingInfo.forEach((info, bguid) => {
        buildingMap.set(bguid, {
          fmGuid: bguid,
          category: 'Building',
          commonName: info.commonName || info.name || `Building ${bguid.substring(0, 8)}`,
          name: info.name,
          complexCommonName: info.complexCommonName,
          children: [],
        });
      });
    }

    const storeyMap = new Map<string, NavigatorNode>();
    const excludedModelStoreyGuids = new Set<string>();
    const aModelStoreyGuids = new Set<string>();
    const namelessCounterByBuilding = new Map<string, number>();

    storeys.forEach((storey: any) => {
      if (!buildingMap.has(storey.buildingFmGuid)) return;
      const attrs = storey.attributes || {};
      const parentName = attrs.parentCommonName || '';
      if (isAModelName(parentName)) {
        aModelStoreyGuids.add(storey.fmGuid);
      }
      let displayName = storey.commonName || storey.name;
      if (!displayName) {
        displayName = attrs.levelCommonName || attrs.levelDesignation || attrs.designation;
      }
      if (!displayName) {
        displayName = attrs.source_storey_name || attrs.sourceStoreyName;
      }
      if (!displayName && isModelName(parentName)) {
        excludedModelStoreyGuids.add(storey.fmGuid);
        return;
      }
      if (!displayName) {
        const count = (namelessCounterByBuilding.get(storey.buildingFmGuid) || 0) + 1;
        namelessCounterByBuilding.set(storey.buildingFmGuid, count);
        displayName = `Floor ${count}`;
      }
      storeyMap.set(storey.fmGuid, { ...storey, commonName: displayName, children: [] });
    });

    const storeyNameLookup = new Map<string, string>();
    const storeyNumberLookup = new Map<string, string[]>();
    storeyMap.forEach((storey: any) => {
      const storeyName = (storey.commonName || storey.name || '').toLowerCase().trim();
      if (storeyName && storey.buildingFmGuid) {
        storeyNameLookup.set(`${storey.buildingFmGuid}|${storeyName}`, storey.fmGuid);
      }
      const numberMatch = (storey.commonName || storey.name || '').match(/(\d+)/);
      if (numberMatch && storey.buildingFmGuid) {
        const key = storey.buildingFmGuid;
        if (!storeyNumberLookup.has(key)) storeyNumberLookup.set(key, []);
        storeyNumberLookup.get(key)!.push(`${numberMatch[1]}|${storey.fmGuid}`);
      }
    });

    storeyMap.forEach((storey) => {
      const parentBuilding = buildingMap.get((storey as any).buildingFmGuid);
      if (parentBuilding) parentBuilding.children!.push(storey);
    });

    const orphanSpacesByBuilding = new Map<string, any[]>();
    const spaceMap = new Map<string, NavigatorNode>();
    const hasAModelStoreys = aModelStoreyGuids.size > 0;

    spaces.forEach((space: any) => {
      if (hasAModelStoreys && space.levelFmGuid) {
        if (!aModelStoreyGuids.has(space.levelFmGuid)) return;
      }
      let parentStorey = storeyMap.get(space.levelFmGuid);

      if (!parentStorey && excludedModelStoreyGuids.has(space.levelFmGuid) && space.buildingFmGuid) {
        const designation = space.commonName || space.name || '';
        const prefixMatch = designation.match(/^(\d{1,3})\./);
        if (prefixMatch) {
          const prefix = prefixMatch[1];
          for (const [, storey] of storeyMap) {
            if ((storey as any).buildingFmGuid !== space.buildingFmGuid) continue;
            const sn = (storey.commonName || '').trim();
            if (sn === prefix || sn.startsWith(prefix + ' ') || sn.startsWith(prefix + '-') || sn.startsWith(prefix + '_')) {
              parentStorey = storey;
              break;
            }
          }
        }
      }

      if (!parentStorey && space.buildingFmGuid) {
        const attrs = space.attributes || {};
        for (const candidate of [attrs.levelCommonName, attrs.levelDesignation, attrs.levelName]) {
          if (!candidate) continue;
          const matchedGuid = storeyNameLookup.get(`${space.buildingFmGuid}|${String(candidate).toLowerCase().trim()}`);
          if (matchedGuid) { parentStorey = storeyMap.get(matchedGuid); break; }
        }
      }

      if (!parentStorey && space.buildingFmGuid) {
        const designation = space.name || space.commonName || '';
        const prefixMatch = designation.match(/^(\d{1,3})\./);
        if (prefixMatch) {
          const floorNum = prefixMatch[1];
          for (const entry of (storeyNumberLookup.get(space.buildingFmGuid) || [])) {
            const [num, guid] = entry.split('|');
            if (num === floorNum) { parentStorey = storeyMap.get(guid); break; }
          }
        }
        if (!parentStorey) {
          const floorNumMatch = designation.match(/^(\d)/);
          if (floorNumMatch) {
            for (const entry of (storeyNumberLookup.get(space.buildingFmGuid) || [])) {
              const [num, guid] = entry.split('|');
              if (num === floorNumMatch[1]) { parentStorey = storeyMap.get(guid); break; }
            }
          }
        }
      }

      if (!parentStorey && space.buildingFmGuid) {
        const attrs = space.attributes || {};
        const parentName = (attrs.parentCommonName || '').toLowerCase().trim();
        if (parentName && !isModelName(attrs.parentCommonName)) {
          const matchedGuid = storeyNameLookup.get(`${space.buildingFmGuid}|${parentName}`);
          if (matchedGuid) parentStorey = storeyMap.get(matchedGuid);
        }
      }

      const spaceNode: NavigatorNode = { ...space, children: [] };
      spaceMap.set(space.fmGuid, spaceNode);

      if (parentStorey) {
        parentStorey.children!.push(spaceNode);
      } else if (space.buildingFmGuid && buildingMap.has(space.buildingFmGuid)) {
        if (!orphanSpacesByBuilding.has(space.buildingFmGuid)) orphanSpacesByBuilding.set(space.buildingFmGuid, []);
        orphanSpacesByBuilding.get(space.buildingFmGuid)!.push(spaceNode);
      }
    });

    orphanSpacesByBuilding.forEach((orphanSpaces, buildingGuid) => {
      const building = buildingMap.get(buildingGuid);
      if (building && orphanSpaces.length > 0) {
        const buildingStoreys = building.children?.filter(
          (c: NavigatorNode) => c.category === 'Building Storey' && !c.isSynthetic
        ) || [];
        if (buildingStoreys.length === 1) {
          orphanSpaces.forEach((spaceNode: NavigatorNode) => buildingStoreys[0].children!.push(spaceNode));
        } else {
          building.children!.push({
            fmGuid: `synthetic-unknown-${buildingGuid}`,
            category: 'Building Storey',
            commonName: 'Unknown Floor',
            name: 'Unknown Floor',
            isSynthetic: true,
            buildingFmGuid: buildingGuid,
            children: orphanSpaces,
          });
        }
      }
    });

    instances.forEach((instance: any) => {
      const parentSpace = spaceMap.get(instance.inRoomFmGuid);
      if (parentSpace) {
        parentSpace.children!.push({ ...instance, children: [] });
      }
    });

    const buildingNodes = Array.from(buildingMap.values());
    const sortNode = (node: NavigatorNode) => {
      if (!node.children?.length) return;
      node.children.sort((a, b) => {
        if ((a as any).isSynthetic && !(b as any).isSynthetic) return 1;
        if (!(a as any).isSynthetic && (b as any).isSynthetic) return -1;
        if (a.category === 'Instance' && b.category !== 'Instance') return 1;
        if (a.category !== 'Instance' && b.category === 'Instance') return -1;
        return (a.commonName || a.name || '').localeCompare(b.commonName || b.name || '', undefined, { numeric: true });
      });
      node.children.forEach(sortNode);
    };
    buildingNodes.forEach(sortNode);

    // Build Property nodes — Complex assets from Geminus Plus are authoritative.
    // Buildings reference their property via attributes.complexFmGuid.
    const propertyMap = new Map<string, NavigatorNode>();
    const buildingsWithoutProperty: NavigatorNode[] = [];

    // Seed propertyMap from synced Complex assets (includes complexes with no buildings yet)
    complexItems.forEach((c: any) => {
      const attrs = c.attributes || {};
      propertyMap.set(c.fmGuid, {
        fmGuid: c.fmGuid,
        category: 'Property',
        name: c.commonName || c.name || c.fmGuid,
        commonName: c.commonName || c.name || c.fmGuid,
        complexFmGuid: c.fmGuid,
        complexDesignation: attrs.complexDesignation || attrs.designation,
        children: [],
      });
    });

    // Attach buildings to their property; create synthetic Property node if not yet synced
    buildingNodes.forEach((buildingNode) => {
      const attrs = (buildingNode as any).attributes || {};
      const complexFmGuid = attrs.complexFmGuid || (buildingNode as any).complexFmGuid;
      const complexCommonName = (buildingNode as any).complexCommonName || attrs.complexCommonName;
      const complexDesignation = attrs.complexDesignation;

      if (complexFmGuid) {
        if (!propertyMap.has(complexFmGuid)) {
          propertyMap.set(complexFmGuid, {
            fmGuid: complexFmGuid,
            category: 'Property',
            name: complexCommonName || complexFmGuid,
            commonName: complexCommonName || complexFmGuid,
            complexFmGuid,
            complexDesignation,
            children: [],
          });
        }
        propertyMap.get(complexFmGuid)!.children!.push(buildingNode);
      } else {
        buildingsWithoutProperty.push(buildingNode);
      }
    });

    const sortedProperties = Array.from(propertyMap.values()).sort(
      (a, b) => (a.commonName || a.name || '').localeCompare(b.commonName || b.name || '')
    );
    sortedProperties.forEach((prop) => {
      prop.children!.sort((a, b) =>
        (a.commonName || a.name || '').localeCompare(b.commonName || b.name || '')
      );
    });
    buildingsWithoutProperty.sort((a, b) =>
      (a.commonName || a.name || '').localeCompare(b.commonName || b.name || '')
    );

    return [...sortedProperties, ...buildingsWithoutProperty];
  }, []);

  const refreshInitialData = useCallback(async () => {
    setIsLoadingData(true);
    try {
      const [allObjects, { data: buildingSettingsRows }] = await Promise.all([
        fetchLocalAssets([
          'Complex',
          'Building', 'IfcBuilding',
          'Building Storey', 'IfcBuildingStorey',
          'Space', 'IfcSpace',
        ]),
        supabase.from('building_settings').select('fm_guid, display_name, tenant_id'),
      ]);

      // Scope everything to the selected tenant's buildings. Assets aren't
      // tenant-tagged themselves, so we derive the allowed building/complex
      // fm_guids from building_settings.tenant_id and filter the asset tree
      // down to just those (and their storeys/spaces/instances/complex).
      const tenantSettingsRows = selectedTenantId
        ? (buildingSettingsRows || []).filter((row: any) => row.tenant_id === selectedTenantId)
        : (buildingSettingsRows || []);

      let scopedObjects = allObjects;
      if (selectedTenantId) {
        const tenantBuildingFmGuids = new Set(tenantSettingsRows.map((row: any) => row.fm_guid));
        const allowedBuildingGuids = new Set(
          allObjects
            .filter(o => (o.category === 'Building' || o.category === 'IfcBuilding') && tenantBuildingFmGuids.has(o.fmGuid))
            .map(o => o.fmGuid)
        );
        const allowedComplexGuids = new Set(
          allObjects
            .filter(o => (o.category === 'Building' || o.category === 'IfcBuilding') && allowedBuildingGuids.has(o.fmGuid))
            .map((o: any) => o.attributes?.complexFmGuid || o.complexFmGuid)
            .filter(Boolean)
        );
        scopedObjects = allObjects.filter((o: any) => {
          if (o.category === 'Complex') return allowedComplexGuids.has(o.fmGuid);
          if (o.category === 'Building' || o.category === 'IfcBuilding') return allowedBuildingGuids.has(o.fmGuid);
          if (o.buildingFmGuid) return allowedBuildingGuids.has(o.buildingFmGuid);
          return true;
        });
      }
      setAllData(scopedObjects);

      // Add synthetic Building nodes for fm_guids in building_settings with no asset row
      const knownBuildingGuids = new Set(
        scopedObjects.filter(o => o.category === 'Building' || o.category === 'IfcBuilding').map(o => o.fmGuid)
      );
      const syntheticBuildings = tenantSettingsRows
        .filter((row: any) => !knownBuildingGuids.has(row.fm_guid))
        .map((row: any) => {
          // Priority: display_name from building_settings > storey attributes > GUID
          const displayName = row.display_name || null;
          const childStorey = !displayName ? scopedObjects.find(
            (o: any) => o.buildingFmGuid === row.fm_guid &&
              (o.category === 'Building Storey' || o.category === 'IfcBuildingStorey')
          ) : null;
          const attrs = childStorey?.attributes || {};
          const inferredName = displayName || attrs.buildingCommonName || attrs.buildingDesignation || null;
          return {
            fmGuid: row.fm_guid,
            category: 'Building' as const,
            name: inferredName || row.fm_guid,
            commonName: inferredName || row.fm_guid,
            buildingFmGuid: row.fm_guid,
          };
        });

      setNavigatorTreeData(buildNavigatorTree([...scopedObjects, ...syntheticBuildings]));
    } catch (error) {
      console.error('Failed to load assets:', error);
    } finally {
      setIsLoadingData(false);
    }
  }, [buildNavigatorTree, selectedTenantId]);

  useEffect(() => {
    refreshInitialData().catch((e) => {
      console.error('Failed to prefetch Geminus Plus data:', e);
    });
    const handler = () => {
      refreshInitialData().catch((e) => {
        console.error('Failed to refresh data after building-data-changed:', e);
      });
    };
    window.addEventListener('building-data-changed', handler);
    window.addEventListener('building-settings-changed', handler);
    return () => {
      window.removeEventListener('building-data-changed', handler);
      window.removeEventListener('building-settings-changed', handler);
    };
  }, [refreshInitialData]);

  return (
    <DataContext.Provider value={{ allData, setAllData, isLoadingData, navigatorTreeData, refreshInitialData }}>
      {children}
    </DataContext.Provider>
  );
};
