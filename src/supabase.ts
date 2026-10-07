// Minimal typings for the part of supabase-js (loaded from the CDN <script>) that this app uses.
export interface SbError { message: string }
export interface SbResult<T = any> { data: T; error: SbError | null }   // eslint-disable-line @typescript-eslint/no-explicit-any
export interface SbQuery extends PromiseLike<SbResult> {
  select(columns?: string): SbQuery;
  eq(column: string, value: unknown): SbQuery;
  neq(column: string, value: unknown): SbQuery;
  limit(n: number): SbQuery;
  maybeSingle(): SbQuery;
  single(): SbQuery;
  insert(row: object): SbQuery;
  update(row: object): SbQuery;
  upsert(row: object): SbQuery;
  delete(): SbQuery;
}
export interface SbChannel {
  on(type: 'postgres_changes', filter: { event: string; schema: string; table: string }, cb: (payload: unknown) => void): SbChannel;
  subscribe(): SbChannel;
}
export interface SbSession { user: { id: string } }
export interface SbClient {
  from(table: string): SbQuery;
  channel(name: string): SbChannel;
  removeChannel(ch: SbChannel): unknown;
  rpc(fn: string, args: object): PromiseLike<SbResult>;
  functions: { invoke(name: string, opts?: { body?: object }): Promise<SbResult> };
  auth: {
    signUp(args: { email: string; password: string; options?: { data?: Record<string, unknown> } }):
      Promise<{ data: { user: { id: string } | null; session: SbSession | null }; error: SbError | null }>;
    signInWithPassword(args: { email: string; password: string }):
      Promise<{ data: { user: { id: string } | null; session: SbSession | null }; error: SbError | null }>;
    getSession(): Promise<{ data: { session: SbSession | null } }>;
    signOut(): Promise<{ error: SbError | null }>;
  };
}
declare global {
  interface Window {
    supabase?: { createClient(url: string, key: string): SbClient };
  }
}
