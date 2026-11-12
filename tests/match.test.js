// Enhetstester för js/match.js:  node tests/match.test.js
const assert = require('assert');
const JM = require('../js/match.js');
global.window = {}; require('../js/demo-jobs.js'); const DEMO = global.window.JM_DEMO_JOBS;
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('ok ', name); };

const lager = { name: 'Ali Hassan', role: 'Lagerarbetare', city: 'Stockholm', skills: 'truckkort, B-körkort, arabiska',
  phone: '070-123 45 67', email: 'ali@example.com', cv: 'Lagerarbetare med fem års erfarenhet av plock och pack.\nKört truck och använt WMS dagligen.' };

ok('norm', () => { assert.strictEqual(JM.norm('  Truck-KORT, ٢٠٢٦! '), 'truck-kort ٢٠٢٦'.replace('٢٠٢٦', '2026')); });
ok('hasPhrase whole words', () => {
  const t = JM.norm('Krav: B-körkort och C# samt truckkort');
  assert(JM.hasPhrase(t, 'b-körkort')); assert(JM.hasPhrase(t, 'C#')); assert(!JM.hasPhrase(t, 'truck'));
});
ok('splitSkills', () => assert.deepStrictEqual(JM.splitSkills('a, b;c\nd،e'), ['a', 'b', 'c', 'd', 'e']));
ok('cvKeywords skips stopwords and short', () => {
  const k = JM.cvKeywords('och och lager lager lager truck WMS plock', 3);
  assert.deepStrictEqual(k, ['lager', 'plock', 'truck']);
});
ok('best match first: lager job in Stockholm', () => {
  const r = JM.rankJobs(DEMO, lager, 0);
  assert.strictEqual(r[0].job.id, 'demo-1');
  assert(r[0].score >= 70, 'score ' + r[0].score);
  assert(r[0].reasons.role && r[0].reasons.place);
  assert.deepStrictEqual(r[0].reasons.skills, ['truckkort', 'B-körkort']);
  assert(r[0].reasons.cv.includes('wms'));
});
ok('wrong city scores lower', () => {
  const a = JM.scoreJob(DEMO[0], lager).score;
  const b = JM.scoreJob(DEMO[0], Object.assign({}, lager, { city: 'Malmö' })).score;
  assert(b < a);
});
ok('remote job gets points without city match', () => {
  const tolk = { role: 'Tolk', city: 'Kiruna', skills: 'arabiska', cv: '' };
  const s = JM.scoreJob(DEMO[7], tolk);
  assert(s.reasons.remote && s.reasons.role && s.score >= 70, JSON.stringify(s));
});
ok('unrelated job is filtered by minScore', () => {
  const dev = { role: 'Systemutvecklare', city: 'Stockholm', skills: 'TypeScript, React, SQL', cv: '' };
  const r = JM.rankJobs(DEMO, dev, 30);
  assert.strictEqual(r[0].job.id, 'demo-3');
  assert(!r.some((x) => x.job.id === 'demo-2'));
});
ok('score bounds', () => DEMO.forEach((j) => { const s = JM.scoreJob(j, {}).score; assert(s >= 0 && s <= 100); }));
ok('searchQuery', () => assert.strictEqual(JM.searchQuery({ role: ' Lagerarbetare ', city: 'Stockholm' }), 'Lagerarbetare Stockholm'));
ok('cover letter', () => {
  const s = JM.scoreJob(DEMO[0], lager);
  const l = JM.coverLetter(DEMO[0], lager, s.reasons);
  assert(l.includes('Lagerarbetare med truckkort hos Exempel Logistik AB'));
  assert(l.includes('truckkort och b-körkort'));
  assert(l.includes('Ali Hassan') && l.includes('070-123 45 67 · ali@example.com'));
  assert(l.includes('Lagerarbetare med fem års erfarenhet'));
});
ok('report month + csv', () => {
  const a = [{ id: '1', date: '2026-11-12', employer: 'A; AB', headline: 'X "Y"', place: 'Sthlm', url: 'u' },
             { id: '2', date: '2026-10-30', employer: 'B', headline: 'Z', place: '', url: '' },
             { id: '3', date: '2026-11-02', employer: 'C', headline: 'W', place: 'Gbg', url: '' }];
  const rows = JM.monthReport(a, '2026-11');
  assert.deepStrictEqual(rows.map((r) => r.id), ['3', '1']);
  const csv = JM.reportCsv(rows).split('\r\n');
  assert.strictEqual(csv[0], 'Datum;Arbetsgivare;Tjänst;Ort;Länk');
  assert.strictEqual(csv[2], '2026-11-12;"A; AB";"X ""Y""";Sthlm;u');
  assert.strictEqual(JM.reportText(rows).split('\n').length, 2);
});
console.log(`\n${n} tests passed`);
