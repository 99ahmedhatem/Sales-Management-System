/** Lets any screen switch the AppShell page (e.g. "open this deal" from the client card). */
const EVENT = 'app:navigate';
let pendingDealId: string | null = null;

export function openDealInContracts(dealId: string) {
  pendingDealId = dealId;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { page: 'contracts' } }));
  window.dispatchEvent(new CustomEvent('app:open-deal', { detail: { dealId } }));
}

/** ContractsModule calls this on mount to open a deal requested from another screen. */
export function takePendingDealId(): string | null {
  const id = pendingDealId;
  pendingDealId = null;
  return id;
}

export function onNavigate(handler: (page: string) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<{ page: string }>).detail.page);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}

export function onOpenDeal(handler: (dealId: string) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<{ dealId: string }>).detail.dealId);
  window.addEventListener('app:open-deal', listener);
  return () => window.removeEventListener('app:open-deal', listener);
}
