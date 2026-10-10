import { I18N, type Dict } from './i18n';
import { type DbShim } from './db';
import { type SbClient } from './supabase';
import { type Lang, type Role, type Job, type AppUser, type ServiceKey, type Payment, type PaymentsMode, type ProviderLocation } from './types';

/** Arabic is the default language; a language the user picked themselves is remembered (see shell.ts). */
export let lang: Lang = "ar";
export let role: Role = "customer";
export let selectedService: ServiceKey | null = null;
export let selectedCat: string | null = null;
export let selectedSize: number | null = null;
export let useCustomPrice = false;
export let editingJobId: string | null = null;
export let photoDataUrl: string | null = null;
export let jobs: Job[] = [];
export let payments: Payment[] = [];
export let paymentsMode: PaymentsMode = 'off';
export let locations: ProviderLocation[] = [];

export let dbRef: DbShim | null = null;
export let currentUser: AppUser | null = null;
export let authMode: 'login' | 'register' = 'login';
export let authSelectedRole: 'customer' | 'driver' | null = null;
export let authSelectedProfiles = new Set<string>();
export let editProfiles: Set<string> | null = null;

export function t(): Dict { return I18N[lang]; }
/** The signed-in user; throws if called while signed out (callers guard on currentUser first). */
export function me(): AppUser { if(!currentUser) throw new Error('not signed in'); return currentUser; }
export function db(): DbShim { if(!dbRef) throw new Error('database not ready'); return dbRef; }
export function sb(): SbClient { if(!sbRef) throw new Error('auth client not ready'); return sbRef; }

export let sbRef: SbClient | null = null;
export let unsubJobs: (() => void) | null = null;

export function setUseCustomPrice(v: typeof useCustomPrice){ useCustomPrice = v; }

export function setRole(v: typeof role){ role = v; }

export function setJobs(v: typeof jobs){ jobs = v; }

export function setSelectedService(v: typeof selectedService){ selectedService = v; }

export function setAuthSelectedRole(v: typeof authSelectedRole){ authSelectedRole = v; }

export function setLangState(v: typeof lang){ lang = v; }

export function setUnsubJobs(v: typeof unsubJobs){ unsubJobs = v; }

export function setSbRef(v: typeof sbRef){ sbRef = v; }

export function setEditProfiles(v: typeof editProfiles){ editProfiles = v; }

export function setDbRef(v: typeof dbRef){ dbRef = v; }

export function setCurrentUser(v: typeof currentUser){ currentUser = v; }

export function setSelectedCat(v: typeof selectedCat){ selectedCat = v; }

export function setAuthSelectedProfiles(v: typeof authSelectedProfiles){ authSelectedProfiles = v; }

export function setSelectedSize(v: typeof selectedSize){ selectedSize = v; }

export function setEditingJobId(v: typeof editingJobId){ editingJobId = v; }

export function setPhotoDataUrl(v: typeof photoDataUrl){ photoDataUrl = v; }

export function setAuthMode(v: typeof authMode){ authMode = v; }
export function setPayments(v: typeof payments){ payments = v; }
export function setPaymentsMode(v: typeof paymentsMode){ paymentsMode = v; }
export function setLocations(v: typeof locations){ locations = v; }
