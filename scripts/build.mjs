import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLibrary } from './library.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const output=path.resolve(process.argv[2] ?? path.join(root,'dist'));
const result=await buildLibrary(root,output);
console.log(JSON.stringify({output,version:result.version,skills:result.skillCount,artifacts:result.artifacts.length}));
