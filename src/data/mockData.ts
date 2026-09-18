]export type Role = 'admin' | 'manager' | 'sales' | 'telesales';

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

export interface User {
  id: string;
  username: string;
  fullName: string;
  role: Role;
  status: 'active' | 'inactive';
  lastLogin: string;
  email: string;
  managerId?: string; // for sales/telesales: which manager they report to
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
  status: LeadStatus;
  assignedTo?: string; // user id (telesales or manager)
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

const makeCode = (n: number) => `CLT-${String(n).padStart(4, '0')}`;

export const USERS: User[] = [
  { id: 'u1', username: 'admin', fullName: 'Alex Morgan', role: 'admin', status: 'active', lastLogin: '2026-09-18 09:12', email: 'admin@salescrm.io' },
  // Managers
  { id: 'um1', username: 'rania.mgr', fullName: 'Rania Al-Farsi', role: 'manager', status: 'active', lastLogin: '2026-09-18 08:55', email: 'rania.mgr@salescrm.io' },
  { id: 'um2', username: 'karim.mgr', fullName: 'Karim Saad', role: 'manager', status: 'active', lastLogin: '2026-09-17 17:00', email: 'karim.mgr@salescrm.io' },
  // Telesales (assigned to managers)
  { id: 'u2', username: 'sara.ts', fullName: 'Sara Hassan', role: 'telesales', status: 'active', lastLogin: '2026-09-18 08:45', email: 'sara@salescrm.io', managerId: 'um1' },
  { id: 'u3', username: 'james.ts', fullName: 'James Carter', role: 'telesales', status: 'active', lastLogin: '2026-09-17 17:30', email: 'james@salescrm.io', managerId: 'um1' },
  { id: 'u4', username: 'lena.ts', fullName: 'Lena Park', role: 'telesales', status: 'active', lastLogin: '2026-09-18 09:01', email: 'lena@salescrm.io', managerId: 'um2' },
  { id: 'u5', username: 'mike.ts', fullName: 'Mike Osei', role: 'telesales', status: 'inactive', lastLogin: '2026-09-10 14:20', email: 'mike@salescrm.io', managerId: 'um2' },
  // Sales (assigned to managers)
  { id: 'u6', username: 'diana.sales', fullName: 'Diana Reeves', role: 'sales', status: 'active', lastLogin: '2026-09-18 09:00', email: 'diana@salescrm.io', managerId: 'um1' },
  { id: 'u7', username: 'tom.sales', fullName: 'Tom Nguyen', role: 'sales', status: 'active', lastLogin: '2026-09-17 16:55', email: 'tom@salescrm.io', managerId: 'um1' },
  { id: 'u8', username: 'priya.sales', fullName: 'Priya Sharma', role: 'sales', status: 'active', lastLogin: '2026-09-18 08:30', email: 'priya@salescrm.io', managerId: 'um2' },
];

export const LEADS: Lead[] = [
  { id: 'l1', clientCode: makeCode(1), name: 'Hassan Al-Rashid', phone: '+971 50 123 4567', company: 'Al Rashid Trading', region: 'Dubai', source: 'Import Batch A', status: 'Subscribed', assignedTo: 'u2', createdAt: '2026-09-01', updatedAt: '2026-09-15', notes: 'Full enterprise package signed.', comments: [{ id: 'cc1', leadId: 'l1', authorId: 'u2', authorName: 'Sara Hassan', text: 'Signed 12-month contract. Very happy.', createdAt: '2026-09-15 10:00' }] },
  { id: 'l2', clientCode: makeCode(2), name: 'Nour Khalil', phone: '+971 55 234 5678', company: 'Khalil Enterprises', region: 'Abu Dhabi', source: 'Import Batch A', status: 'Interested', assignedTo: 'u2', createdAt: '2026-09-01', updatedAt: '2026-09-17' },
  { id: 'l3', clientCode: makeCode(3), name: 'Fatima Zahra', phone: '+971 52 345 6789', company: 'Zahra Group', region: 'Sharjah', source: 'Import Batch A', status: 'Call Back Later', assignedTo: 'u2', callbackDate: '2026-09-20', createdAt: '2026-09-02', updatedAt: '2026-09-16', notes: 'Asked to call Thursday morning.' },
  { id: 'l4', clientCode: makeCode(4), name: 'Omar Benali', phone: '+971 56 456 7890', company: 'Benali Solutions', region: 'Dubai', source: 'Import Batch A', status: 'No Answer', assignedTo: 'u2', createdAt: '2026-09-02', updatedAt: '2026-09-17' },
  { id: 'l5', clientCode: makeCode(5), name: 'Aisha Mansoor', phone: '+971 50 567 8901', company: 'Mansoor Corp', region: 'Ajman', source: 'Import Batch A', status: 'Not Interested', assignedTo: 'u2', createdAt: '2026-09-03', updatedAt: '2026-09-16', notes: 'Not interested at this time.' },
  { id: 'l6', clientCode: makeCode(6), name: 'Khalid Al-Farsi', phone: '+971 55 678 9012', company: 'Al Farsi Retail', region: 'Dubai', source: 'Import Batch B', status: 'Subscribed', assignedTo: 'u3', createdAt: '2026-09-05', updatedAt: '2026-09-17' },
  { id: 'l7', clientCode: makeCode(7), name: 'Layla Ibrahim', phone: '+971 52 789 0123', company: 'Ibrahim Holdings', region: 'Abu Dhabi', source: 'Import Batch B', status: 'Free Trial', assignedTo: 'u3', freeTrialEndDate: '2026-09-25', createdAt: '2026-09-05', updatedAt: '2026-09-17', notes: '14-day free trial started.' },
  { id: 'l8', clientCode: makeCode(8), name: 'Yousef Al-Mulla', phone: '+971 56 890 1234', company: 'Al Mulla Group', region: 'Dubai', source: 'Import Batch B', status: 'Converted', assignedTo: 'u3', createdAt: '2026-09-05', updatedAt: '2026-09-16' },
  { id: 'l9', clientCode: makeCode(9), name: 'Rania Haddad', phone: '+971 50 901 2345', company: 'Haddad & Co', region: 'Sharjah', source: 'Import Batch B', status: 'New', assignedTo: 'u3', createdAt: '2026-09-06', updatedAt: '2026-09-06' },
  { id: 'l10', clientCode: makeCode(10), name: 'Tarek Mousa', phone: '+971 55 012 3456', company: 'Mousa Industries', region: 'Dubai', source: 'Import Batch B', status: 'Call Back Later', assignedTo: 'u3', callbackDate: '2026-09-19', createdAt: '2026-09-06', updatedAt: '2026-09-17' },
  { id: 'l11', clientCode: makeCode(11), name: 'Mariam Al-Zaabi', phone: '+971 52 123 6789', company: 'Al Zaabi Ventures', region: 'Abu Dhabi', source: 'Import Batch C', status: 'Assigned', assignedTo: 'u4', createdAt: '2026-09-10', updatedAt: '2026-09-10' },
  { id: 'l12', clientCode: makeCode(12), name: 'Saeed Rashid', phone: '+971 56 234 7890', company: 'Rashid Bros', region: 'Dubai', source: 'Import Batch C', status: 'Assigned', assignedTo: 'u4', createdAt: '2026-09-10', updatedAt: '2026-09-10' },
  { id: 'l13', clientCode: makeCode(13), name: 'Hana Qasim', phone: '+971 50 345 8901', company: 'Qasim Trading', region: 'Fujairah', source: 'Import Batch C', status: 'Did Not Subscribe', assignedTo: 'u4', createdAt: '2026-09-10', updatedAt: '2026-09-17', notes: 'Free trial ended, decided not to continue.' },
  { id: 'l14', clientCode: makeCode(14), name: 'Bilal Ansari', phone: '+971 55 456 9012', company: 'Ansari Logistics', region: 'Dubai', source: 'Manual', status: 'New', createdAt: '2026-09-15', updatedAt: '2026-09-15' },
  { id: 'l15', clientCode: makeCode(15), name: 'Zainab Al-Hosni', phone: '+971 52 567 0123', company: 'Al Hosni Farms', region: 'RAK', source: 'Manual', status: 'New', createdAt: '2026-09-16', updatedAt: '2026-09-16' },
  { id: 'l16', clientCode: makeCode(16), name: 'Ahmad Kamal', phone: '+971 56 678 1234', company: 'Kamal Tech', region: 'Dubai', source: 'Import Batch A', status: 'Contacted', assignedTo: 'u2', createdAt: '2026-09-01', updatedAt: '2026-09-18' },
  { id: 'l17', clientCode: makeCode(17), name: 'Dalal Al-Mutairi', phone: '+971 50 789 2345', company: 'Al Mutairi Real Estate', region: 'Kuwait City', source: 'Import Batch C', status: 'New', createdAt: '2026-09-12', updatedAt: '2026-09-12' },
  { id: 'l18', clientCode: makeCode(18), name: 'Faisal Al-Otaibi', phone: '+971 55 890 3456', company: 'Al Otaibi Construction', region: 'Riyadh', source: 'Import Batch C', status: 'New', createdAt: '2026-09-12', updatedAt: '2026-09-12' },
];

export const MEETINGS: Meeting[] = [
  { id: 'm1', leadId: 'l1', leadName: 'Hassan Al-Rashid', leadPhone: '+971 50 123 4567', clientCode: makeCode(1), telesalesNotes: 'Very interested in the enterprise package. Has budget approved. Wants full demo.', assignedSalesId: 'u6', proposedDate: '2026-09-19 10:00', outcome: 'Deal Closed – Won', bookedById: 'u2', createdAt: '2026-09-15' },
  { id: 'm2', leadId: 'l8', leadName: 'Yousef Al-Mulla', leadPhone: '+971 56 890 1234', clientCode: makeCode(8), telesalesNotes: 'Ready to close. Preferred meeting at their Dubai HQ.', assignedSalesId: 'u6', proposedDate: '2026-09-20 14:00', outcome: 'Scheduled', bookedById: 'u3', createdAt: '2026-09-16' },
  { id: 'm3', leadId: 'l7', leadName: 'Layla Ibrahim', leadPhone: '+971 52 789 0123', clientCode: makeCode(7), telesalesNotes: 'Interested in SMB plan, wants pricing comparison.', assignedSalesId: 'u7', proposedDate: '2026-09-21 11:00', outcome: 'Scheduled', bookedById: 'u3', createdAt: '2026-09-17' },
  { id: 'm4', leadId: 'l2', leadName: 'Nour Khalil', leadPhone: '+971 55 234 5678', clientCode: makeCode(2), telesalesNotes: 'Keen on automation features. Has 3 locations.', assignedSalesId: 'u8', proposedDate: '2026-09-18 15:30', outcome: 'Scheduled', bookedById: 'u2', createdAt: '2026-09-17' },
  { id: 'm5', leadId: 'l6', leadName: 'Khalid Al-Farsi', leadPhone: '+971 55 678 9012', clientCode: makeCode(6), telesalesNotes: 'Retail chain, evaluating multiple vendors.', assignedSalesId: 'u7', proposedDate: '2026-09-15 09:00', outcome: 'Deal Closed – Won', bookedById: 'u3', createdAt: '2026-09-10' },
  { id: 'm6', leadId: 'l9', leadName: 'Rania Haddad', leadPhone: '+971 50 901 2345', clientCode: makeCode(9), telesalesNotes: 'Budget constrained but interested.', assignedSalesId: 'u6', proposedDate: '2026-09-12 13:00', outcome: 'Deal Lost', bookedById: 'u3', createdAt: '2026-09-08' },
];

export const CALL_LOGS: CallLog[] = [
  { id: 'c1', leadId: 'l1', agentId: 'u2', outcome: 'Contacted', notes: 'First contact, briefly explained services.', calledAt: '2026-09-10 10:15' },
  { id: 'c2', leadId: 'l1', agentId: 'u2', outcome: 'Interested', notes: 'Long call. Very interested in enterprise tier.', calledAt: '2026-09-12 14:30' },
  { id: 'c3', leadId: 'l1', agentId: 'u2', outcome: 'Converted', notes: 'Agreed to meeting. Forwarded to Diana.', calledAt: '2026-09-15 09:00' },
  { id: 'c4', leadId: 'l3', agentId: 'u2', outcome: 'No Answer', notes: '', calledAt: '2026-09-14 11:00' },
  { id: 'c5', leadId: 'l3', agentId: 'u2', outcome: 'Call Back Later', notes: 'Busy, asked to call Thursday morning.', calledAt: '2026-09-16 10:00' },
  { id: 'c6', leadId: 'l6', agentId: 'u3', outcome: 'Contacted', notes: 'Initial call, sent info via email.', calledAt: '2026-09-14 15:00' },
  { id: 'c7', leadId: 'l7', agentId: 'u3', outcome: 'Free Trial', notes: 'Client wants 14-day trial first.', calledAt: '2026-09-17 11:30' },
];

export const CONTRACTS: Contract[] = [
  {
    id: 'con1',
    leadId: 'l1',
    clientCode: makeCode(1),
    clientName: 'Hassan Al-Rashid',
    clientPhone: '+971 50 123 4567',
    email: 'hassan@alrashid.ae',
    contractDate: '2026-09-15',
    productType: 'E-commerce Platform',
    storeLink: 'https://alrashid.store',
    subscriptionMonths: 12,
    packageType: 'Enterprise',
    packageDetails: 'Unlimited products, 5 users, priority support, custom domain.',
    contractStartDate: '2026-09-20',
    contractEndDate: '2027-09-20',
    clientNotes: 'Client requested onboarding call in the first week.',
    transferType: 'Bank Transfer',
    amountTabby: 0,
    amountEmkan: 0,
    amountBank: 14400,
    totalPaid: 14400,
    totalContractValue: 14400,
    remainingAmount: 0,
    salesUserId: 'u6',
    telesalesUserId: 'u2',
    isFinalized: true,
    createdAt: '2026-09-15',
  },
  {
    id: 'con2',
    leadId: 'l6',
    clientCode: makeCode(6),
    clientName: 'Khalid Al-Farsi',
    clientPhone: '+971 55 678 9012',
    email: 'khalid@alfarsi.ae',
    contractDate: '2026-09-15',
    productType: 'E-commerce Platform',
    subscriptionMonths: 6,
    packageType: 'Business',
    packageDetails: 'Up to 500 products, 2 users, standard support.',
    contractStartDate: '2026-09-18',
    contractEndDate: '2027-03-18',
    transferType: 'Tabby',
    amountTabby: 3600,
    amountEmkan: 0,
    amountBank: 0,
    totalPaid: 1200,
    totalContractValue: 3600,
    remainingAmount: 2400,
    salesUserId: 'u7',
    telesalesUserId: 'u3',
    isFinalized: false,
    createdAt: '2026-09-15',
  },
];

export const NOTIFICATIONS: Notification[] = [
  { id: 'n1', userId: 'u6', type: 'meeting', title: 'New Meeting Scheduled', message: 'Sara Hassan booked Hassan Al-Rashid for Sep 19 at 10:00 AM', read: false, createdAt: '2026-09-15 09:05' },
  { id: 'n2', userId: 'u6', type: 'meeting', title: 'New Meeting Scheduled', message: 'James Carter booked Yousef Al-Mulla for Sep 20 at 2:00 PM', read: false, createdAt: '2026-09-16 10:05' },
  { id: 'n3', userId: 'u8', type: 'meeting', title: 'New Meeting Scheduled', message: 'Sara Hassan booked Nour Khalil for Sep 18 at 3:30 PM', read: false, createdAt: '2026-09-17 12:00' },
  { id: 'n4', userId: 'u7', type: 'meeting', title: 'New Meeting Scheduled', message: 'James Carter booked Layla Ibrahim for Sep 21 at 11:00 AM', read: true, createdAt: '2026-09-17 14:00' },
  { id: 'n5', userId: 'u2', type: 'assignment', title: 'New Leads Assigned', message: 'Manager assigned 25 leads from Import Batch A to your queue', read: true, createdAt: '2026-09-01 09:00' },
  { id: 'n6', userId: 'u3', type: 'assignment', title: 'New Leads Assigned', message: 'Manager assigned 30 leads from Import Batch B to your queue', read: true, createdAt: '2026-09-05 09:00' },
  { id: 'n7', userId: 'u4', type: 'assignment', title: 'New Leads Assigned', message: 'Manager assigned 20 leads from Import Batch C to your queue', read: false, createdAt: '2026-09-10 09:00' },
  { id: 'n8', userId: 'u6', type: 'reminder', title: 'Meeting Reminder', message: 'Meeting with Nour Khalil in 2 hours (3:30 PM today)', read: false, createdAt: '2026-09-18 13:30' },
  { id: 'n9', userId: 'um1', type: 'assignment', title: 'Leads Assigned to Your Team', message: 'Admin assigned 50 leads from Import Batch A & B to your team', read: false, createdAt: '2026-09-01 09:00' },
];
