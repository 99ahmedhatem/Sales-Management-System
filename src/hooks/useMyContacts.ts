import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { toast } from '../components/shared/toast';

/**
 * "تواصلت" marks (070) of the signed-in user for the clients on screen.
 * contacted[leadId] = when I marked it. toggle() marks / unmarks right away and saves in the background.
 */
export function useMyContacts(userId: string | undefined, leadIds: string[]) {
  const [contacted, setContacted] = useState<Record<string, string>>({});
  const key = leadIds.join(',');

  useEffect(() => {
    if (!userId || !leadIds.length) { setContacted({}); return; }
    let active = true;
    void supabase
      .from('lead_contacts')
      .select('lead_id, contacted_at')
      .eq('user_id', userId)
      .in('lead_id', leadIds)
      .then(({ data, error }) => {
        if (!active || error) return; // 070 not run yet: no marks shown
        setContacted(Object.fromEntries((data ?? []).map(r => [r.lead_id as string, r.contacted_at as string])));
      });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, key]);

  /** Returns the new state (true = contacted), or null when saving failed. */
  const toggle = useCallback(async (leadId: string): Promise<boolean | null> => {
    const on = !contacted[leadId];
    setContacted(prev => {
      const next = { ...prev };
      if (on) next[leadId] = new Date().toISOString(); else delete next[leadId];
      return next;
    });
    const { error } = await supabase.rpc('set_lead_contact', { p_lead: leadId, p_on: on });
    if (error) {
      setContacted(prev => {
        const next = { ...prev };
        if (on) delete next[leadId]; else next[leadId] = contacted[leadId];
        return next;
      });
      toast(error.message, false);
      return null;
    }
    return on;
  }, [contacted]);

  return { contacted, toggle };
}

/** All client ids I marked (for filters / exports over more than one page). */
export async function loadAllMyContactIds(userId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('lead_contacts').select('lead_id').eq('user_id', userId).range(from, from + 999);
    if (error) break;
    for (const r of data ?? []) ids.add(r.lead_id as string);
    if (!data || data.length < 1000) break;
  }
  return ids;
}
