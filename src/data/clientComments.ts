import { supabase } from '../supabaseClient';
import { ClientComment, Role } from './mockData';
import { recordActivity } from './activityLog';

// The live client_comments table may not have every column from supabase-setup.sql
// (e.g. no author_name), so reads accept the alternative names that 041 supports.
const pick = (row: Record<string, unknown>, keys: string[]) => {
  for (const k of keys) if (row[k] != null) return String(row[k]);
  return '';
};

export async function loadClientComments(leadId: string): Promise<{ data: ClientComment[]; error?: string }> {
  const { data, error } = await supabase
    .from('client_comments')
    .select('*')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: true })
    .range(0, 499);

  if (error) return { data: [], error: error.message };
  return {
    data: (data ?? []).map(row => ({
      id: row.id,
      leadId: row.lead_id,
      authorId: pick(row, ['author_id', 'user_id', 'created_by']),
      authorName: pick(row, ['author_name', 'user_name', 'created_by_name']) || '—',
      text: pick(row, ['text', 'comment', 'content', 'body', 'message', 'note']),
      createdAt: row.created_at,
    })),
  };
}

/** Adds a comment through add_lead_comment (041 adapts to the table's real columns) and logs the activity. */
export async function addClientComment(comment: Omit<ClientComment, 'id' | 'createdAt'> & { actorRole?: Role }): Promise<{ data?: ClientComment; error?: string }> {
  const { data: id, error } = await supabase.rpc('add_lead_comment', { p_lead_id: comment.leadId, p_text: comment.text });
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
      id: String(id),
      leadId: comment.leadId,
      authorId: comment.authorId,
      authorName: comment.authorName,
      text: comment.text.trim(),
      createdAt: new Date().toISOString(),
    },
  };
}
