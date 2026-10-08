// Firestore-like compatibility layer over Supabase (so app code can say dbRef.doc('jobs/'+id).update({...})).
import type { Job, JobPatch } from './types';
import type { SbClient } from './supabase';

export const SUPABASE_URL = 'https://royjjuxojdlqrjteqsge.supabase.co';
// Publishable (anon) key: safe to ship in client code — access is enforced by row-level security.
export const SUPABASE_ANON_KEY = 'sb_publishable_NITFKxKLeHmD98dHgTfBpg_ZNgaWqGm';

type Row = Record<string, unknown>;

const JOBS_CAMEL_TO_SNAKE: Record<string, string> = {
  desc:'desc_text', toAddr:'to_addr', ownerPhone:'owner_phone', acceptedByPhone:'accepted_by_phone',
  arrivedAt:'arrived_at', markedDoneByProvider:'marked_done_by_provider', markedDoneAt:'marked_done_at',
  paymentReleased:'payment_released', completedAt:'completed_at', createdAt:'created_at',
  problemReported:'problem_reported', problemText:'problem_text', problemReportedAt:'problem_reported_at', autoReleased:'auto_released',
  providerResponse:'provider_response', providerResponseAt:'provider_response_at',
  resolvedAt:'resolved_at',
  addrLat:'addr_lat', addrLng:'addr_lng', toLat:'to_lat', toLng:'to_lng'
};
const JOBS_SNAKE_TO_CAMEL: Record<string, string> =
  Object.fromEntries(Object.entries(JOBS_CAMEL_TO_SNAKE).map(([c, s]) => [s, c]));

function jobsToRow(camelObj: Row): Row {
  const row: Row = {};
  for (const [k, v] of Object.entries(camelObj)) row[JOBS_CAMEL_TO_SNAKE[k] || k] = v;
  return row;
}
function rowToJobObj(row: Row): Omit<Job, 'id'> {
  const obj: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === 'id') continue;
    obj[JOBS_SNAKE_TO_CAMEL[k] || k] = v;
  }
  return obj as unknown as Omit<Job, 'id'>;
}
function usersObjToRow(camelObj: Row): Row {
  const row: Row = {};
  for (const [k, v] of Object.entries(camelObj)) row[k === 'createdAt' ? 'created_at' : k] = v;
  return row;
}
function rowToUserObj(row: Row): Row {
  const obj: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === 'id') continue;
    obj[k === 'created_at' ? 'createdAt' : k] = v;
  }
  return obj;
}

export interface Snapshot<T> { id: string; exists: boolean; data(): T | undefined }
function makeSnapshot<T>(id: string, obj: T | undefined): Snapshot<T> {
  return { id, exists: obj != null, data: () => (obj ? { ...obj } : undefined) };
}

export interface JobsListener { (snap: { docs: Snapshot<Omit<Job, 'id'>>[] }): void }

export interface DbShim {
  collection(name: 'jobs'): JobsCollection;
  collection(name: 'users'): UsersCollection;
  job(id: string): JobDoc;
  user(id: string): UserDoc;
  /** Refetch jobs for every active listener (e.g. after the server changed a job on our behalf). */
  reload(): void;
}
export interface JobDoc {
  id: string;
  get(): Promise<Snapshot<Omit<Job, 'id'>>>;
  set(data: JobPatch): Promise<void>;
  update(data: JobPatch): Promise<void>;
  delete(): Promise<void>;
}
export interface UserDoc {
  id: string;
  get(): Promise<Snapshot<Row>>;
  set(data: Row): Promise<void>;
  update(data: Row): Promise<void>;
  delete(): Promise<void>;
}
export interface JobsCollection {
  limit(n: number): JobsCollection;
  where(field: string, op: '==' | '!=', value: unknown): JobsCollection;
  doc(id: string): JobDoc;
  add(data: JobPatch): Promise<JobDoc>;
  get(): Promise<{ empty: boolean; docs: Snapshot<Omit<Job, 'id'>>[] }>;
  onSnapshot(next: JobsListener, errCb?: (e: unknown) => void): () => void;
}
export interface UsersCollection {
  get(): Promise<{ empty: boolean; docs: Snapshot<Row>[] }>;
}

