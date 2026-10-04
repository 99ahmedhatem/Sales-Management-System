import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase environment variables (VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY). Check Vercel → Environment Variables or your .env file.');
}

/** أي طلب بياخد أكتر من 25 ثانية بيتقطع برسالة واضحة بدل ما الشاشة تفضل "Loading..." للأبد. */
const REQUEST_TIMEOUT_MS = 25_000;

/** File uploads (Storage) and Edge Functions (the AI contract review) can legitimately take longer. */
const NO_TIMEOUT_PATHS = ['/storage/v1/', '/functions/v1/'];

const fetchWithTimeout: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (NO_TIMEOUT_PATHS.some(path => url.includes(path))) return fetch(input, init);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  // لو الطلب الأصلي له signal خاص بيه، نحترمه
  init?.signal?.addEventListener('abort', () => controller.abort());
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (e) {
    if (controller.signal.aborted && !init?.signal?.aborted) {
      throw new Error('The server took too long to respond. Please try again.');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
};

export const supabase = createClient(supabaseUrl, supabaseKey, {
  global: { fetch: fetchWithTimeout },
});
