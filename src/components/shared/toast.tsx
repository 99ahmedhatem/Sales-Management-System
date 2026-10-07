import { useEffect, useState } from 'react';

/** Short message after an action: `toast(t('Saved'))` or `toast(error.message, false)`. Text is shown as given (translate before). */
const EVENT = 'app:toast';

export function toast(text: string, ok = true) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { text, ok } }));
}

/** Mounted once in AppShell. */
export function Toaster() {
  const [item, setItem] = useState<{ id: number; text: string; ok: boolean } | null>(null);
  useEffect(() => {
    let timer = 0;
    const onToast = (e: Event) => {
      const { text, ok } = (e as CustomEvent<{ text: string; ok: boolean }>).detail;
      window.clearTimeout(timer);
      setItem({ id: Date.now(), text, ok });
      timer = window.setTimeout(() => setItem(null), ok ? 4000 : 7000);
    };
    window.addEventListener(EVENT, onToast);
    return () => { window.removeEventListener(EVENT, onToast); window.clearTimeout(timer); };
  }, []);
  if (!item) return null;
  // Centered with flex (not translate) so the slide-in animation doesn't move it sideways
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[70] flex justify-center px-4">
      <div key={item.id} role={item.ok ? 'status' : 'alert'}
        className={`pointer-events-auto max-w-full rounded-lg border px-4 py-2.5 text-sm shadow-lg anim-banner ${
          item.ok ? 'border-[#64dc78]/30 bg-[#0f1a12] text-[#64dc78]' : 'border-[#ff6464]/30 bg-[#1a0f0f] text-[#ff8888]'}`}>
        {item.ok ? '✓ ' : '✕ '}{item.text}
      </div>
    </div>
  );
}
