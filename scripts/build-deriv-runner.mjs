import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
let ts;
try { ts = createRequire(import.meta.url)('typescript'); }
catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
  ts = createRequire(new URL('../vercel/package.json', import.meta.url))('typescript');
}
const root=fileURLToPath(new URL('..',import.meta.url));
const directory=path.join(root,'cloud-runner/runtime');
fs.mkdirSync(directory,{recursive:true});
for(const file of ['types','client','strategy','session-fvg','engine']){
  const source=fs.readFileSync(path.join(root,'lib/deriv/'+file+'.ts'),'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
  fs.writeFileSync(directory+'/'+file+'.js','// Generated from lib/deriv/'+file+'.ts. Run node scripts/build-deriv-runner.mjs after changes.\n'+code);
}
console.log('Built dependency-free Deriv cloud runner runtime.');
