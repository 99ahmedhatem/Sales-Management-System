import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { useI18n } from '../../i18n/I18nProvider';
import { Select } from '../ui';

interface ScopeUser { id: string; full_name: string; role: string; manager_id: string | null }

/**
 * "Whose work" filter for lists.
 *  · manager: all (RLS = team + me) / my team / me.
 *  · admin: by employee and/or by manager (the manager + his team).
 * `userIds` = null means no filter; otherwise keep rows where any participant is one of these users.
 * Other roles get no filter (RLS already limits them to their own rows).
 */
export function useScopeFilter(role: string, userId: string) {
  const { t } = useI18n();
  const [users, setUsers] = useState<ScopeUser[]>([]);
  const [error, setError] = useState('');
  const [managerScope, setManagerScope] = useState<'' | 'team' | 'me'>('');
  const [employeeId, setEmployeeId] = useState('');
  const [managerId, setManagerId] = useState('');
  const enabled = role === 'admin' || role === 'manager';

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    supabase
      .from('users')
      .select('id, full_name, role, manager_id')
      .order('full_name')
      .range(0, 999)
      .then(({ data, error: usersError }) => {
        if (!active) return;
        if (usersError) setError(usersError.message);
        else setUsers((data ?? []) as ScopeUser[]);
      });
    return () => { active = false; };
  }, [enabled]);

  const userIds = useMemo<string[] | null>(() => {
    if (role === 'manager') {
      if (managerScope === 'me') return [userId];
      if (managerScope === 'team') {
        const team = users.filter(u => u.manager_id === userId).map(u => u.id);
        return team.length ? team : ['00000000-0000-0000-0000-000000000000'];
      }
      return null;
    }
    if (role !== 'admin') return null;
    if (employeeId) return [employeeId];
    if (managerId) return [managerId, ...users.filter(u => u.manager_id === managerId).map(u => u.id)];
    return null;
  }, [role, userId, users, managerScope, employeeId, managerId]);

  // Stable key so effects re-run only when the selection really changes
  const scopeKey = userIds ? userIds.join(',') : '';

  const element = !enabled ? null : (
    <div className="flex flex-wrap items-center gap-2">
      {role === 'manager' ? (
        <Select
          value={managerScope}
          onChange={value => setManagerScope(value as '' | 'team' | 'me')}
          options={[
            { value: '', label: t('All (team + me)') },
            { value: 'team', label: t('My team') },
            { value: 'me', label: t('Me') },
          ]}
          className="w-44"
        />
      ) : (
        <>
          <Select
            value={employeeId}
            onChange={value => { setEmployeeId(value); if (value) setManagerId(''); }}
            options={[
              { value: '', label: t('All employees') },
              ...users.map(u => ({ value: u.id, label: u.full_name })),
            ]}
            className="w-48"
          />
          <Select
            value={managerId}
            onChange={value => { setManagerId(value); if (value) setEmployeeId(''); }}
            options={[
              { value: '', label: t('All managers') },
              ...users.filter(u => u.role === 'manager').map(u => ({ value: u.id, label: u.full_name })),
            ]}
            className="w-48"
          />
        </>
      )}
      {error && <span role="alert" className="text-xs text-[#ff8888]">{error}</span>}
    </div>
  );

  return { userIds, scopeKey, element };
}
