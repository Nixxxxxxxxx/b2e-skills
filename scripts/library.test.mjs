import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, cp, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { buildLibrary, loadLibrary, parseSkill, assertPublicText, sha256 } from './library.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const temp=()=>mkdtemp(path.join(tmpdir(),'b2e-skills-test-'));
test('all eleven skills are independently packaged and fully linked',async()=>{
  const {catalog,skills}=await loadLibrary(root);assert.equal(catalog.categories.length,5);assert.equal(skills.length,11);
  for(const s of skills){assert.ok(s.body.length>500);assert.ok(s.files.length>2);assert.equal(s.version,'2.0.0');}
});
test('invalid metadata and source-like text are rejected',()=>{
  assert.throws(()=>parseSkill('no metadata'));
  const fm='---\nname: demo\ndescription: "Demo"\nmetadata:\n  version: "2.0.0"\n  language: "ru"\n---\nBody';
  assert.equal(parseSkill(fm).name,'demo');
  for(const broken of [fm.replace('metadata:', 'name: duplicate\nmetadata:'),fm.replace('  version:', ' version:'),fm.replace('"Demo"','"broken "quote""')])assert.throws(()=>parseSkill(broken));
  for(const text of ['b2e-source:abcd','/Users/person/file','https://private.invalid/source','-----BEGIN RSA PRIVATE KEY'])assert.throws(()=>assertPublicText(text,'test'));
});
test('duplicates, missing references and symlinks fail before export',async()=>{
  const copy=await temp();await cp(root,copy,{recursive:true,filter:p=>!p.includes('/.git')&&!p.includes('/dist')});
  const catalog=JSON.parse(await readFile(path.join(copy,'catalog.json'),'utf8'));catalog.categories[0].skills.push(catalog.categories[0].skills[0]);
  await writeFile(path.join(copy,'catalog.json'),JSON.stringify(catalog));await assert.rejects(loadLibrary(copy),/duplicate/);
  catalog.categories[0].skills.pop();await writeFile(path.join(copy,'catalog.json'),JSON.stringify(catalog));
  const skill=path.join(copy,'skills',catalog.categories[0].skills[0].slug,'SKILL.md'),original=await readFile(skill,'utf8');
  await writeFile(skill,original+'\n[missing](references/not-there.md)');await assert.rejects(loadLibrary(copy),/Broken/);
  await writeFile(skill,original);await symlink('/tmp',path.join(copy,'skills',catalog.categories[0].skills[0].slug,'escape'));await assert.rejects(loadLibrary(copy),/Symlink/);
});
test('release is reproducible, self-contained and preserves five legacy archives',async()=>{
  const workspace=await temp(),a=path.join(workspace,'a'),b=path.join(workspace,'b');
  const m=await buildLibrary(root,a);await buildLibrary(root,b);assert.equal(m.skillCount,11);assert.equal(m.artifacts.length,27);
  assert.deepEqual(await readFile(path.join(a,'manifest.json')),await readFile(path.join(b,'manifest.json')));
  const {skills}=await loadLibrary(root);
  for(const item of m.artifacts){
    const bytes=await readFile(path.join(a,item.path));assert.equal(sha256(bytes),item.sha256);assert.equal(bytes.length,item.bytes);
    assert.deepEqual(bytes,await readFile(path.join(b,item.path)));
    if(item.kind==='markdown'){
      const text=bytes.toString();assert.ok(!/\]\((?!#)/.test(text));
      const ids=new Set([...text.matchAll(/<a id="([^"]+)"/g)].map(x=>x[1]));
      for(const [,anchor] of text.matchAll(/\]\(#([^)]+)\)/g))assert.ok(ids.has(anchor),anchor);
      for(const s of skills.filter(s=>s.category===item.category)){
        assert.ok(text.includes(s.body.split('\n')[0]));
        for(const f of s.files)assert.ok(ids.has(`${s.slug}-${f.replaceAll('/','-').replace(/\.md$/,'')}`));
      }
    }
    if(['skill','category','bundle'].includes(item.kind)){
      const members=item.kind==='skill'?skills.filter(s=>s.slug===item.slug):item.kind==='category'?skills.filter(s=>s.category===item.category):skills;
      const zip=path.join(a,item.path);
      const entries=execFileSync('unzip',['-Z1',zip],{encoding:'utf8'}).trim().split('\n').sort();
      assert.deepEqual(entries,members.flatMap(s=>s.files.map(f=>`${s.slug}/${f}`)).sort());
      for(const s of members)for(const f of s.files)assert.equal(execFileSync('unzip',['-p',zip,`${s.slug}/${f}`],{encoding:'utf8'}),s.contents.get(f));
    }
    if(item.kind==='legacy-skill')assert.deepEqual(bytes,await readFile(path.join(root,'compatibility/1.0.5',item.slug+'.zip')));
  }
  await assert.rejects(buildLibrary(root,a),/EEXIST/);
});
