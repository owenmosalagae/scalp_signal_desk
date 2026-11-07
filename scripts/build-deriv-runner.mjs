import fs from 'node:fs';
import ts from 'typescript';
const directory='cloud-runner/runtime';
fs.mkdirSync(directory,{recursive:true});
for(const file of ['types','client','strategy','engine']){
  const source=fs.readFileSync('lib/deriv/'+file+'.ts','utf8');
  const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
  fs.writeFileSync(directory+'/'+file+'.js','// Generated from lib/deriv/'+file+'.ts. Run node scripts/build-deriv-runner.mjs after changes.\n'+code);
}
console.log('Built dependency-free Deriv cloud runner runtime.');
