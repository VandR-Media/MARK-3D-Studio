import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const root=new URL('../',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');
const removeLocalImports=code=>code.replace(/^import .* from '\.\/[^']+';\s*$/gm,'');
const removeExports=code=>code.replace(/^export /gm,'');
const inline=[
 removeExports(read('src/glb.js')),
 removeExports(read('src/materials.js')),
 removeExports(removeLocalImports(read('src/sample.js'))),
 removeLocalImports(read('src/app.js')),
].join('\n\n');
if(inline.includes('</script>'))throw new Error('Inline JavaScript contains a closing script tag.');
const result=read('index.html')
 .replace(/<link rel="stylesheet" href="\.\/src\/styles\.css"\s*\/?>/,'<style>\n'+read('src/styles.css')+'\n</style>')
 .replace(/<script type="module" src="\.\/src\/app\.js"><\/script>/,'<script type="module">\n'+inline+'\n</script>');
if(result.includes('src="./src/app.js"')||result.includes('href="./src/styles.css"'))
 throw new Error('Standalone template replacement failed.');
mkdirSync(new URL('dist/',root),{recursive:true});
writeFileSync(new URL('dist/MARK-3D-Studio-standalone.html',root),result);
console.log('Portable HTML created; Three.js still uses jsDelivr network.');
