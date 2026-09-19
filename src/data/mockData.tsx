export type Role = 'admin' | 'manager' | 'sales' | 'telesales';

export type LeadStatus =
  | 'New'
  | 'Assigned'
  | 'Contacted'
  | 'No Answer'
  | 'Call Back Later'
  | 'Interested'
  | 'Not Interested'
  | 'Free Trial'
  | 'Subscribed'
  | 'Did Not Subscribe'
  | 'Converted';

export type MeetingOutcome =
  | 'Scheduled'
  | 'Deal Closed – Won'
  | 'Deal Lost'
  | 'Rescheduled'
  | 'No-Show';

export type LeadDataQuality = 'high' | 'medium' | 'normal';

export interface User {
  id: string;
  username: string;
  fullName: string;
  role: Role;
  status: 'active' | 'inactive';
  lastLogin: string;
  email: string;
  managerId?: string;
}

export interface ClientComment {
  id: string;
  leadId: string;
  authorId: string;
  authorName: string;
  text: string;
  createdAt: string;
}

export interface Lead {
  id: string;
  clientCode: string;
  name: string;
  phone: string;
  company?: string;
  region?: string;
  source?: string;
  isSallaStore: boolean;
  dataQuality: LeadDataQuality;
  status: LeadStatus;
  assignedTo?: string;
  importBatch?: string;
  notes?: string;
  callbackDate?: string;
  freeTrialEndDate?: string;
  createdAt: string;
  updatedAt: string;
  comments?: ClientComment[];
}

export interface CallLog {
  id: string;
  leadId: string;
  agentId: string;
  outcome: LeadStatus;
  notes: string;
  calledAt: string;
}

export interface Meeting {
  id: string;
  leadId: string;
  leadName: string;
  leadPhone: string;
  clientCode: string;
  telesalesNotes: string;
  assignedSalesId: string;
  proposedDate: string;
  outcome: MeetingOutcome;
  bookedById: string;
  createdAt: string;
}

export interface Contract {
  id: string;
  leadId: string;
  clientCode: string;
  clientName: string;
  clientPhone: string;
  email?: string;
  contractDate: string;
  productType: string;
  storeLink?: string;
  subscriptionMonths: number;
  packageType: string;
  packageDetails?: string;
  contractStartDate: string;
  contractEndDate: string;
  clientNotes?: string;
  contractFileUrl?: string;
  invoiceFileUrl?: string;
  transferType: string;
  amountTabby: number;
  amountEmkan: number;
  amountBank: number;
  totalPaid: number;
  totalContractValue: number;
  remainingAmount: number;
  salesUserId: string;
  telesalesUserId: string;
  isFinalized: boolean;
  createdAt: string;
}

export interface Notification {
  id: string;
  userId: string;
  type: 'meeting' | 'assignment' | 'reminder' | 'system';
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}

export function generateCode(prefix: 'EMP' | 'CLT'): string {
  const uniquePart = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().split('-')[0]
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}-${uniquePart.toUpperCase()}`;
}

export function generateTemporaryPassword(): string {
  return `${generateCode('EMP')}-Aa1!`;
}

export const USERS: User[] = [];
export const LEADS: Lead[] = [];
export const MEETINGS: Meeting[] = [];
export const CALL_LOGS: CallLog[] = [];
export const CONTRACTS: Contract[] = [];
export const NOTIFICATIONS: Notification[] = [];
