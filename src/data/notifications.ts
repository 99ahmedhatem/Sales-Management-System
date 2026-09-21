import { supabase } from '../supabaseClient';

export async function createNotification(userId: string, title: string, message: string) {
  return supabase.from('notifications').insert({
    user_id: userId,
    type: 'assignment',
    title,
    message,
  });
}