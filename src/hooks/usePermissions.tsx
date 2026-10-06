import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';

/** Keys from permission_catalog (037). */
export type PermissionKey =
  | 'leads.view_all' | 'leads.edit' | 'leads.export' | 'leads.distribute' | 'leads.delete'
  | 'deals.create' | 'deals.approve' | 'payments.confirm'
  | 'packages.manage' | 'users.manage' | 'salaries.view' | 'reports.view' | 'audit.view';

interface PermissionsValue {
  /** Admin is always allowed. Others: role defaults + per-user overrides (has_permission). */
  can: (key: PermissionKey) => boolean;
  loading: boolean;
  error: string;
  reload: () => Promise<void>;
}

const PermissionsContext = createContext<PermissionsValue>({ can: () => false, loading: true, error: '', reload: async () => {} });

/**
 * Loads get_my_permissions() once per session (cache) and shares it with every screen.
 * UI only: the database stays the security layer (RLS is unchanged).
 */
export function PermissionsProvider({ role, userId, children }: { role: string; userId: string; children: ReactNode }) {
  const [keys, setKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(role !== 'admin');
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    if (role === 'admin') { setLoading(false); return; }
    setLoading(true);
    const { data, error: rpcError } = await supabase.rpc('get_my_permissions');
    if (rpcError) {
      setError(rpcError.message);
      console.warn('get_my_permissions failed:', rpcError.message);
    } else {
      setError('');
      setKeys(new Set(((data ?? []) as { permission_key: string }[]).map(r => r.permission_key)));
    }
    setLoading(false);
  }, [role]);

  useEffect(() => { void reload(); }, [reload, userId]);

  const value = useMemo<PermissionsValue>(() => ({
    can: key => role === 'admin' || keys.has(key),
    loading,
    error,
    reload,
  }), [role, keys, loading, error, reload]);

  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
}

export const usePermissions = () => useContext(PermissionsContext);
