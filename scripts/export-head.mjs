import {writeFileSync,mkdirSync} from 'node:fs';
import {createTestHeadGlb} from '../src/head-fixture.js';
import {MeshEditor} from '../src/mesh-core.js';
const dir=new URL('../samples/',import.meta.url);mkdirSync(dir,{recursive:true});
const before=createTestHeadGlb();writeFileSync(new URL('organic-head-before.glb',dir),before);
const e=new MeshEditor(before);
let tip=0,score=Infinity;
for(let i=0;i<e.count;i++){
 const j=i*3, x=e.positions[j],y=e.positions[j+1],z=e.positions[j+2];
 const d=x*x+(y+.1)**2+(z-1.1)**2;
 if(d<score){score=d;tip=i;}
}
e.transform([tip],'move','z',.08,true);
e.begin();e.brush([0,-.1,1.05],.38,.8,'grab',[0,0,.095],true);e.commit();
writeFileSync(new URL('organic-head-edited.glb',dir),e.exportGlb());
console.log('Generated organic practice head before/after; vertices:',e.count,'triangles:',e.triangleCount);
