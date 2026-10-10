import { toast, esc } from './util';
import { t, sb, sbRef, currentUser, role, jobs } from './state';
import { refreshCurrentScreen } from './shell';
import type { Job } from './types';

/*
 * Customer reviews of providers (diz_reviews.sql). When a job is done the customer can give the provider 1–5 stars and an
 * optional comment, once per job (it cannot be edited). Everyone signed in sees a provider's average and number of reviews
 * (rpc provider_ratings); the rows themselves (with phone numbers) are visible only to the two parties and the admin.
 * Without the SQL file everything here stays hidden and the app works as before.
 */
const MAX_COMMENT = 500;
export interface Review { jobId: string; providerPhone: string; rating: number; comment: string | null; createdAt: number }
interface Rating { avg: number; count: number }

let available = true;
let reviews = new Map<string, Review>();          // my own rows (by job id): written by me (customer) or about me (provider)
let ratings = new Map<string, Rating>();          // provider phone -> aggregate
let comments: { rating: number; comment: string | null; createdAt: number }[] = [];
let loadedKey = '';
let drafts: Record<string, { rating: number; comment: string }> = {};
let sending = false;

export function clearReviews(){ reviews = new Map(); ratings = new Map(); comments = []; loadedKey = ''; drafts = {}; available = true; sending = false; }

const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);

/** Which providers' ratings this user needs to see right now. */
function neededPhones(): string[] {
  const me = currentUser?.phone; if(!me) return [];
  const set = new Set<string>();
  if(role === 'driver') set.add(me);
  for(const j of jobs){
    if(j.ownerPhone === me){
      if(j.acceptedByPhone) set.add(j.acceptedByPhone);
      for(const a of j.applicants || []) set.add(a.phone);
    }
  }
  return [...set].sort();
}

/** Called after every jobs snapshot: fetches ratings/reviews when the set of providers or finished jobs changed. */
export async function syncReviews(){
  if(!sbRef || !currentUser || !available || role === 'admin') return;
  const phones = neededPhones();
  const doneCount = jobs.filter(j => j.status === 'done' && (j.ownerPhone === currentUser!.phone || j.acceptedByPhone === currentUser!.phone)).length;
  const key = phones.join(',') + '|' + doneCount;
  if(key === loadedKey) return;
  loadedKey = key;
  try{
    const mine = await sb().from('reviews').select('*');
    if(mine.error) throw mine.error;
    reviews = new Map((mine.data as Record<string, unknown>[]).map(r => [r.job_id as string, {
      jobId: r.job_id as string, providerPhone: r.provider_phone as string, rating: Number(r.rating),
      comment: (r.comment as string | null) ?? null, createdAt: Number(r.created_at) }]));
    if(phones.length){
      const agg = await sb().rpc('provider_ratings', { p_phones: phones });
      if(agg.error) throw agg.error;
      ratings = new Map((agg.data as { provider_phone: string; avg_rating: number | string; review_count: number }[])
        .map(r => [r.provider_phone, { avg: Number(r.avg_rating), count: Number(r.review_count) }]));
    }
    if(role === 'driver'){
      const c = await sb().rpc('provider_reviews', { p_phone: currentUser.phone, p_limit: 20 });
      if(!c.error) comments = (c.data as { rating: number; comment: string | null; created_at: number }[])
        .map(r => ({ rating: Number(r.rating), comment: r.comment, createdAt: Number(r.created_at) }));
    }
    refreshCurrentScreen();
  }catch(e){ console.warn('reviews not available', e); available = false; loadedKey = ''; }
}

/** "★ 4.5 (12)" or a "new" label for a provider without reviews. */
export function ratingBadgeHTML(phone: string): string {
  if(!available) return '';
  const d = t().review, r = ratings.get(phone);
  return r ? `<span class="rating" title="${esc(d.avgTitle)}">★ ${r.avg.toFixed(1)} <span class="rating-n">(${r.count})</span></span>`
           : `<span class="rating none">${d.noReviewsYet}</span>`;
}

/** Review area of a finished job card: the form for the customer, the received review for the provider. */
export function reviewBlockHTML(j: Job): string {
  if(!available || j.status !== 'done' || !j.acceptedByPhone || !currentUser) return '';
  const d = t().review, rv = reviews.get(j.id);
  if(rv){
    const who = role === 'driver' ? d.theirReview : d.yourReview;
    return `<div class="review-box"><div class="review-stars">${stars(rv.rating)}</div><div style="font-size:12px;color:var(--muted);">${who}</div>
      ${rv.comment ? `<div style="margin-top:4px;font-size:13px;">“${esc(rv.comment)}”</div>` : ''}</div>`;
  }
  if(role !== 'customer' || j.ownerPhone !== currentUser.phone) return role === 'driver' ? `<div style="margin-top:8px;font-size:12px;color:var(--muted);">${d.noReviewForYou}</div>` : '';
  const dr = drafts[j.id] || { rating: 0, comment: '' };
  return `<div class="review-box">
    <label style="margin-top:0;">${d.prompt}</label>
    <div class="review-stars pick" role="radiogroup">${[1, 2, 3, 4, 5].map(n =>
      `<button type="button" class="star${n <= dr.rating ? ' on' : ''}" aria-label="${n}" onclick="setReviewRating('${j.id}',${n})">${n <= dr.rating ? '★' : '☆'}</button>`).join('')}</div>
    <textarea id="reviewInput-${j.id}" maxlength="${MAX_COMMENT}" oninput="setReviewComment('${j.id}',this.value)" placeholder="${esc(d.commentPlaceholder)}">${esc(dr.comment)}</textarea>
    <div class="action-row"><button class="secondary" onclick="submitReview('${j.id}')" ${dr.rating ? '' : 'disabled'}>${d.sendBtn}</button></div>
  </div>`;
}

/** Summary shown on top of a provider's history: own average and latest comments. */
export function ownRatingHTML(): string {
  if(!available || role !== 'driver' || !currentUser) return '';
  const d = t().review, r = ratings.get(currentUser.phone);
  if(!r) return `<div class="card"><div style="font-size:13px;color:var(--muted);">${d.noReviewsYet}</div></div>`;
  const list = comments.filter(c => c.comment).slice(0, 5).map(c =>
    `<div style="margin-top:8px;font-size:13px;"><span class="review-stars">${stars(c.rating)}</span> “${esc(c.comment)}”</div>`).join('');
  return `<div class="card"><div class="top-row"><div><h3>${d.yourRating}</h3></div><div class="price">★ ${r.avg.toFixed(1)} <span class="rating-n">(${r.count})</span></div></div>${list}</div>`;
}

export function setReviewRating(jobId: string, n: number){ drafts[jobId] = { rating: n, comment: drafts[jobId]?.comment ?? '' }; refreshCurrentScreen(); }
export function setReviewComment(jobId: string, v: string){ drafts[jobId] = { rating: drafts[jobId]?.rating ?? 0, comment: v }; }

export async function submitReview(jobId: string){
  const dr = drafts[jobId];
  if(!dr || !dr.rating || sending) return;
  sending = true;
  try{
    const { error } = await sb().rpc('submit_review', { p_job_id: jobId, p_rating: dr.rating, p_comment: dr.comment.trim() || null });
    if(error) throw error;
    delete drafts[jobId]; loadedKey = '';
    toast(t().review.thanks);
    await syncReviews(); refreshCurrentScreen();
  }catch(e){ console.warn('review failed', e); toast(t().review.failed); }
  finally{ sending = false; }
}
