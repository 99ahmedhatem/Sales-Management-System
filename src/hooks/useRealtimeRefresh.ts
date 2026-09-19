import { useEffect, useRef } from 'react';
import { supabase } from '../supabaseClient';

export function useRealtimeRefresh(tables: string[], onChange: () => void, delayMs = 1500) {
  const latest = useRef(onChange);
  latest.current = onChange;
  const key = tables.join(',');

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const trigger = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => latest.current(), delayMs);
    };
    const channel = supabase.channel(`live-${key}-${Math.random().toString(36).slice(2)}`);
    tables.forEach(table => {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, trigger);
    });
    channel.subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [key, delayMs]);
}
