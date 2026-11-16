/**
 * MARK Anatomical Base Mesh — experimental child-head topology prototype.
 *
 * Independent profile-driven QUAD surface (NOT contour-head-v1) with actual
 * boundary loops and recessed, QUAD-sealed surface cavities for both orbital sockets,
 * mouth and paired nostrils. Interior QUAD caps are temporary surfaces;
 * they are NOT a final riggable mouth or anatomically complete ears/eyelids.
 *
 * All polygons, rim rings and stable vertex IDs remain editable in EditableMesh.
 */
import {EditableMesh} from './professional-geometry.js';
import {closeCavityWithQuads} from './facial-cavity.js';
const TAU=2*Math.PI,gauss=(x,c,r)=>Math.exp(-.5*((x-c)/r)**2);
const wrapped=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
const profile=[
 [-1.32,.28,.30],[-1.14,.31,.34],[-.95,.46,.52],[-.68,.64,.67],
 [-.08,.82,.83],[.34,.82,.85],[.76,.73,.78],[1.05,.52,.59],[1.23,.21,.25]
];
function interpolate(y,k){
 let i=0;while(i<profile.length-2&&profile[i+1][0]<y)i++;
 const a=profile[i],b=profile[i+1],t=Math.max(0,Math.min(1,(y-a[0])/(b[0]-a[0]))),
 u=t*t*(3-2*t);
 return a[k]*(1-u)+b[k]*u;
}
const HOLES=[
 {key:'eye_right',angle:.51,y:.35,aw:.225,yw:.125,depth:.30},
 {key:'eye_left',angle:-.51,y:.35,aw:.225,yw:.125,depth:.30},
 {key:'nostril_right',angle:.16,y:-.225,aw:.068,yw:.046,depth:.19},
 {key:'nostril_left',angle:-.16,y:-.225,aw:.068,yw:.046,depth:.19},
 {key:'mouth',angle:0,y:-.52,aw:.32,yw:.055,depth:.32}
];
function point(y,a){
 const ra=interpolate(y,1),rb=interpolate(y,2);
 let x=Math.sin(a)*ra,z=Math.cos(a)*rb;
 const front=Math.max(0,Math.cos(a))**2;
 const ax=Math.abs(x);
 // Surfaces transition continuously in 3D; eye and mouth rim polygons are
 // genuinely removed and rebuilt below (unlike color-only feature markers).
 const orbital=gauss(ax,.405,.18)*gauss(y,.35,.17);
 const brow=gauss(ax,.38,.20)*gauss(y,.55,.11);
 const cheek=gauss(ax,.48,.20)*gauss(y,-.03,.21);
 const bridge=gauss(ax,0,.12)*gauss(y,.10,.30);
 const noseTip=gauss(ax,0,.13)*gauss(y,-.20,.12);
 const alar=gauss(ax,.16,.075)*gauss(y,-.25,.10);
 const lipsUpper=gauss(ax,.17,.24)*gauss(y,-.475,.065);
 const lipsLower=gauss(ax,.17,.24)*gauss(y,-.575,.065);
 const chin=gauss(ax,.10,.28)*gauss(y,-.82,.17);
 z+=front*(.042*brow-.068*orbital+.068*cheek+.115*bridge+
   .22*noseTip+.053*alar+.036*lipsUpper+.042*lipsLower+.076*chin);
 // Ear attachment regions deform the lateral face shell, rather than
 // attaching spheres on top of it. Detailed helix topology is a later step.
 const side=Math.abs(wrapped(a,Math.PI/2))<Math.abs(wrapped(a,-Math.PI/2))?1:-1;
 x+=side*.055*gauss(Math.abs(a)-Math.PI/2,0,.23)*gauss(y,-.10,.28);
 return [x,y,z];
}
function isHole(y,angle){
 for(const h of HOLES){
  const d=(wrapped(angle,h.angle)/h.aw)**2+((y-h.y)/h.yw)**2;
  if(d<1)return h.key;
 }
 return null;
}
function loopEdges(mesh){
 const startTo=new Map();
 for(const h of mesh.halfEdges.values())if(!h.twin){
  if(startTo.has(h.from))throw Error('Anatomical boundary branches at '+h.from);
  startTo.set(h.from,h.to);
 }
 const loops=[],seen=new Set();
 for(const start of startTo.keys()){
  if(seen.has(start))continue;
  const path=[],first=start;let current=start;
  do{
   if(seen.has(current)||!startTo.has(current))throw Error('Open/overlapping anatomical boundary loop');
   seen.add(current);path.push(current);current=startTo.get(current);
   if(path.length>10000)throw Error('Abnormal anatomical boundary length');
  }while(current!==first);
  if(path.length<4)throw Error('Anatomical cavity boundary is too short');
  loops.push(path);
 }
 return loops;
}
function centroid(mesh,ids){
 const p=ids.map(id=>mesh.vertices.get(id).position);
 return [0,1,2].map(k=>p.reduce((s,v)=>s+v[k],0)/p.length);
}
function labelLoop(center){
 if(center[1]>.10)return center[0]>0?'eye_right':'eye_left';
 if(center[1]<-.37)return 'mouth';
 return center[0]>0?'nostril_right':'nostril_left';
}
export function makeAnatomicalChildHead({rings=106,columns=192}={}){
 if(!Number.isInteger(rings)||rings<80||rings>200||!Number.isInteger(columns)||columns<128||columns>320)
  throw Error('Anatomical mesh rings 80..200; columns 128..320 required');
 const mesh=new EditableMesh({name:'Anatomical child head socket and mouth loops',
  material:{name:'Anatomical clay',color:[.72,.50,.42,1],metallic:0,roughness:.82}});
 const ids=[],from=-1.32,to=1.23,uv=[];
 const at=(i,j)=>ids[i*columns+(j+columns)%columns];
 for(let i=0;i<rings;i++){
  const y=from+(to-from)*i/(rings-1);
  for(let j=0;j<columns;j++){
   const a=(j<=columns/2?j:j-columns)*TAU/columns;
   const id=mesh._vertex(point(y,a),[j/columns,i/(rings-1)]);
   ids.push(id);
  }
 }
 // Main surface is QUADS; remove ellipses to construct true anatomical loops.
 for(let i=0;i<rings-1;i++)for(let j=0;j<columns;j++){
  const ym=from+(to-from)*(i+.5)/(rings-1);
  const am=((j+.5)>columns/2?(j+.5)-columns:j+.5)*TAU/columns;
  if(isHole(ym,am))continue;
  mesh._face([at(i,j),at(i,j+1),at(i+1,j+1),at(i+1,j)]);
 }
 const bottom=mesh._vertex([0,from-.065,-.005],[.5,0]),
  top=mesh._vertex([0,to+.07,-.005],[.5,1]);
 for(let j=0;j<columns;j++){
  mesh._face([bottom,at(0,j+1),at(0,j)]);
  mesh._face([top,at(rings-1,j),at(rings-1,j+1)]);
 }
 mesh._rebuild();
 const boundaries=loopEdges(mesh),landmarks={},regions={};
 if(boundaries.length!==HOLES.length)
  throw Error('Expected 5 separate orbital/nostril/oral cavities, found '+boundaries.length);
 for(const boundary of boundaries){
  const center=centroid(mesh,boundary),label=labelLoop(center);
  if(landmarks[label])throw Error('Duplicate anatomical cavity '+label);
  const params=HOLES.find(h=>h.key===label),depth=params.depth;
  regions[label+'_rim']=[...boundary];
  landmarks[label]={vertex:boundary[0],center:[...center],rim:[...boundary]};
  const {rings,capTriangles}=closeCavityWithQuads(mesh,boundary,{
   center,depth,kind:label.startsWith('eye')?'eye':label.startsWith('nostril')?'nostril':'mouth'
  });
  if(capTriangles!==0)throw Error('Facial cavity contains radial triangle fans');
  const span=rings[0].length;
  if(label.startsWith('eye')){
   const side=label.endsWith('_left')?'left':'right';
   regions['eye_'+side]=rings.slice(0,4).flat();
   regions['upper_eyelid_'+side]=rings.slice(0,3).flatMap(r=>r.filter(id=>mesh.vertices.get(id).position[1]>=center[1]));
   regions['lower_eyelid_'+side]=rings.slice(0,3).flatMap(r=>r.filter(id=>mesh.vertices.get(id).position[1]<center[1]));
  }else if(label.startsWith('nostril')){
   regions['nose_alar_'+(label.endsWith('_left')?'left':'right')]=rings.slice(0,3).flat();
  }else{
   regions.mouth_upper_lip=rings.slice(0,3).flatMap(r=>r.filter(id=>mesh.vertices.get(id).position[1]>=center[1]));
   regions.mouth_lower_lip=rings.slice(0,3).flatMap(r=>r.filter(id=>mesh.vertices.get(id).position[1]<center[1]));
   const mouthExtent=Math.max(...boundary.map(id=>Math.abs(mesh.vertices.get(id).position[0]-center[0])));
   regions.mouth_corners=boundary.filter(id=>Math.abs(mesh.vertices.get(id).position[0]-center[0])>=.58*mouthExtent);
  }
 }
 mesh._rebuild();
 // Named ID-based geometry anchors survive ordinary positional sculpting,
 // project save/load and delta history; topology changes must explicitly remap.
 for(const [name,p] of Object.entries({
  nose_bridge:[0,.16,.94],nose_tip:[0,-.19,1.02],
  chin:[0,-.83,.78],cheek_left:[-.49,-.06,.74],cheek_right:[.49,-.06,.74],
  brow_left:[-.4,.57,.72],brow_right:[.4,.57,.72]
 })){
  let min=Infinity,best=null;
  for(const v of mesh.vertices.values()){
   const d=Math.hypot(...p.map((x,i)=>x-v.position[i]));
   if(d<min){min=d;best=v.id;}
  }
  landmarks[name]={vertex:best,center:[...mesh.vertices.get(best).position]};
 }
 // Named vertex clusters for local programmatic modeling; no detached spheres.
 const pick=(name,test)=>{const ids=[...mesh.vertices.values()].filter(v=>test(v.position)).map(v=>v.id);if(ids.length)regions[name]=ids;};
 pick('nose_bridge',p=>Math.abs(p[0])<.12&&p[1]>.02&&p[1]<.35&&p[2]>.72);
 pick('nose_tip',p=>Math.abs(p[0])<.17&&p[1]>-.35&&p[1]<-.12&&p[2]>.78);
 pick('cheeks',p=>Math.abs(p[0])>.32&&Math.abs(p[0])<.65&&p[1]>-.24&&p[1]<.19&&p[2]>.40);
 pick('chin',p=>Math.abs(p[0])<.34&&p[1]>-1.03&&p[1]<-.70&&p[2]>.39);
 pick('jaw',p=>Math.abs(p[0])>.28&&p[1]>-1.10&&p[1]<-.55);
 mesh.landmarks=landmarks;mesh.regions=regions;
 mesh.validate({strict:true});
 const diag=mesh.inspect();
 if(diag.boundaryEdges||diag.nonManifoldEdges||diag.degenerateFaces)
  throw Error('Anatomical base mesh integrity failed '+JSON.stringify(diag));
 return mesh;
}
