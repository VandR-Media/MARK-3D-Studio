/**
 * Build a fully offline file:// Huawei preview.
 * Three.js, OrbitControls, GLTFExporter and HDR loader are bundled by esbuild.
 */
import {build} from 'esbuild';
import {readFileSync,writeFileSync,mkdirSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url),read=f=>readFileSync(new URL(f,root),'utf8');
const source=read('visual-engine/Visual-Engine-v2.html'),
 css=read('visual-engine/visual-v2.css');
const result=await build({entryPoints:[new URL('src/visual-engine/ui.js',root).pathname],
 bundle:true,format:'iife',platform:'browser',target:['es2020'],minify:true,
 write:false,logLevel:'warning',legalComments:'none'});
const javascript=new TextDecoder().decode(result.outputFiles[0].contents);
if(javascript.includes('</script>'))throw Error('Bundled JS contains unsafe HTML script closer');
const sha=/^[0-9a-f]{40}$/.test(process.env.GITHUB_SHA||'')?process.env.GITHUB_SHA:'local-unverified';
const html=source
 .replace('<link rel="stylesheet" href="./visual-v2.css">','<style>\n'+css+'\n</style>')
 .replace(/<script type="importmap">[\s\S]*?<\/script>/,'')
 .replace('<script type="module" src="../src/visual-engine/ui.js"></script>','')
 .replace('<a class="small-link" href="../index.html">← Основная Studio</a>',
  '<span class="small-link">MARK Studio · offline</span>')
 .replace('</head>','<meta name="mark-visual-source-sha" content="'+sha+'"></head>')
 .replace('</body>','<script>\n'+javascript+'\n</script>\n</body>');
if(/<script[^>]+src=["']https?:|<link[^>]+href=["']https?:|type="importmap"|src="\.\.\/src\/visual-engine/.test(html))
 throw Error('Offline visual HTML still references a remote runtime');
mkdirSync(new URL('dist/',root),{recursive:true});
const target=new URL('dist/MARK-Visual-Engine-v2.html',root);
writeFileSync(target,html);
const bytes=statSync(target).size;
if(bytes<200000)throw Error('Visual HTML unexpectedly too small');
const sha256=createHash('sha256').update(readFileSync(target)).digest('hex');
writeFileSync(new URL('dist/visual-v2-build-info.json',root),JSON.stringify({
 sourceCommit:sha,sha256,bytes,offline:true,engine:'Visual Engine v2',
 requiredAssets:[],sourceRecipeRefs:['recipes/visual-v2-analog-studio.json','recipes/visual-v2-spectrum-matrix.json']
},null,2)+'\n');
console.log('MARK Visual Engine v2 OFFLINE HTML',bytes,'bytes SHA256',sha256);
