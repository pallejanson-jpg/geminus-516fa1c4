import React, { createContext, useState, useCallback, useContext, useEffect, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface Tenant {
  id: string;
  name: string;
}

interface TenantContextType {
  tenants: Tenant[];
  selectedTenantId: string | null;
  setSelectedTenantId: (tenantId: string | null) => void;
  isLoadingTenants: boolean;
  refreshTenants: () => Promise<void>;
}

const STORAGE_KEY = 'geminus-selected-tenant';

export const TenantContext = createContext<TenantContextType>({
  tenants: [],
  selectedTenantId: null,
  setSelectedTenantId: () => {},
  isLoadingTenants: false,
  refreshTenants: async () => {},
});

export const useTenant = () => useContext(TenantContext);

export const TenantProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenantId, setSelectedTenantIdState] = useState<string | null>(null);
  const [isLoadingTenants, setIsLoadingTenants] = useState(false);

  const setSelectedTenantId = useCallback((tenantId: string | null) => {
    setSelectedTenantIdState(tenantId);
    if (tenantId) {
      localStorage.setItem(STORAGE_KEY, tenantId);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const refreshTenants = useCallback(async () => {
    setIsLoadingTenants(true);
    try {
      const { data, error } = await supabase.from('tenants').select('id, name').order('name');
      if (error) {
        console.error('Failed to load tenants:', error);
        return;
      }
      const rows = data || [];
      setTenants(rows);

      setSelectedTenantIdState((current) => {
        if (current && rows.some(t => t.id === current)) return current;
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored && rows.some(t => t.id === stored)) return stored;
        return rows[0]?.id ?? null;
      });
    } finally {
      setIsLoadingTenants(false);
    }
  }, []);

  useEffect(() => {
    refreshTenants();

    // Re-fetch on login/logout so the tenant list reflects the current user's access.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      refreshTenants();
    });
    return () => subscription.unsubscribe();
  }, [refreshTenants]);

  return (
    <TenantContext.Provider
      value={{ tenants, selectedTenantId, setSelectedTenantId, isLoadingTenants, refreshTenants }}
    >
      {children}
    </TenantContext.Provider>
  );
};
