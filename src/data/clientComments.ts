import { supabase } from '../supabaseClient';
import { ClientComment, Role } from './mockData';
import { recordActivity } from './activityLog';

export async function loadClientComments(leadId: string): Promise<{ data: ClientComment[]; error?: string }> {
  const { data, error } = await supabase
    .from('client_comments')
    .select('*')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: true });

  if (error) return { data: [], error: error.message };
  return {
    data: (data ?? []).map(row => ({
      id: row.id,
      leadId: row.lead_id,
      authorId: row.author_id,
      authorName: row.author_name,
      text: row.text,
      createdAt: row.created_at,
    })),
  };
}

export async function addClientComment(comment: Omit<ClientComment, 'id' | 'createdAt'> & { actorRole?: Role }): Promise<{ data?: ClientComment; error?: string }> {
  const { data, error } = await supabase
    .from('client_comments')
    .insert({
      lead_id: comment.leadId,
      author_id: comment.authorId,
      author_name: comment.authorName,
      text: comment.text,
    })
    .select('*')
    .single();

  if (error) return { error: error.message };
  await recordActivity({
    leadId: comment.leadId,
    actorId: comment.authorId,
    actorName: comment.authorName,
    actorRole: comment.actorRole || (comment.authorName === 'Admin' ? 'admin' : 'telesales'),
    activityType: 'comment',
    notes: comment.text,
  });
  return {
    data: {
      id: data.id,
      leadId: data.lead_id,
      authorId: data.author_id,
      authorName: data.author_name,
      text: data.text,
      createdAt: data.created_at,
    },
  };
}
