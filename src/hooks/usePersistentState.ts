import { Dispatch, SetStateAction, useEffect, useState } from 'react';

/**
 * useState that is kept in sessionStorage, so filters / search are still there when you come back to a page
 * (until the browser tab is closed). Falls back to plain state if storage is blocked.
 */
export function usePersistentState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const storageKey = `ui:${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      return raw == null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // storage blocked (private mode / quota): the value just isn't remembered
    }
  }, [storageKey, value]);
  return [value, setValue];
}
