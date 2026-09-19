import { fileURLToPath } from 'node:url';
import { loadLibrary } from './library.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const {catalog,skills}=await loadLibrary(root);
console.log(JSON.stringify({valid:true,categories:catalog.categories.length,skills:skills.length,version:catalog.version}));
