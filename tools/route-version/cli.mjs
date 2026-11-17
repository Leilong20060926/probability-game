#!/usr/bin/env node
// 精確分析 CLI。改參數只影響這次計算輸出，不會改到正式遊戲或進行中的局。
//
//   node tools/route-version/cli.mjs --scenario base --format json
//   node tools/route-version/cli.mjs --scenario all --format text
//   node tools/route-version/cli.mjs --set deck.R=4 --set handLimit=4 --format json
//   node tools/route-version/cli.mjs --scenario base --simulate 100000 --map-runs 200000 --seed 20261118

import { writeFileSync } from 'node:fs';
import { SCENARIOS, makeConfig, scenarioConfig } from '../../shared/route-config.js';
import { analyze, serializeAnalysis, RouteSolver, TIE_ORDERS, DEFAULT_TIE_ORDER } from '../../shared/route-analysis.js';
import { simulateGames, simulateMap } from './simulate.mjs';

function parseArgs(argv) {
  const args = { scenario: 'base', format: 'json', set: [], tieOrder: DEFAULT_TIE_ORDER, simulate: 0, mapRuns: 0, seed: 20261118, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--scenario') args.scenario = next();
    else if (a === '--format') args.format = next();
    else if (a === '--set') args.set.push(next());
    else if (a === '--tie-order') args.tieOrder = next();
    else if (a === '--simulate') args.simulate = Number(next());
    else if (a === '--map-runs') args.mapRuns = Number(next());
    else if (a === '--seed') args.seed = Number(next());
    else if (a === '--out') args.out = next();
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`未知參數 ${a}`);
  }
  return args;
}

function parseValue(raw) {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  if (/^-?\d+$/.test(raw)) return Number(raw);
  if (raw.includes(',')) return raw.split(',').map(s => s.trim());
  return raw;
}

// --set deck.R=4、--set maps.1.B=HV,HV、--set forceBranch=A
function patchFromSets(sets) {
  const patch = {};
  for (const item of sets) {
    const eq = item.indexOf('=');
    if (eq < 0) throw new Error(`--set 需要 key=value：${item}`);
    const path = item.slice(0, eq).split('.');
    let value = parseValue(item.slice(eq + 1));
    if (path[0] === 'maps' && (path[2] === 'A' || path[2] === 'B') && !Array.isArray(value)) value = [value];
    let node = patch;
    path.slice(0, -1).forEach(k => { node = node[k] ??= {}; });
    node[path.at(-1)] = value;
  }
  return patch;
}

function configsToRun(args) {
  if (args.set.length) return [['custom', makeConfig(patchFromSets(args.set))]];
  if (args.scenario === 'all') return Object.keys(SCENARIOS).map(name => [name, scenarioConfig(name)]);
  return [[args.scenario, scenarioConfig(args.scenario)]];
}

function textReport(name, r) {
  const lines = [`== ${name}  (${r.configId}, tieOrder=${r.tieOrder}, ${r.stats.ms} ms, ${r.stats.states} states)`];
  r.perMap.forEach(m => lines.push(`  p${m.mapId} = ${m.p.numerator}/${m.p.denominator} ≈ ${m.p.decimal}   actions ${m.expectedActions}`));
  lines.push(`  p  = ${r.p.numerator}/${r.p.denominator} ≈ ${r.p.decimal}`);
  r.pmf.forEach((x, i) => lines.push(`  P(X=${x.score}) = ${x.prob.numerator}/${x.prob.denominator} ≈ ${x.prob.decimal}   F(${x.score}) ≈ ${r.cdf[i].prob.decimal}`));
  lines.push(`  E = ${r.E.decimal}   E2 = ${r.E2.decimal}   Var = ${r.Var.decimal}   P(S) = ${r.PS.decimal}`);
  lines.push(`  expected actions: per map ${r.expectedActions.perMapAverage}, per game ${r.expectedActions.perGame}`);
  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`用法：node tools/route-version/cli.mjs [--scenario ${Object.keys(SCENARIOS).join('|')}|all] [--set key=value ...]
  [--format json|text] [--tie-order ${TIE_ORDERS.join('|')}] [--simulate 局數] [--map-runs 每圖次數] [--seed n] [--out 檔案]`);
    return;
  }
  if (!TIE_ORDERS.includes(args.tieOrder)) throw new Error(`--tie-order 只能是 ${TIE_ORDERS.join('、')}`);

  const results = configsToRun(args).map(([name, config]) => {
    const solver = new RouteSolver(config, { tieOrder: args.tieOrder });
    const exact = serializeAnalysis(analyze(config, { tieOrder: args.tieOrder, solver }));
    const out = { scenario: name, ...exact };
    if (args.simulate > 0 || args.mapRuns > 0) {
      const t0 = performance.now();
      out.simulation = {
        source: 'monte_carlo',
        note: '僅供驗證精確結果；95% 區間本身有約 5% 機率不含真值。',
        perMap: args.mapRuns > 0
          ? ['1', '2', '3'].map((id, k) => simulateMap(config, id, args.mapRuns, args.seed + k + 1, solver))
          : [],
        whole: args.simulate > 0 ? simulateGames(config, args.simulate, args.seed, solver) : null,
      };
      out.simulation.ms = Math.round(performance.now() - t0);
    }
    return out;
  });

  const payload = results.length === 1 ? results[0] : { scenarios: results };
  const text = args.format === 'text'
    ? results.map(r => textReport(r.scenario, r) + (r.simulation ? `\n  simulation: ${JSON.stringify(r.simulation)}` : '')).join('\n\n')
    : JSON.stringify(payload, null, 2);

  if (args.out) writeFileSync(args.out, text + '\n');
  else console.log(text);
}

try {
  main();
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
}
