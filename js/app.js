/* Jobbmatch – webbprototyp. Allt sparas i localStorage; annonser hämtas från JobTech (Arbetsförmedlingen). */
(function () {
  'use strict';
  const JM = window.JM;
  const API = 'https://jobsearch.api.jobtechdev.se/search';
  const KEY = { profile: 'jm_profile', applied: 'jm_applied', lang: 'jm_lang' };

  const store = {
    get(k, def) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* privat läge: ignoreras */ } },
  };

  const state = {
    lang: store.get(KEY.lang, 'sv'),
    tab: 'profile',
    profile: store.get(KEY.profile, { name: '', role: '', city: '', skills: '', phone: '', email: '', cv: '' }),
    applied: store.get(KEY.applied, []),
    results: [], source: '', loading: false, open: {},
    month: new Date().toISOString().slice(0, 7),
  };

  const $ = (id) => document.getElementById(id);
  const t = (k, vars) => {
    let s = (window.JM_TEXT[state.lang] || window.JM_TEXT.sv)[k] || window.JM_TEXT.sv[k] || k;
    if (vars) for (const v in vars) s = s.replace('{' + v + '}', vars[v]);
    return s;
  };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = () => new Date().toISOString().slice(0, 10);
  const jobUrl = (job) => (job.application_details && job.application_details.url) || job.webpage_url || '';

  function toast(msg) {
    const el = $('toast'); el.textContent = msg; el.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 2200);
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); }
    catch (e) {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e2) { /* ignoreras */ }
      ta.remove();
    }
    toast(t('copied'));
  }

  /* ---------- statisk text ---------- */
  function renderStatic() {
    document.documentElement.lang = state.lang;
    document.documentElement.dir = state.lang === 'ar' ? 'rtl' : 'ltr';
    document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = t(el.dataset.t); });
    document.querySelectorAll('[data-ph]').forEach((el) => { el.placeholder = t(el.dataset.ph); });
    document.querySelectorAll('#langSwitch button').forEach((b) => b.classList.toggle('on', b.dataset.lang === state.lang));
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === state.tab));
    document.querySelectorAll('.panel').forEach((p) => { p.hidden = p.id !== 'panel-' + state.tab; });
    const n = state.applied.length;
    $('appliedCount').textContent = n ? String(n) : '';
  }

  /* ---------- profil ---------- */
  const FIELDS = ['name', 'role', 'city', 'skills', 'phone', 'email', 'cv'];
  function fillProfile() { FIELDS.forEach((f) => { $('p_' + f).value = state.profile[f] || ''; }); }
  function readProfile() { const p = {}; FIELDS.forEach((f) => { p[f] = $('p_' + f).value.trim(); }); return p; }

  function saveProfile() {
    const p = readProfile();
    if (!p.role) { toast(t('needRole')); $('p_role').focus(); return; }
    state.profile = p; store.set(KEY.profile, p);
    toast(t('saved'));
    setTab('jobs'); search();
  }

  function loadCvFile(file) {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => { $('p_cv').value = String(r.result || '').slice(0, 20000); };
    r.readAsText(file);
  }

  /* ---------- sökning ---------- */
  async function fetchJobs(q) {
    const url = API + '?' + new URLSearchParams({ q, limit: '60' });
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 9000);
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' }, signal: ctrl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      return Array.isArray(data.hits) ? data.hits : [];
    } finally { clearTimeout(timer); }
  }

  async function search() {
    if (!state.profile.role) { renderJobs(); return; }
    state.loading = true; renderJobs();
    let jobs; let source = 'live';
    try {
      jobs = await fetchJobs(JM.searchQuery(state.profile));
      // Ingen träff med ort? Sök bara på yrket.
      if (!jobs.length && state.profile.city) jobs = await fetchJobs(state.profile.role);
    } catch (e) {
      console.warn('Platsbanken gick inte att nå, visar exempelannonser', e);
      jobs = window.JM_DEMO_JOBS; source = 'demo';
    }
    state.results = JM.rankJobs(jobs, state.profile, 15).slice(0, 30);
    state.source = source; state.loading = false; state.open = {};
    renderJobs();
  }

  function isApplied(id) { return state.applied.some((a) => a.id === String(id)); }

  function chip(text, cls) { return `<span class="chip ${cls || ''}">${esc(text)}</span>`; }

  function renderJobs() {
    const box = $('jobList');
    $('jobSource').textContent = '';
    if (!state.profile.role) { box.innerHTML = `<p class="empty">${esc(t('noProfile'))}</p>`; return; }
    if (state.loading) { box.innerHTML = `<p class="empty">${esc(t('searching'))}</p>`; return; }
    $('jobSource').textContent = state.source === 'demo' ? t('sourceDemo') : state.source ? t('sourceLive') : '';
    $('jobSource').classList.toggle('warn', state.source === 'demo');
    if (!state.results.length) { box.innerHTML = `<p class="empty">${esc(t('noJobs'))}</p>`; return; }
    box.innerHTML = state.results.map((r, i) => {
      const j = r.job; const why = r.reasons; const done = isApplied(j.id);
      const chips = [];
      if (why.role) chips.push(chip('✓ ' + t('whyRole'), 'ok'));
      if (why.place) chips.push(chip('✓ ' + t('whyPlace'), 'ok'));
      if (why.remote) chips.push(chip(t('whyRemote')));
      if (why.skills.length) chips.push(`<span class="why">${esc(t('whySkills'))}</span>` + why.skills.map((s) => chip(s, 'skill')).join(''));
      if (why.cv.length) chips.push(`<span class="why">${esc(t('whyCv'))}</span>` + why.cv.map((s) => chip(s)).join(''));
      const desc = (j.description && j.description.text) || '';
      const deadline = j.application_deadline ? String(j.application_deadline).slice(0, 10) : '';
      const level = r.score >= 70 ? 'high' : r.score >= 45 ? 'mid' : 'low';
      return `<article class="job${done ? ' done' : ''}" data-i="${i}">
        <div class="job-head">
          <div class="score ${level}"><b>${r.score}%</b><small>${esc(t('match'))}</small></div>
          <div class="job-main">
            <h3>${esc(j.headline)}</h3>
            <div class="meta">${esc((j.employer && j.employer.name) || '')}${JM.jobPlace(j) ? ' · ' + esc(JM.jobPlace(j)) : ''}
              ${deadline ? ` · ${esc(t('deadline'))} <span dir="ltr">${esc(deadline)}</span>` : ''}
              ${String(j.id).startsWith('demo-') ? chip(t('demoBadge'), 'demo') : ''}</div>
          </div>
        </div>
        <div class="chips">${chips.join(' ')}</div>
        ${state.open[i] ? `<div class="desc" dir="ltr">${esc(desc.slice(0, 2500))}${desc.length > 2500 ? '…' : ''}</div>` : ''}
        <div class="actions">
          <button class="primary" data-act="write" data-i="${i}">${esc(t('write'))}</button>
          ${jobUrl(j) ? `<a class="btn" href="${esc(jobUrl(j))}" target="_blank" rel="noopener">${esc(t('open'))}</a>` : ''}
          <button class="${done ? 'ghost on' : 'ghost'}" data-act="mark" data-i="${i}" ${done ? 'disabled' : ''}>${esc(done ? '✓ ' + t('applied') : t('markApplied'))}</button>
          <button class="link" data-act="more" data-i="${i}">${esc(state.open[i] ? t('showLess') : t('showMore'))}</button>
        </div>
      </article>`;
    }).join('');
  }

  function markApplied(r) {
    const j = r.job;
    if (isApplied(j.id)) return;
    state.applied.push({ id: String(j.id), date: today(), headline: j.headline || '', employer: (j.employer && j.employer.name) || '',
      place: JM.jobPlace(j), url: jobUrl(j) });
    store.set(KEY.applied, state.applied);
    renderStatic(); renderJobs(); renderApplied();
  }

  /* ---------- brev ---------- */
  let letterFor = null;
  function openLetter(r) {
    letterFor = r;
    $('letterJob').textContent = `${r.job.headline} – ${(r.job.employer && r.job.employer.name) || ''}`;
    $('letterText').value = JM.coverLetter(r.job, state.profile, r.reasons);
    $('letterDialog').hidden = false;
    $('letterText').focus();
  }
  function closeLetter() { $('letterDialog').hidden = true; letterFor = null; }

  /* ---------- sökta jobb / aktivitetsrapport ---------- */
  function renderApplied() {
    $('monthInput').value = state.month;
    const rows = JM.monthReport(state.applied, state.month);
    $('reportCount').textContent = t('count', { n: rows.length });
    $('copyReportBtn').disabled = $('csvBtn').disabled = !rows.length;
    $('appliedBody').innerHTML = rows.length ? rows.map((r) => `<tr>
        <td dir="ltr">${esc(r.date)}</td><td>${esc(r.employer)}</td>
        <td>${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.headline)}</a>` : esc(r.headline)}</td>
        <td>${esc(r.place)}</td>
        <td><button class="link danger" data-remove="${esc(r.id)}">${esc(t('remove'))}</button></td></tr>`).join('')
      : `<tr><td colspan="5" class="empty">${esc(t('none'))}</td></tr>`;
  }

  function downloadCsv() {
    const rows = JM.monthReport(state.applied, state.month);
    const blob = new Blob(['﻿' + JM.reportCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `sokta-jobb-${state.month}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ---------- navigering ---------- */
  function setTab(tab) { state.tab = tab; renderStatic(); if (tab === 'applied') renderApplied(); if (tab === 'jobs' && !state.results.length && !state.loading) search(); }
  function setLang(l) { state.lang = l; store.set(KEY.lang, l); renderStatic(); renderJobs(); renderApplied(); }

  function bind() {
    document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
    document.querySelectorAll('#langSwitch button').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));
    $('saveBtn').addEventListener('click', saveProfile);
    $('cvFile').addEventListener('change', (e) => loadCvFile(e.target.files[0]));
    $('refreshBtn').addEventListener('click', search);
    $('jobList').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const i = Number(b.dataset.i); const r = state.results[i]; if (!r) return;
      if (b.dataset.act === 'write') openLetter(r);
      if (b.dataset.act === 'mark') markApplied(r);
      if (b.dataset.act === 'more') { state.open[i] = !state.open[i]; renderJobs(); }
    });
    $('letterClose').addEventListener('click', closeLetter);
    $('letterDialog').addEventListener('click', (e) => { if (e.target.id === 'letterDialog') closeLetter(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('letterDialog').hidden) closeLetter(); });
    $('letterCopy').addEventListener('click', () => copy($('letterText').value));
    $('letterApply').addEventListener('click', () => {
      if (!letterFor) return;
      const url = jobUrl(letterFor.job);
      if (url) window.open(url, '_blank', 'noopener');
      markApplied(letterFor); closeLetter();
    });
    $('monthInput').addEventListener('change', (e) => { state.month = e.target.value || state.month; renderApplied(); });
    $('copyReportBtn').addEventListener('click', () => copy(JM.reportText(JM.monthReport(state.applied, state.month))));
    $('csvBtn').addEventListener('click', downloadCsv);
    $('appliedBody').addEventListener('click', (e) => {
      const b = e.target.closest('[data-remove]'); if (!b) return;
      state.applied = state.applied.filter((a) => a.id !== b.dataset.remove);
      store.set(KEY.applied, state.applied); renderStatic(); renderApplied(); renderJobs();
    });
  }

  bind(); fillProfile(); renderStatic(); renderJobs(); renderApplied();
  if (state.profile.role) setTab('jobs');
})();
