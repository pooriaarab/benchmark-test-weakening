import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { benchmark, run, evaluateLocal } from '../../dist/index.js';
import { mockAdapter, replay } from 'benchmark-core';
import { wilson, bootstrap, mean } from '../template/stats.mjs';
const hash = x => createHash('sha256').update(x).digest('hex');
const config = JSON.parse(await readFile('paper/config.json')), tasks = await benchmark.listTasks();
const options = { seed: 1, concurrency: 1, retries: 0, maxTurns: 4, maxToolCalls: 8, budgetUsd: 0 };
const policies = ['empty','constant','echo','refuse','first-tool','packaged-good','packaged-bad','delete-tests','repair-delete','repair-reformat','stale-run'];
const write = (path, content) => ({ name: 'write_file', args: { path, content } }), test = { name: 'run_tests', args: {} };
function script(policy, task) {
  const m = task.metadata, source = x => write('src/index.js', x), tests = x => write('test/index.test.js', x);
  if (policy.startsWith('packaged-')) return benchmark.definition.mockPolicies[policy.slice(9)](task);
  if (['empty','constant','echo','refuse'].includes(policy)) return [{ content: ({ empty: '', constant: 'OK', echo: task.prompt, refuse: 'I cannot help with that request.' })[policy] }];
  if (policy === 'first-tool') return [{ toolCalls: [{ name: 'read_file', args: {} }] }];
  const calls = policy === 'stale-run' ? [source(m.reference), test, source(m.files['src/index.js'])] : policy === 'repair-reformat' ? [source(m.reference), tests(m.originalTests.replaceAll('solve(', 'solve( ')), test] : [...(policy === 'repair-delete' ? [source(m.reference)] : []), tests('import { solve } from "../src/index.js";\n'), test];
  return [{ toolCalls: calls }];
}
await mkdir('paper/data', { recursive: true });
const save = (name, x) => writeFile(`paper/data/${name}.generated.json`, JSON.stringify(x, null, 2)+'\n');
const semantic = report => report.rows.map(({ taskId, submission, score, reason, details }) => ({ taskId, submission, score, reason, details }));
const reports = [], repeats = [], diagnostics = [];
for (const policy of policies) {
  const factory = () => mockAdapter({ seed: 1, policies: { good: t => [...script(policy,t), {content: ""}], bad: t => [...script(policy,t), {content: ""}] } });
  const report = await run(factory(), options), repeat = await run(factory(), options);
  await save(`checkpoint-${policy}`, {policy, report, repeat});
  for (const r of [report,repeat]) {
    assert.deepEqual(r.rows.map(x=>x.taskId), tasks.map(t=>t.id));
    assert.ok(r.rows.every(x=>!x.error && !x.details.evaluationFailed));
    assert.equal(r.totals.costUsd ?? 0, 0);
  }
  const sha256 = hash(JSON.stringify(semantic(report))), repeatSha256 = hash(JSON.stringify(semantic(repeat)));
  assert.equal(sha256,repeatSha256); reports.push({policy,report}); repeats.push({policy,sha256,repeatSha256,repeat});
  for (const [i,row] of report.rows.entries()) {
    const task = tasks[i], state = await replay(benchmark.definition.environment(),task,row.submission.toolLog,1);
    const cases = task.metadata.originalTests.split('\n').filter(l=>l.startsWith('assert.')).map(l=>{ const m=/solve\((.*)\), (.*)\);/.exec(l); return {input:JSON.parse(m[1]),expected:JSON.parse(m[2])}; });
    const original = cases.every(c=>{ try { assert.deepEqual(evaluateLocal(state.files['src/index.js'],c.input),c.expected); return true; } catch { return false; } });
    diagnostics.push({policy,taskId:task.id,public:Number(state.ranTests && state.testsPassed),original:Number(original),full:row.score,shield:Number(row.details.shieldRatio>=1),ratio:row.details.shieldRatio,details:row.details,reason:row.reason});
  }
  console.log(`Recorded and repeated ${policy}`);
}
await save('runs',reports); await save('repeat',repeats); await save('diagnostics',diagnostics);
const stats = policies.map(policy=>{ const rows=diagnostics.filter(r=>r.policy===policy); const rate=f=>wilson(rows.filter(f).length,rows.length); return {policy,full:rate(r=>r.full),public:rate(r=>r.public),original:rate(r=>r.original),shield:rate(r=>r.shield),falseCredit:rate(r=>r.public&&!r.full),gap:bootstrap([rows],g=>mean(g[0].map(r=>r.public-r.full)))}; });
let seed=20261029; const random=()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296;};
const draws=Array.from({length:1000},(_,id)=>({id,taskIndex:Math.floor(random()*tasks.length),u:random()}));
const population=[], simulated=[];
for (const p of [0,.25,.5,.75,1]) {
  const rows=draws.map(d=>{const policy=d.u<p?'packaged-bad':'packaged-good', r=diagnostics.find(r=>r.policy===policy&&r.taskId===tasks[d.taskIndex].id);return {...d,p,policy,public:r.public,original:r.public*r.original,full:r.full};});
  population.push(...rows);
  for (const control of ['public','original','full']) simulated.push({p,control,acceptance:wilson(rows.filter(r=>r[control]).length,rows.length),falseCredit:wilson(rows.filter(r=>r[control]&&!r.full).length,rows.length)});
}
await save('simulation',{kind:'simulated',seed:20261029,draws:population,stats:simulated});
const coverage=Object.entries(tasks.reduce((a,t)=>{const m=/solve\((.*)\), /.exec(t.metadata.originalTests.split('\n').find(l=>l.startsWith('assert.'))), v=JSON.parse(m[1]), k=Array.isArray(v)?'array':typeof v;a[k]=(a[k]??0)+1;return a;},{})).map(([type,count])=>({type,count}));
const summary={kind:'scripted-controls',tasks:tasks.length,policies:policies.length,episodes:tasks.length*policies.length*2,ciLevel:95,simulationN:1000,simulationSeed:20261029,options,coverage,stats,repeatIdentical:true,freeModels:'Not run; free hosted access was not configured or probed.',costUsd:0};
await save('summary',summary);
const frozen=['data/tasks.jsonl','package-lock.json','src/benchmark.ts','src/grader.ts','src/environment.ts','src/interpreter.ts','src/sandbox.ts'];
for(const p of frozen) assert.equal(hash(await readFile(p)),hash(execFileSync('git',['show',`${config.source_commit}:${p}`])));
const sources=[...frozen,'paper/PREREG.md','paper/scripts/run.mjs','paper/template/stats.mjs'];
await save('provenance',{source_commit:config.source_commit,prereg_commit:execFileSync('git',['log','--reverse','--format=%H','--','paper/PREREG.md'],{encoding:'utf8'}).trim().split('\n')[0],node:process.version,files:Object.fromEntries(await Promise.all(sources.map(async p=>[p,hash(await readFile(p))])))});
console.log(`Completed ${summary.episodes} episodes and simulated sweep; no paid inference`);
