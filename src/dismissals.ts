import { toast } from './util';
import { t, sb, sbRef, role, currentUser } from './state';
import { refreshCurrentScreen } from './shell';

/*
 * A provider can ignore open jobs they are not interested in. Ignored jobs are hidden from their job list on every device
 * (stored in the table job_dismissals, see diz_dismissals.sql) and can be shown and restored from a link below the list.
 * Nothing changes for the customer or other providers.
 */
let dismissed = new Set<string>();
let showDismissed = false;
let missingTable = false;   // diz_dismissals.sql not run yet: ignoring then only lasts until the page is reloaded

export const isDismissed = (jobId: string) => dismissed.has(jobId);
export const dismissedCount = (openIds: string[]) => openIds.filter(id => dismissed.has(id)).length;
export const showingDismissed = () => showDismissed;

export async function loadDismissals(){
  dismissed = new Set(); showDismissed = false; missingTable = false;
  if(!sbRef || !currentUser || role !== 'driver') return;
  try{
    const { data, error } = await sb().from('job_dismissals').select('*');
    if(error) throw error;
    dismissed = new Set((data as { job_id: string }[]).map(r => r.job_id));
    refreshCurrentScreen();
  }catch(e){ console.warn('dismissals not available', e); missingTable = true; }
}
export function clearDismissals(){ dismissed = new Set(); showDismissed = false; }

export async function dismissJob(jobId: string){
  dismissed.add(jobId); refreshCurrentScreen();
  toast(t().dismiss.toast);
  if(missingTable) return;
  const { error } = await sb().rpc('dismiss_job', { p_job_id: jobId });
  if(error){ dismissed.delete(jobId); refreshCurrentScreen(); toast(t().dismiss.failed); }
}
export async function restoreJob(jobId: string){
  dismissed.delete(jobId); refreshCurrentScreen();
  if(missingTable) return;
  const { error } = await sb().rpc('restore_job', { p_job_id: jobId });
  if(error){ dismissed.add(jobId); refreshCurrentScreen(); toast(t().dismiss.failed); }
}
export function toggleDismissed(){ showDismissed = !showDismissed; refreshCurrentScreen(); }
