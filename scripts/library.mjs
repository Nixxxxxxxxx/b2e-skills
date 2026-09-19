import { readFile, readdir, lstat, mkdir, mkdtemp, copyFile, writeFile, utimes } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const sha256 = data => createHash('sha256').update(data).digest('hex');
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const semver = /^\d+\.\d+\.\d+$/;
const localLinks = text => [...text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map(m => m[1]);
export function parseSkill(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error('Missing YAML frontmatter');
  // Deliberately narrow YAML subset: no ambiguous indentation, duplicate keys or aliases.
  if (!/^name: [a-z0-9-]+\ndescription: "[^\n]*"\nmetadata:\n  version: "[^"]+"\n  language: "ru"$/.test(match[1])) throw new Error('Unsupported frontmatter structure');
  const name = match[1].match(/^name: ([a-z0-9-]+)$/m)?.[1];
  const description = match[1].match(/^description: (".*")$/m)?.[1];
  const version = match[1].match(/^  version: "([^"]+)"$/m)?.[1];
  if (!name || !slugPattern.test(name) || name.length > 64) throw new Error('Invalid skill name');
  if (!description || !version || !semver.test(version)) throw new Error(`${name}: description/version missing`);
  const decoded = JSON.parse(description);
  if (!decoded.trim() || decoded.length > 1024) throw new Error(`${name}: invalid description`);
  return { name, description: decoded, version, body: match[2].trim() };
}
export function assertPublicText(text, label) {
  if (/https?:\/\/|file:\/\/|\/Users\/|\/home\/|b2e-source:|PRIVATE-SOURCE|-----BEGIN .*PRIVATE KEY|(?:ghp|github_pat)_[A-Za-z0-9_]+/i.test(text)) {
    throw new Error(`${label}: private path, source identifier, URL or secret-like data`);
  }
}
async function walk(dir, prefix = '') {
  const result = [];
  for (const entry of (await readdir(dir)).sort()) {
    const rel = prefix ? `${prefix}/${entry}` : entry;
    const stat = await lstat(path.join(dir, entry));
    if (stat.isSymbolicLink()) throw new Error(`Symlink not allowed: ${rel}`);
    if (stat.isDirectory()) result.push(...await walk(path.join(dir, entry), rel));
    else if (stat.isFile()) result.push(rel);
    else throw new Error(`Unsupported entry: ${rel}`);
  }
  return result;
}
export async function loadLibrary(root) {
  const catalog = JSON.parse(await readFile(path.join(root, 'catalog.json'), 'utf8'));
  if (catalog.format !== 'b2e-skills-catalog-v2' || !semver.test(catalog.version) || catalog.categories.length !== 5) throw new Error('Invalid catalog');
  const ids = new Set(), slugs = new Set(), legacy = new Set(), skills = [];
  for (const category of catalog.categories) {
    for (const [value,set] of [[category.id,ids],[category.legacySlug,legacy]]) {
      if (!slugPattern.test(value) || set.has(value)) throw new Error('Invalid/duplicate category'); set.add(value);
    }
    if (!category.title || !category.skills.length) throw new Error('Empty category');
    for (const item of category.skills) {
      if (!slugPattern.test(item.slug) || slugs.has(item.slug) || !item.title || !item.example) throw new Error('Invalid/duplicate skill');
      slugs.add(item.slug);
      const dir = path.join(root, 'skills', item.slug);
      if ((await lstat(dir)).isSymbolicLink()) throw new Error('Skill symlink not allowed');
      const files = await walk(dir), contents = new Map();
      for (const file of files) {
        if (!/^(SKILL\.md|references\/[a-z0-9-]+\.md|agents\/openai\.yaml)$/.test(file)) throw new Error(`Unexpected skill file: ${file}`);
        const text = await readFile(path.join(dir,file), 'utf8'); assertPublicText(text, `${item.slug}/${file}`); contents.set(file,text);
      }
      const raw = contents.get('SKILL.md');
      const meta = parseSkill(raw ?? '');
      if (meta.name !== item.slug || meta.version !== catalog.version) throw new Error('Name/version mismatch');
      const reached = new Set(['SKILL.md']);
      for (const file of reached) {
        for (const link of localLinks(contents.get(file))) {
          if (link.startsWith('#')) continue;
          const target = path.posix.normalize(path.posix.join(path.posix.dirname(file),link.split('#')[0]));
          if (!contents.has(target) || target.startsWith('../')) throw new Error(`Broken/local escape link: ${item.slug}/${file}: ${link}`);
          reached.add(target);
        }
      }
      if (files.some(f=>f.startsWith('references/') && !reached.has(f))) throw new Error(`${item.slug}: orphan reference`);
      skills.push({...item, ...meta, category:category.id, files, contents});
    }
  }
  const actual = (await readdir(path.join(root,'skills'))).sort();
  if (JSON.stringify(actual)!==JSON.stringify([...slugs].sort())) throw new Error('Uncatalogued skill directory');
  return {catalog, skills};
}
function renderSkill(skill) {
  const anchor = file => `${skill.slug}-${file.replaceAll('/','-').replace(/\.md$/,'')}`;
  return ['SKILL.md',...skill.files.filter(f=>f.startsWith('references/'))].map(file=> {
    let text = file==='SKILL.md'?skill.body:skill.contents.get(file).trim();
    text = text.replace(/\[([^\]]*)\]\(([^)]+)\)/g, (_,label,link)=> {
      if(link.startsWith('#'))return `[${label}](${link})`;
      const target=path.posix.normalize(path.posix.join(path.posix.dirname(file),link.split('#')[0]));
      return `[${label}](#${anchor(target)})`;
    });
    return `<a id="${anchor(file)}"></a>\n\n${text}`;
  }).join('\n\n---\n\n');
}
export function renderCategory(category, skills, version) {
  const intro = `---\ntitle: ${JSON.stringify(category.title)}\nsummary: ${JSON.stringify('Самостоятельные инструкции: '+category.skills.map(s=>s.title.toLowerCase()).join('; '))}\nversion: "${version}"\nlanguage: "ru"\n---\n\n# ${category.title}\n\n## Как использовать\n\nЭто полная Markdown-версия категории. Выберите одну задачу ниже и применяйте только соответствующую инструкцию. Подробности уже включены в документ: ссылки ведут внутрь него, отдельные файлы и другие скиллы не нужны. Не выполняйте всю категорию как последовательный процесс.\n\n`;
  return intro+skills.map(s=>`- [${s.title}](#${s.slug}-SKILL)`).join('\n')+'\n\n'+skills.map(renderSkill).join('\n\n---\n\n')+'\n';
}
export async function buildLibrary(root, output) {
  const {catalog, skills} = await loadLibrary(root);
  await mkdir(output); // Fresh destination: never merge a new release into stale artifacts.
  const stage = await mkdtemp(path.join(tmpdir(),'b2e-skills-build-'));
  const artifacts = [];
  const add = async (rel,kind,extra={}) => {
    const bytes = await readFile(path.join(output,rel));
    artifacts.push({path:rel,kind,version:catalog.version,bytes:bytes.length,sha256:sha256(bytes),...extra});
  };
  for (const skill of skills) for (const file of skill.files) {
    const dest=path.join(stage,skill.slug,file); await mkdir(path.dirname(dest),{recursive:true});
    await writeFile(dest,skill.contents.get(file)); await utimes(dest,946684800,946684800);
  }
  const zip = async (rel,list) => {
    await mkdir(path.dirname(path.join(output,rel)),{recursive:true});
    const entries=list.flatMap(s=>s.files.map(f=>`${s.slug}/${f}`)).sort();
    execFileSync('zip',['-X','-q',path.resolve(output,rel),...entries],{cwd:stage,env:{...process.env,TZ:'UTC'}});
  };
  for(const skill of skills){const rel=`skills/${skill.slug}.zip`;await zip(rel,[skill]);await add(rel,'skill',{slug:skill.slug});}
  for(const category of catalog.categories){
    const members=skills.filter(s=>s.category===category.id), md=`md/${category.legacySlug}.md`, archive=`skills/categories/${category.id}.zip`;
    await mkdir(path.dirname(path.join(output,md)),{recursive:true});await writeFile(path.join(output,md),renderCategory(category,members,catalog.version));
    await add(md,'markdown',{category:category.id,slug:category.legacySlug});await zip(archive,members);await add(archive,'category',{category:category.id});
  }
  await zip('skills/b2e-skills.zip',skills);await add('skills/b2e-skills.zip','bundle');
  const compatibility = JSON.parse(await readFile(path.join(root,'compatibility/1.0.5/manifest.json'),'utf8'));
  for(const legacy of compatibility.archives){
    if(!catalog.categories.some(c=>c.legacySlug===legacy.slug))throw new Error('Unknown compatibility slug');
    const file=`${legacy.slug}.zip`, src=path.join(root,'compatibility/1.0.5',file), data=await readFile(src);
    if(sha256(data)!==legacy.sha256)throw new Error('Compatibility hash mismatch');
    const entries=execFileSync('unzip',['-Z1',src],{encoding:'utf8'}).trim().split('\n');
    if(entries.length!==1||entries[0]!==`${legacy.slug}/SKILL.md`)throw new Error('Invalid compatibility archive');
    assertPublicText(execFileSync('unzip',['-p',src,entries[0]],{encoding:'utf8'}),file);
    const rel=`skills/${file}`;await copyFile(src,path.join(output,rel));await add(rel,'legacy-skill',{slug:legacy.slug,version:'1.0.5'});
  }
  if(compatibility.archives.length!==5)throw new Error('Expected five compatibility archives');
  if (new Set(artifacts.map(a=>path.basename(a.path))).size!==artifacts.length) throw new Error('Release asset filenames must be unique');
  const manifest={format:'b2e-skills-release-v2',version:catalog.version,prerelease:true,skillCount:skills.length,categories:catalog.categories,artifacts:artifacts.sort((a,b)=>a.path.localeCompare(b.path,'en'))};
  await writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  return manifest;
}
