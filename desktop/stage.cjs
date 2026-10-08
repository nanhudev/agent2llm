const fs=require('node:fs');const path=require('node:path');const {execFileSync}=require('node:child_process');
const dir=path.join(__dirname,'runtime');fs.mkdirSync(dir,{recursive:true});const root=path.resolve(__dirname,'..');
const product=require('./product.json');
if(product.kind==='agent'){
 execFileSync(process.execPath,[path.join(root,'node_modules','typescript','bin','tsc'),'-b',path.join(root,'tsconfig.json')],{cwd:root,stdio:'inherit'});
 require(path.join(root,'node_modules','esbuild')).buildSync({entryPoints:[path.join(root,'packages/pairs/src/index.ts')],bundle:true,platform:'node',format:'cjs',outfile:path.join(dir,'agent-core.cjs')});
 const codexRoot=path.dirname(require.resolve('@openai/codex/package.json'));
 const nativeName='@openai/codex-'+process.platform+'-'+process.arch;
 const nativeRoot=path.dirname(require('node:module').createRequire(path.join(codexRoot,'package.json')).resolve(nativeName+'/package.json'));
 const nativeDir=path.join(dir,'codex-native');fs.cpSync(nativeRoot,nativeDir,{recursive:true,force:false,errorOnExist:false});
 const targets=fs.readdirSync(path.join(nativeDir,'vendor')).filter(n=>fs.statSync(path.join(nativeDir,'vendor',n)).isDirectory());
 if(targets.length!==1)throw new Error('Expected exactly one native platform');
 fs.writeFileSync(path.join(dir,'native.json'),JSON.stringify({target:targets[0]}));

}
