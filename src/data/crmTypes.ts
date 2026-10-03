export type Role = "admin" | "manager" | "sales" | "telesales"

export type LeadStatus = "New" | "Assigned" | "Contacted" | "No Answer" | "Call Back Later" | "Interested" | "Not Interested" | "Free Trial" | "Subscribed" | "Did Not Subscribe" | "Converted"

export type MeetingOutcome = "Scheduled" | "Deal Closed – Won" | "Deal Lost" | "Rescheduled" | "No-Show"

export interface User {
  id: string

  username: string

  fullName: string

  role: Role

  status: "active" | "inactive"

  lastLogin?: string

  email?: string

  managerId?: string
}

export interface ClientComment {
  id: string

  leadId: string

  authorId: string

  authorName: string

  text: string

  createdAt: string
}

export interface Lead {
  id: string

  customerNumber?: number

  website?: string

  websiteStatus?: "working" | "not_working"

  websiteStatusSource?: "manual" | "auto_checked"

  phoneSource?: "manual" | "website" | "auto_scraped"

  quantity?: number

  clientCode: string

  name: string

  phone: string

  company?: string

  region?: string

  source?: string

  isSallaStore?: boolean

  dataQuality?: "high" | "medium" | "normal"

  status: LeadStatus

  assignedTo?: string

  importBatch?: string

  notes?: string

  callbackDate?: string

  freeTrialEndDate?: string

  createdAt: string

  updatedAt: string

  comments?: ClientComment[]
}

export interface CallLog {
  id: string

  leadId: string

  agentId: string

  outcome: LeadStatus

  notes: string

  calledAt: string
}
