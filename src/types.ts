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
  /** Optional GPS pin for the (pickup) address and the destination; makes the Maps link exact. */
  addrLat: number | null;
  addrLng: number | null;
  toLat: number | null;
  toLng: number | null;
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

export type PaymentsMode = 'off' | 'mock' | 'live';
export type PaymentStatus = 'pending' | 'held' | 'failed' | 'refund_due' | 'refunded' | 'released' | 'paid_out';

/** A payment for one job (database table `payments`, camelCase here). Written only by server-side functions. */
export interface Payment {
  id: string;
  jobId: string;
  customerPhone: string;
  providerPhone: string;
  amount: number;
  commission: number;
  payoutAmount: number;
  currency: string;
  psp: 'mock' | 'qi';
  pspRef: string | null;
  checkoutUrl: string | null;
  status: PaymentStatus;
  failureReason: string | null;
  createdAt: number;
  paidAt: number | null;
  releasedAt: number | null;
  refundedAt: number | null;
  payoutAt: number | null;
}

/** The provider's latest shared position for a job (table `provider_locations`; only the newest fix is kept). */
export interface ProviderLocation {
  jobId: string;
  providerPhone: string;
  customerPhone: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  updatedAt: number;
}

/** One chat message about a job (table `messages`). Written only through rpc send_message. */
export interface ChatMessage {
  id: number;
  jobId: string;
  senderPhone: string;
  recipientPhone: string;
  body: string;
  createdAt: number;
  readAt: number | null;
}
