const fs = require('fs');
const m = (a) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const se = (a) => { const k = m(a); return Math.sqrt(m(a.map((z) => (z - k) ** 2)) / Math.max(1, a.length)); };
const ld = (p) => { const o = {}; for (let i = 1; i <= 8; i++) { try { for (const l of fs.readFileSync(`${__dirname}/.out/${p}_${i}.jsonl`, 'utf8').trim().split('\n')) { const x = JSON.parse(l); o[`${i}:${x.n}`] = x; } } catch { /* not run */ } } return o; };
const pct = (x) => (100 * x).toFixed(1);
function match(tag, title, ref = 'greedy') {
  const all = Object.values(ld(tag)); if (!all.length) return;
  const ok = all.filter((x) => !x.error); const er = all.filter((x) => x.error);
  console.log(`\n## ${title}: battles ${ok.length}, errors ${er.length}`, [...new Set(er.map((e) => e.error.slice(0, 140)))]);
  const ks = Object.keys(ok[0]).filter((k) => k.endsWith('Win')).map((k) => k.slice(0, -3));
  for (const k of ks) {
    const d = ok.map((x) => x[k + 'Win'] - (x[ref + 'Win'] ?? 0)); const X = ok.map((x) => x[k + 'X']);
    console.log('  ' + k.padEnd(11), 'win', pct(m(ok.map((x) => x[k + 'Win']))), ks.includes(ref) ? `vs ${ref} ${pct(m(d))} ± ${pct(se(d))}` : '', ' turns', m(X.map((x) => x[1])).toFixed(1), 'switches', m(X.map((x) => x[2])).toFixed(2), 'back', m(X.map((x) => x[8] ?? 0)).toFixed(2), 'items', m(X.map((x) => x[5])).toFixed(2), 'refused', X.filter((x) => x[6]).length, 'failed', X.filter((x) => x[3]).length, 'unended', X.filter((x) => !x[0]).length);
  }
  return ok;
}
const a = match('m66', '6v6, bag + NPC medicine + held items');
const b = match('m44', '4v4, bag + NPC medicine + held items');
match('b66', '6v6 same battles, version 0.15.1', 'advNoItems');
match('p66', '6v6, held items only (no bag, no NPC medicine)');
match('h66', '6v6, no held items on random teams, no bag, no medicine');
const M = ld('m66'), B = ld('b66');
for (const k of ['advItems', 'advNoItems']) { const d = []; for (const i in M) if (B[i] && !M[i].error && !B[i].error && B[i][k + 'Win'] !== undefined) d.push(M[i][k + 'Win'] - B[i][k + 'Win']); if (d.length) console.log(`now - 0.15.1 (${k}, 6v6): ${pct(m(d))} ± ${pct(se(d))} n ${d.length}`); }
const cmp = (ok, f, t, k1, k2) => { const x = ok.filter(f); if (x.length) { const d = x.map((y) => y[k1 + 'Win'] - y[k2 + 'Win']); console.log('  ' + t.padEnd(44), 'n', x.length, `${k1} ${pct(m(x.map((y) => y[k1 + 'Win'])))} ${k2} ${pct(m(x.map((y) => y[k2 + 'Win'])))} diff ${pct(m(d))} ± ${pct(se(d))}`); } };
for (const [ok, t] of [[a, '6v6'], [b, '4v4']]) if (ok) {
  console.log('\n# ' + t);
  cmp(ok, () => true, 'bag helps the advisor?', 'advItems', 'advNoItems'); cmp(ok, (x) => x.bag > 0, 'only battles with a bag', 'advItems', 'advNoItems'); cmp(ok, (x) => x.bag > 0, 'bag helps the simple rule?', 'greedyHeal', 'greedy'); cmp(ok, () => true, 'advisor vs simple rule, both with items', 'advItems', 'greedyHeal');
  cmp(ok, (x) => x.meds.length >= 2, 'NPC with 2+ medicines', 'advItems', 'greedyHeal'); cmp(ok, (x) => !x.meds.length, 'NPC without medicine', 'advItems', 'greedyHeal');
  const G = { plain: /plain/, weather: /Rain|Sun|Sand|Snow/, terrain: /Electric|Grassy|Misty|Psychic/, trickroom: /trickroom/, screens: /reflect|light/, hazards: /rocks|spikes/, tailwind: /tailwind/ };
  for (const g in G) cmp(ok, (x) => G[g].test(x.sc), g, 'advItems', 'greedyHeal');
  const ids = {}; for (const x of ok) for (const u of x.advItemsX[7] ?? []) { const id = u.split(':')[1].split('~')[0]; ids[id] = (ids[id] ?? 0) + 1; } console.log('  items the advisor used', JSON.stringify(ids));
  // same item on the same Pokémon two turns in a row
  let rep = 0, tot = 0; for (const x of ok) { const u = (x.advItemsX[7] ?? []).map((q) => [Number(q.split(':')[0]), q.split('~')[1]]); for (let i = 0; i < u.length; i++) { tot++; if (i && u[i][0] === u[i - 1][0] + 1) rep++; } } console.log('  item two turns in a row', rep, 'of', tot);
  for (const [lo, hi] of [[0, 1], [1, 3], [3, 6], [6, 10], [10, 99]]) cmp(ok, (x) => x.advItemsX[2] >= lo && x.advItemsX[2] < hi, `advisor switched ${lo}-${hi - 1} times`, 'advItems', 'greedyHeal');
}
function items(tag, title) {
  const L = Object.values(Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].flatMap((i) => { try { return fs.readFileSync(`${__dirname}/.out/${tag}_${i}.jsonl`, 'utf8').trim().split('\n').map((l, j) => [i + '-' + j, JSON.parse(l)]); } catch { return []; } })));
  if (!L.length) return; const ok = L.filter((x) => !x.error);
  console.log(`\n## ${title}: turns where an item was on offer ${ok.length}, errors ${L.length - ok.length}`, [...new Set(L.filter((x) => x.error).map((x) => x.error.slice(0, 120)))]);
  const d = (x, p, q) => m(x.val[p]) - m(x.val[q]);
  const row = (n, f, p, q) => { const x = ok.filter((y) => f(y) && y.val[p(y)] && y.val[q(y)] && p(y) !== q(y)); const v = x.map((y) => d(y, p(y), q(y))); console.log('  ' + n.padEnd(60), 'n', String(x.length).padStart(4), (m(v) >= 0 ? '+' : '') + m(v).toFixed(3), '±', se(v).toFixed(3), 'worse in', pct(m(v.map((z) => (z < -0.03 ? 1 : 0)))) + '%'); };
  const used = (x) => x.choice === x.item;
  row('advisor PICKED the item: item minus its best non-item', used, (x) => x.item, (x) => x.noItem);
  for (const re of ['superpotion', 'hyperpotion', 'maxpotion', 'fullrestore', 'fullheal', 'revive~', 'maxrevive', 'paralyzeheal', 'awakening', 'ether']) row('   picked ' + re, (x) => used(x) && x.item.includes('~' + re), (x) => x.item, (x) => x.noItem);
  row('   own HP under 25%', (x) => used(x) && x.me.hp / x.me.maxHp < 0.25, (x) => x.item, (x) => x.noItem); row('   own HP 25-50%', (x) => used(x) && x.me.hp / x.me.maxHp >= 0.25 && x.me.hp / x.me.maxHp < 0.5, (x) => x.item, (x) => x.noItem); row('   own HP over 50%', (x) => used(x) && x.me.hp / x.me.maxHp >= 0.5, (x) => x.item, (x) => x.noItem);
  row('advisor did NOT pick its item: item minus its pick', (x) => x.item && !used(x), (x) => x.item, (x) => x.choice);
  row('simple rule would heal, advisor did not: heal minus its pick', (x) => x.heal && !used(x), (x) => x.heal, (x) => x.choice);
  const bad = ok.filter((x) => used(x) && x.val[x.noItem] && x.noItem !== x.item).map((x) => ({ x, v: d(x, x.item, x.noItem) })).sort((p, q) => p.v - q.v);
  const missed = ok.filter((x) => x.item && !used(x) && x.val[x.item]).map((x) => ({ x, v: d(x, x.item, x.choice) })).sort((p, q) => q.v - p.v);
  const pr = ({ x, v }) => { console.log(`  ${v.toFixed(2)} ${x.sc} T${x.turn} ${x.me.name} ${x.me.hp}/${x.me.maxHp} [${x.me.item ?? '-'},${x.me.status ?? ''}] vs ${x.foe.name} ${x.foe.hpPct}% [${x.foe.item ?? '-'}] (${x.foe.moves}) ${JSON.stringify(x.boosts)} NPC meds ${JSON.stringify(x.meds)}`); for (const r of x.reasons.slice(0, 5)) console.log(`       ${r[1]} ${r[0]} | ${r[2].slice(0, 120)}`); };
  console.log('  worst item uses'); bad.slice(0, 5).forEach(pr); console.log('  worst missed items'); missed.slice(0, 5).forEach(pr);
}
items('i66', '6v6 item decisions'); items('i44', '4v4 item decisions');
