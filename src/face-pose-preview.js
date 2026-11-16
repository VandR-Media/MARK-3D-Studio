/**
 * Non-rigged facial deformation PREVIEW for comparing real GLB shapes.
 * These are intentionally bounded partial poses, NOT proof of full eyelid
 * closure or animation-ready topology.
 */
const valid=x=>typeof x==='number'&&Number.isFinite(x);
export function previewFacialPose(mesh,{pose,amount=.5,side='both'}={}){
 if(!['blink','smile','mouth-open'].includes(pose))throw Error('Unsupported facial preview pose '+pose);
 if(!valid(amount)||amount<0||amount>1)throw Error('Pose amount must be 0..1');
 if(!['both','left','right'].includes(side))throw Error('Pose side must be left, right or both');
 const updates=new Map(),weight=amount;
 const move=(ids,change)=>{
  for(const id of ids||[]){
   const v=mesh.vertices.get(id);
   if(!v)throw Error('Pose region contains stale vertex ID '+id);
   const d=typeof change==='function'?change(v.position):change;
   const before=updates.get(id)||v.position;
   updates.set(id,before.map((n,k)=>n+d[k]));
  }
 };
 if(pose==='blink'){
  for(const s of (side==='both'?['left','right']:[side])){
   const anchor=mesh.landmarks['eye_'+s];
   if(!anchor)throw Error('No editable orbital mesh '+s);
   // Partial upper-margin motion toward lower lid, including quad shell
   // transition rings. Full contact and collision-free blink are NOT claimed.
   const y=anchor.center[1];
   move(mesh.regions['upper_eyelid_'+s],p=>[0,-Math.min(.055,Math.max(0,p[1]-y)*.48)*weight,-.002*weight]);
   move(mesh.regions['lower_eyelid_'+s],p=>[0, Math.min(.016,Math.max(0,y-p[1])*.22)*weight,0]);
  }
 }else if(pose==='smile'){
  const corners=mesh.regions.mouth_corners;
  if(!corners?.length)throw Error('No editable mouth corners');
  move(corners,p=>[Math.sign(p[0])*.012*weight,.012*weight,0]);
  move(mesh.regions.mouth_upper_lip,[0,.003*weight,0]);
  move(mesh.regions.mouth_lower_lip,[0,.002*weight,0]);
 }else{
  if(!mesh.regions.mouth_upper_lip?.length||!mesh.regions.mouth_lower_lip?.length)
   throw Error('No editable mouth lips');
  move(mesh.regions.mouth_upper_lip,[0,.011*weight,0]);
  move(mesh.regions.mouth_lower_lip,[0,-.016*weight,.001*weight]);
 }
 return {pose,amount,side,verticesChanged:mesh._coordinateEdit('face.previewPose.'+pose,updates)};
}
