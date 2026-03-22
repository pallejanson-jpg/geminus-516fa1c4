import { useState, useEffect } from 'react';
import { SIDEBAR_ORDER_STORAGE_KEY, SIDEBAR_SETTINGS_CHANGED_EVENT } from '@/lib/constants';
import type { SidebarItem } from '@/lib/constants';
import { getSidebarOrder } from '@/components/settings/AppMenuSettings';

/**
 * Shared hook for sidebar order state + sync.
 * Used by both LeftSidebar and MobileNav.
 */
export function useSidebarOrder(): SidebarItem[] {
  const [sidebarOrder, setSidebarOrder] = useState<SidebarItem[]>(getSidebarOrder);

  useEffect(() => {
    const handleSettingsChange = (e: Event) => {
      const customEvent = e as CustomEvent<SidebarItem[]>;
      if (customEvent.detail) setSidebarOrder(customEvent.detail);
    };
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === SIDEBAR_ORDER_STORAGE_KEY) setSidebarOrder(getSidebarOrder());
    };
    window.addEventListener(SIDEBAR_SETTINGS_CHANGED_EVENT, handleSettingsChange);
    window.addEventListener('storage', handleStorageChange);
    return () => {
      window.removeEventListener(SIDEBAR_SETTINGS_CHANGED_EVENT, handleSettingsChange);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  return sidebarOrder;
}
