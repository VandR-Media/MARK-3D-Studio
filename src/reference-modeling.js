/**
 * MARK Face Reference Modeling — safe explicit 2D facial landmark alignment.
 * No photographs are stored/uploaded. The caller supplies calibrated normalized
 * 2D landmarks from approved private references; face vertices remain in 3D.
 */
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const pt2=a=>Array.isArray(a)&&a.length===2&&a.every(finite);
function verifyView(config){
 if(!config||!['front','left','right','threequarter-left','threequarter-right'].includes(config.view))
  throw Error('Reference view must be calibrated front/left/right/threequarter');
 const scale=config.scale??.3,offset=config.offset??[.5,.5];
 if(!finite(scale)||scale<=0||scale>5||!pt2(offset))throw Error('Invalid reference scale/offset');
 return {view:config.view,scale,offset};
}
export function projectPoint(point,config){
 const {view,scale,offset}=verifyView(config);
 if(!Array.isArray(point)||point.length!==3||point.some(x=>!finite(x)))
  throw Error('Reference projection needs XYZ position');
 const [x,y,z]=point;
 const u={front:x,left:-z,right:z,
  'threequarter-left':(x-z)/Math.SQRT2,
  'threequarter-right':(x+z)/Math.SQRT2}[view];
 return [offset[0]+u*scale,offset[1]-y*scale];
}
export function configureLandmarks(mesh,settings){
 const {view}=verifyView(settings);
 if(!settings.points||typeof settings.points!=='object'||Array.isArray(settings.points))
  throw Error('Expected reference points object');
 const entries=Object.entries(settings.points);
 if(!entries.length||entries.length>100)throw Error('Expected 1–100 reference control points');
 const pts={};
 for(const [name,p] of entries){
  if(!mesh.landmarks?.[name])throw Error('Unknown 3D landmark '+name);
  if(!pt2(p)||p.some(x=>x<0||x>1))throw Error('Reference landmark must use normalized UV 0..1: '+name);
  pts[name]=[...p];
 }
 mesh.referenceViews[view]={view,scale:settings.scale??.3,offset:settings.offset??[.5,.5],points:pts};
 return {view,linkedLandmarks:entries.length};
}
export function compareReference(mesh,view){
 const ref=mesh.referenceViews?.[view];if(!ref)throw Error('Reference has not been calibrated: '+view);
 const measured={};let error=0,n=0;
 for(const [name,target] of Object.entries(ref.points)){
  const anchor=mesh.landmarks?.[name],vertex=mesh.vertices.get(anchor?.vertex);
  if(!vertex)throw Error('Lost landmark vertex '+name);
  const actual=projectPoint(vertex.position,ref);
  const du=target[0]-actual[0],dv=target[1]-actual[1];
  measured[name]={projected:actual,target,delta:[du,dv],error:Math.hypot(du,dv)};
  error+=du*du+dv*dv;n++;
 }
 return {view,points:n,rmse:Math.sqrt(error/n),measurements:measured};
}
export function adjustReferencePoint(mesh,{view,name,radius=.16,strength=1,symmetry=false}={}){
 const ref=mesh.referenceViews?.[view];if(!ref)throw Error('Unconfigured view '+view);
 const target=ref.points[name],anchor=mesh.landmarks?.[name],v=mesh.vertices.get(anchor?.vertex);
 if(!target||!v)throw Error('Missing linked landmark '+name);
 const projected=projectPoint(v.position,ref),dx=(target[0]-projected[0])/ref.scale,
  dy=-(target[1]-projected[1])/ref.scale;
 const delta={front:[dx,dy,0],left:[0,dy,-dx],right:[0,dy,dx],
  'threequarter-left':[dx/Math.SQRT2,dy,-dx/Math.SQRT2],
  'threequarter-right':[dx/Math.SQRT2,dy,dx/Math.SQRT2]}[view];
 if(Math.hypot(...delta)>.16)throw Error('Reference correction >0.16 scene units, split into smaller adjustments');
 const result=mesh.brush({center:v.position,radius,strength,symmetry,delta,mode:'grab'});
 return {name,view,requestedDelta:delta,...result};
}
