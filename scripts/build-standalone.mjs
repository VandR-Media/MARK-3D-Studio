import {build} from 'esbuild';
import {readFileSync,writeFileSync,mkdirSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
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
 .replace('href="./visual-engine/Visual-Engine-v2.html"','href="./MARK-Visual-Engine-v2.html"')
 .replace(/<script type="importmap">[\s\S]*?<\/script>/,'')
 .replace(/<script type="module" src="\.\/src\/app\.js"><\/script>/,'')
 .replace('</body>', () => '<script>\n'+script+'\n</script>\n</body>');
const sha=/^[0-9a-f]{40}$/.test(process.env.GITHUB_SHA||'')?process.env.GITHUB_SHA:'local-unverified';
html=html.replace('</head>',()=>'<meta name="mark-source-commit" content="'+sha+'">\n</head>');
if(/cdn\.jsdelivr\.net|type="importmap"|src="\.\/src\/app\.js"|href="\.\/src\/styles\.css"/.test(html))
 throw new Error('Offline output still references external resources.');
mkdirSync(new URL('dist/',root),{recursive:true});
const output=new URL('dist/MARK-3D-Studio-standalone.html',root);
writeFileSync(output,html);
const bytes=statSync(output).size;
const hash=createHash('sha256').update(readFileSync(output)).digest('hex');
writeFileSync(new URL('dist/build-info.json',root),
 JSON.stringify({sourceCommit:sha,htmlSha256:hash,source:'GitHub Actions commit or local-unverified',version:JSON.parse(read('package.json')).version},null,2)+'\n');
if(bytes<200000)throw new Error('Bundled HTML unexpectedly small: '+bytes);
console.log('OFFLINE HTML built: '+bytes+' bytes. No CDN; all JavaScript embedded.');
