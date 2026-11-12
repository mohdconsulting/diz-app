/* Jobbmatch – matchning mellan profil och annons. Rena funktioner (används både i webbläsaren och i node-testerna). */
(function (root) {
  'use strict';

  const STOP = new Set(('och att det som en ett är på för med av till den har inte du vi ni de jag om eller men från kan ska vara '
    + 'vår våra ditt din dina dig oss sig hos samt även inom under efter över när där här vill alla andra mer mycket '
    + 'arbete arbeta jobb tjänst tjänsten söker sökande erfarenhet god goda bra stor stort nya ny the and for with you our '
    + 'is are of in to a an as on at be will your have per år års dag dagar tid heltid deltid använt kört dagligen '
    + 'en två tre fyra fem sex sju åtta nio tio').split(/\s+/));

  /** Små bokstäver, arabiska siffror → 0-9, bara bokstäver/siffror/#/+ kvar. */
  function norm(s) {
    return String(s || '')
      .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
      .toLowerCase()
      .replace(/[^0-9a-zåäöéüæø#+\-؀-ۿ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function words(s) {
    return norm(s).split(' ').filter((w) => w.length >= 2 && !STOP.has(w));
  }

  /** Finns frasen som hela ord i texten? ("c#" i "kan c# och java", "b-körkort" i "krav: b-körkort") */
  function hasPhrase(normText, phrase) {
    const p = norm(phrase);
    if (!p) return false;
    // "WMS" ska hittas i "WMS-system", men "b-körkort" ska fortfarande matcha som helhet.
    return (' ' + normText + ' ').includes(' ' + p + ' ') || (' ' + normText.replace(/-/g, ' ') + ' ').includes(' ' + p + ' ');
  }

  /** Kompetenser från fritext: "lager, truckkort; B-körkort" → ["lager","truckkort","b-körkort"] */
  function splitSkills(s) {
    return String(s || '').split(/[,;\n،]+/).map((x) => x.trim()).filter(Boolean);
  }

  /** De vanligaste meningsfulla orden i CV:t (för att fånga sådant användaren inte skrivit som kompetens). */
  function cvKeywords(cv, max) {
    const count = new Map();
    for (const w of words(cv)) {
      if (w.length < 3 || /^\d+$/.test(w)) continue;
      count.set(w, (count.get(w) || 0) + 1);
    }
    return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, max || 25).map((e) => e[0]);
  }

  /** Text att matcha mot från en annons i JobTech-format. */
  function jobText(job) {
    return norm([
      job.headline,
      job.occupation && job.occupation.label,
      job.description && (job.description.text || job.description.text_formatted),
      job.must_have && (job.must_have.skills || []).map((s) => s.label).join(' '),
      job.nice_to_have && (job.nice_to_have.skills || []).map((s) => s.label).join(' '),
    ].filter(Boolean).join(' '));
  }

  function jobPlace(job) {
    const a = job.workplace_address || {};
    return [a.municipality, a.city, a.region].filter(Boolean).join(', ');
  }

  /**
   * Poäng 0–100 och förklaring.
   *  roll/yrke i rubrik eller yrkesbenämning  40
   *  kompetenser som nämns i annonsen          35 (andel av profilens kompetenser)
   *  ord från CV:t som finns i annonsen        15
   *  rätt ort (eller distans)                  10
   */
  function scoreJob(job, profile) {
    const text = jobText(job);
    const head = norm([job.headline, job.occupation && job.occupation.label].join(' '));
    const reasons = { role: false, skills: [], cv: [], place: false, remote: false };
    let score = 0;

    const roleWords = words(profile.role);
    if (roleWords.length) {
      const hits = roleWords.filter((w) => head.includes(w)).length;
      if (hasPhrase(head, profile.role) || hits === roleWords.length) { score += 40; reasons.role = true; }
      else if (hits) { score += Math.round(40 * hits / roleWords.length * 0.6); reasons.role = true; }
      else if (roleWords.some((w) => text.includes(w))) score += 10;
    }

    const skills = splitSkills(profile.skills);
    reasons.skills = skills.filter((s) => hasPhrase(text, s));
    if (skills.length) score += Math.round(35 * Math.min(1, reasons.skills.length / Math.min(skills.length, 5)));

    const already = new Set(reasons.skills.map(norm).concat(roleWords));
    reasons.cv = cvKeywords(profile.cv, 25).filter((w) => !already.has(w) && hasPhrase(text, w)).slice(0, 6);
    score += Math.min(15, reasons.cv.length * 3);

    const city = norm(profile.city);
    const place = norm(jobPlace(job));
    reasons.remote = /\bdistans|\bremote|hemifrån/.test(text);
    if (city && place && place.includes(city)) { score += 10; reasons.place = true; }
    else if (!city) score += 5;
    else if (reasons.remote) score += 7;

    return { score: Math.max(0, Math.min(100, score)), reasons };
  }

  /** Sorterade träffar; annonser under minScore tas bort. */
  function rankJobs(jobs, profile, minScore) {
    return jobs
      .map((job) => Object.assign({ job }, scoreJob(job, profile)))
      .filter((r) => r.score >= (minScore || 0))
      .sort((a, b) => b.score - a.score || String(b.job.publication_date || '').localeCompare(String(a.job.publication_date || '')));
  }

  /** Sökfråga till JobTech: roll + ort (ort gör urvalet relevant redan i API:t). */
  function searchQuery(profile) {
    return [profile.role, profile.city].map((s) => String(s || '').trim()).filter(Boolean).join(' ');
  }

  /** Personligt brev (svenska, eftersom annonserna är svenska). Användaren redigerar innan det skickas. */
  function coverLetter(job, profile, reasons) {
    const employer = (job.employer && job.employer.name) || 'er';
    const name = String(profile.name || '').trim() || '[Ditt namn]';
    const role = String(profile.role || '').trim();
    const skills = (reasons && reasons.skills.length ? reasons.skills : splitSkills(profile.skills)).slice(0, 4);
    const firstCvLine = String(profile.cv || '').split('\n').map((s) => s.trim()).find((s) => s.length > 20) || '';
    const list = (a) => a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' och ' + a[a.length - 1];
    const lines = [
      `Hej!`,
      ``,
      `Jag söker tjänsten som ${job.headline || role} hos ${employer}.`,
      role ? `Jag arbetar som ${role.toLowerCase()} och tror att min erfarenhet passar bra för tjänsten.` : `Jag tror att min erfarenhet passar bra för tjänsten.`,
    ];
    if (skills.length) lines.push(`Jag har erfarenhet av ${list(skills.map((s) => s.toLowerCase()))}, vilket ni efterfrågar i annonsen.`);
    if (firstCvLine) lines.push('', firstCvLine);
    lines.push('', `Jag är noggrann, lär mig snabbt och trivs med att samarbeta med andra. Jag berättar gärna mer på en intervju.`,
      '', 'Med vänliga hälsningar', name);
    const contact = [profile.phone, profile.email].map((s) => String(s || '').trim()).filter(Boolean).join(' · ');
    if (contact) lines.push(contact);
    return lines.join('\n');
  }

  /** Aktivitetsrapport: sökta jobb för en månad ("2026-11"). */
  function monthReport(applied, month) {
    return applied.filter((a) => String(a.date).slice(0, 7) === month)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }

  function reportText(rows) {
    return rows.map((r) => `${r.date}\t${r.employer}\t${r.headline}\t${r.place || ''}\t${r.url || ''}`).join('\n');
  }

  function csvCell(v) {
    const s = String(v == null ? '' : v);
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  /** CSV med semikolon (öppnas rätt i svenskt Excel). */
  function reportCsv(rows) {
    const head = ['Datum', 'Arbetsgivare', 'Tjänst', 'Ort', 'Länk'];
    return [head].concat(rows.map((r) => [r.date, r.employer, r.headline, r.place, r.url]))
      .map((r) => r.map(csvCell).join(';')).join('\r\n');
  }

  const api = { norm, words, hasPhrase, splitSkills, cvKeywords, jobText, jobPlace, scoreJob, rankJobs, searchQuery,
    coverLetter, monthReport, reportText, reportCsv };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JM = api;
})(typeof window !== 'undefined' ? window : globalThis);
