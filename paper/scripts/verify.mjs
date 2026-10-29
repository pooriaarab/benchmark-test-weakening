import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {benchmark} from '../../dist/index.js';
import {wilson,bootstrap,mean} from '../template/stats.mjs';
const read=async n=>JSON.parse(await readFile(`paper/${n}`)), hash=x=>createHash('sha256').update(x).digest('hex');
const s=await read('data/summary.generated.json'), runs=await read('data/runs.generated.json'), repeats=await read('data/repeat.generated.json'), d=await read('data/diagnostics.generated.json'), sim=await read('data/simulation.generated.json'), p=await read('data/provenance.generated.json'), c=await read('config.json'), meta=await read('meta.json');
const tasks=await benchmark.listTasks(), semantic=r=>r.rows.map(({taskId,submission,score,reason,details})=>({taskId,submission,score,reason,details}));
assert.equal(s.episodes,tasks.length*runs.length*2); assert.equal(meta.title,c.title); assert.ok(meta.abstract.length<=1920 && /^[\x00-\x7f]*$/.test(meta.abstract)); assert.equal(meta.license,'CC-BY-4.0');
for(const [file,digest] of Object.entries(p.files)) assert.equal(hash(await readFile(file)),digest,file);
assert.equal(p.source_commit,c.source_commit); assert.ok(execFileSync('git',['show',`${p.prereg_commit}:paper/PREREG.md`]).length>0);
for(const {policy,report} of runs){
  const repeat=repeats.find(x=>x.policy===policy), rows=d.filter(x=>x.policy===policy), stat=s.stats.find(x=>x.policy===policy);
  assert.equal(hash(JSON.stringify(semantic(report))),repeat.sha256); assert.equal(hash(JSON.stringify(semantic(repeat.repeat))),repeat.repeatSha256); assert.equal(repeat.sha256,repeat.repeatSha256);
  for(const key of ['full','public','original','shield']) assert.deepEqual(stat[key],wilson(rows.filter(r=>r[key]).length,rows.length));
  assert.deepEqual(stat.falseCredit,wilson(rows.filter(r=>r.public&&!r.full).length,rows.length)); assert.deepEqual(stat.gap,bootstrap([rows],g=>mean(g[0].map(r=>r.public-r.full))));
  for(const row of report.rows){ const scored=await benchmark.score(tasks.find(t=>t.id===row.taskId),row.submission,{seed:1}); assert.equal(scored.score,row.score); assert.deepEqual(scored.details,row.details); assert.equal(rows.find(r=>r.taskId===row.taskId).full,row.score); }
}
for(const stat of sim.stats){const rows=sim.draws.filter(r=>r.p===stat.p);assert.equal(rows.length,s.simulationN);assert.deepEqual(stat.acceptance,wilson(rows.filter(r=>r[stat.control]).length,rows.length));assert.deepEqual(stat.falseCredit,wilson(rows.filter(r=>r[stat.control]&&!r.full).length,rows.length));}
for(const r of sim.draws){assert.equal(r.policy,r.u<r.p?'packaged-bad':'packaged-good');const actual=d.find(x=>x.policy===r.policy&&x.taskId===tasks[r.taskIndex].id);assert.equal(r.public,actual.public);assert.equal(r.original,actual.public*actual.original);assert.equal(r.full,actual.full);}
const pdf=`paper/${meta.artifact_name}`, info=execFileSync('pdfinfo',[pdf],{encoding:'utf8'}), pages=Number(/Pages:\s+(\d+)/.exec(info)[1]);assert.ok(pages>=8);
const text=execFileSync('pdftotext',[pdf,'-'],{encoding:'utf8'});assert.ok(text.includes('simulated'));assert.ok(!/[\u2014]/.test(await readFile('paper/paper.tex','utf8')));assert.ok(!/undefined references|undefined citations|Overfull/.test(await readFile('paper/paper.log','utf8')));
await mkdir('artifacts',{recursive:true});const result={pages,policies:runs.length,replayedScores:d.length,episodes:s.episodes,simulatedRows:sim.draws.length,source_commit:p.source_commit,prereg_commit:p.prereg_commit,pdf_sha256:hash(await readFile(pdf)),result:'pass'};await writeFile('artifacts/paper-verification.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
