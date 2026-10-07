export type Lang = 'sv' | 'en' | 'ar';
export type Role = 'customer' | 'driver' | 'admin';
export type JobStatus = 'open' | 'accepted' | 'done' | 'cancelled';
export type ServiceKey = 'junk' | 'moving' | 'goods' | 'pro' | 'towing' | 'deliver';

export interface Applicant {
  phone: string;
  name: string;
  price: number;
  appliedAt?: number;
}

/** A job as the app sees it (camelCase). Database columns are snake_case — see JOBS_CAMEL_TO_SNAKE in db.ts. */
export interface Job {
  id: string;
  service: ServiceKey;
  cat: string | null;
  size: number | null;
  desc: string | null;
  addr: string | null;
  toAddr: string | null;
  price: number;
  photo: string | null;
  status: JobStatus;
  ownerPhone: string | null;
  acceptedByPhone: string | null;
  applicants: Applicant[];
  arrived: boolean;
  arrivedAt: number | null;
  markedDoneByProvider: boolean;
  markedDoneAt: number | null;
  paymentReleased: boolean;
  completedAt: number | null;
  problemReported: boolean;
  problemText: string | null;
  problemReportedAt: number | null;
  providerResponse: string | null;
  providerResponseAt: number | null;
  autoReleased: boolean;
  resolution: 'released' | 'refunded' | 'cancelled' | 'reopened' | null;
  resolvedAt: number | null;
  createdAt: number;
}

/** Fields the client writes when creating or updating a job. */
export type JobPatch = Partial<Omit<Job, 'id'>>;

export interface AppUser {
  id: string;            // Supabase auth uid
  phone: string;
  name: string;
  role: Role;
  profiles: string[];
  createdAt: number;
}

export type EventType =
  | 'applicant' | 'arrived' | 'done' | 'assigned' | 'paid' | 'problem' | 'response' | 'cancelled';
