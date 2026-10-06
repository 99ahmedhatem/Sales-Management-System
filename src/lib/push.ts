import { supabase } from '../supabaseClient';

/** Public VAPID key (safe to ship). When it is missing, push is hidden in the UI. */
const VAPID_PUBLIC_KEY = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined)?.trim() || '';
const SW_URL = `${import.meta.env.BASE_URL}sw.js`;

export function pushConfigured(): boolean {
  return Boolean(VAPID_PUBLIC_KEY);
}

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** iPhone/iPad only allow web push from an app added to the Home Screen. */
export function needsHomeScreenInstall(): boolean {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

export async function registerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register(SW_URL);
  } catch (e) {
    console.warn('Service worker registration failed:', (e as Error).message);
  }
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Is this browser/device currently subscribed? */
export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration(SW_URL);
  return reg ? reg.pushManager.getSubscription() : null;
}

/** Asks for permission, subscribes this device and saves it. Returns an error message, or '' on success. */
export async function enablePush(): Promise<string> {
  if (!pushConfigured()) return 'Push notifications are not configured.';
  if (!pushSupported()) return 'This browser does not support push notifications.';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'Notifications permission was not granted.';
  await registerServiceWorker();
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) });
  }
  const keys = sub.toJSON().keys ?? {};
  const { error } = await supabase.rpc('save_push_subscription', {
    p_endpoint: sub.endpoint,
    p_p256dh: keys.p256dh ?? '',
    p_auth: keys.auth ?? '',
    p_user_agent: navigator.userAgent,
  });
  return error ? error.message : '';
}

/** Unsubscribes this device and removes it from the server. Returns an error message, or '' on success. */
export async function disablePush(): Promise<string> {
  const sub = await currentPushSubscription();
  if (!sub) return '';
  const { error } = await supabase.rpc('remove_push_subscription', { p_endpoint: sub.endpoint });
  if (error) return error.message;
  await sub.unsubscribe();
  return '';
}
