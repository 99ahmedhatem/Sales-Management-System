import { supabase } from '../supabaseClient';
import { ActivityLog, ActivityType, Role } from './mockData';

interface ActivityInput {
  leadId: string;
  actorId: string;
  actorName: string;
  actorRole: Role;
  activityType: ActivityType;
  outcome?: string;
  notes?: string;
}

export async function recordActivity(activity: ActivityInput): Promise<string | undefined> {
  const { data, error } = await supabase.from('activity_logs').insert({
    lead_id: activity.leadId,
    actor_id: activity.actorId,
    actor_name: activity.actorName,
    actor_role: activity.actorRole,
    activity_type: activity.activityType,
    outcome: activity.outcome || null,
    notes: activity.notes || null,
  }).select('*').single();

  return error ? error.message : data?.id;
}

export function mapActivity(row: any): ActivityLog {
  return {
    id: row.id,
    leadId: row.lead_id,
    actorId: row.actor_id,
    actorName: row.actor_name,
    actorRole: row.actor_role,
    activityType: row.activity_type,
    outcome: row.outcome ?? undefined,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
  };
}