export function createSupabaseDbShim(sb: SbClient): DbShim {
  const reloaders = new Set<() => void>();
  const reloadJobs = () => reloaders.forEach(f => f());

  function jobDoc(id: string): JobDoc {
    return {
      id,
      async get() {
        const { data, error } = await sb.from('jobs').select('*').eq('id', id).maybeSingle();
        if (error) throw error;
        return makeSnapshot(id, data ? rowToJobObj(data as Row) : undefined);
      },
      async set(data) {
        const { error } = await sb.from('jobs').upsert({ id, ...jobsToRow(data) });
        if (error) throw error;
        reloadJobs();
      },
      async update(data) {
        const { data: rows, error } = await sb.from('jobs').update(jobsToRow(data)).eq('id', id).select('id');
        if (error) throw error;
        if (!rows || rows.length === 0) throw new Error('no rows updated (not allowed or not visible)');
        reloadJobs();
      },
      async delete() {
        const { error } = await sb.from('jobs').delete().eq('id', id);
        if (error) throw error;
        reloadJobs();
      },
    };
  }

  function jobsCollection(): JobsCollection {
    const whereClauses: [string, string, unknown][] = [];
    let limitN: number | null = null;
    const coll: JobsCollection = {
      limit(n) { limitN = n; return coll; },
      where(field, op, value) { whereClauses.push([field, op, value]); return coll; },
      doc(id) { return jobDoc(id); },
      async add(data) {
        const { data: inserted, error } = await sb.from('jobs').insert(jobsToRow(data)).select().single();
        if (error) throw error;
        reloadJobs();
        return jobDoc((inserted as Row).id as string);
      },
      async get() {
        let q = sb.from('jobs').select('*');
        for (const [field, op, value] of whereClauses) {
          const col = JOBS_CAMEL_TO_SNAKE[field] || field;
          q = op === '!=' ? q.neq(col, value) : q.eq(col, value);
        }
        if (limitN) q = q.limit(limitN);
        const { data, error } = await q;
        if (error) throw error;
        const rows = data as Row[];
        return { empty: rows.length === 0, docs: rows.map(r => makeSnapshot(r.id as string, rowToJobObj(r))) };
      },
      onSnapshot(next, errCb) {
        // With row-level security a client only receives events for rows it may see, and rows can
        // disappear from view (e.g. a job assigned to someone else). So on any change we simply refetch.
        let alive = true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        async function load() {
          try {
            const { data, error } = await sb.from('jobs').select('*');
            if (error) throw error;
            if (alive) next({ docs: (data as Row[]).map(r => makeSnapshot(r.id as string, rowToJobObj(r))) });
          } catch (e) { if (errCb) errCb(e); }
        }
        const schedule = () => { clearTimeout(timer); timer = setTimeout(load, 120); };
        reloaders.add(schedule);
        void load();
        const channel = sb.channel('jobs-changes-' + Math.random().toString(36).slice(2))
          .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, schedule)
          .subscribe();
        const poll = setInterval(load, 30000); // safety net if realtime drops or a row leaves our view
        return () => { alive = false; clearTimeout(timer); clearInterval(poll); reloaders.delete(schedule); sb.removeChannel(channel); };
      },
    };
    return coll;
  }

  function userDoc(key: string): UserDoc {
    return {
      id: key,
      async get() {
        const { data, error } = await sb.from('users').select('*').eq('id', key).maybeSingle();
        if (error) throw error;
        return makeSnapshot(key, data ? rowToUserObj(data as Row) : undefined);
      },
      async set(data) {
        const { error } = await sb.from('users').upsert({ id: key, ...usersObjToRow(data) });
        if (error) throw error;
      },
      async update(data) {
        const { error } = await sb.from('users').update(usersObjToRow(data)).eq('id', key);
        if (error) throw error;
      },
      async delete() {
        const { error } = await sb.from('users').delete().eq('id', key);
        if (error) throw error;
      },
    };
  }

  function usersCollection(): UsersCollection {
    return {
      async get() {
        // password column no longer exists; select explicit columns anyway
        const { data, error } = await sb.from('users').select('id,phone,name,role,profiles,created_at');
        if (error) throw error;
        const rows = data as Row[];
        return { empty: rows.length === 0, docs: rows.map(r => makeSnapshot(r.id as string, rowToUserObj(r))) };
      },
    };
  }

  return {
    collection(name: string): never {
      if (name === 'jobs') return jobsCollection() as never;
      if (name === 'users') return usersCollection() as never;
      throw new Error('unsupported collection: ' + name);
    },
    job: jobDoc,
    user: userDoc,
    reload: reloadJobs,
  };
}
