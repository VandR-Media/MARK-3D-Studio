import {build} from 'esbuild';
import {readFileSync,writeFileSync,mkdirSync,statSync} from 'node:fs';
const root=new URL('../',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');
const bundle=await build({
  entryPoints:[new URL('src/app.js',root).pathname],
  bundle:true,platform:'browser',format:'iife',target:['es2020'],
  minify:true,legalComments:'none',write:false,logLevel:'warning'
});
const script=new TextDecoder().decode(bundle.outputFiles[0].contents);
if(script.includes('</script>'))throw new Error('JavaScript contains closing script tag.');
let html=read('index.html')
 .replace(/<link rel="stylesheet" href="\.\/src\/styles\.css"\s*\/?>/, () => '<style>\n'+read('src/styles.css')+'\n</style>')
 .replace(/<script type="importmap">[\s\S]*?<\/script>/,'')
 .replace(/<script type="module" src="\.\/src\/app\.js"><\/script>/,'')
 .replace('</body>', () => '<script>\n'+script+'\n</script>\n</body>');
if(/cdn\.jsdelivr\.net|type="importmap"|src="\.\/src\/app\.js"|href="\.\/src\/styles\.css"/.test(html))
 throw new Error('Offline output still references external resources.');
mkdirSync(new URL('dist/',root),{recursive:true});
const output=new URL('dist/MARK-3D-Studio-standalone.html',root);
writeFileSync(output,html);
const bytes=statSync(output).size;
if(bytes<200000)throw new Error('Bundled HTML unexpectedly small: '+bytes);
console.log('OFFLINE HTML built: '+bytes+' bytes. No CDN; all JavaScript embedded.');
