/**
 * MARK Facial Topology v0.6.1 — no high-valence triangle-fan caps.
 * Makes a series of inward quad rings, then quad-strip fills the final loop.
 * Geometry is genuinely closed; no materials, normals tricks or fake disks.
 * The boundary orientation is from the half-edge holes in the source QUAD shell.
 *
 * This is an anatomical prototype, not an animation-ready facial rig.
 */
const lerp=(a,b,t)=>a+(b-a)*t;
const levels=[
 {shrink:.13,depth:.035},
 {shrink:.25,depth:.10},
 {shrink:.40,depth:.20},
 {shrink:.58,depth:.36},
 {shrink:.73,depth:.55},
 {shrink:.84,depth:.72},
 {shrink:.91,depth:.88},
 {shrink:.94,depth:1}
];
export function closeCavityWithQuads(mesh,boundary,{center,depth,kind='eye'}={}){
 if(!Array.isArray(boundary)||boundary.length<6||boundary.length%2!==0)
  throw Error('Quad cavity needs even boundary loop of >=6 vertices');
 if(!Array.isArray(center)||center.length!==3||!Number.isFinite(depth)||depth<=0)
  throw Error('Quad cavity needs 3D center and positive depth');
 const n=boundary.length,start=mesh.faces.size;
 const base=boundary.map(id=>mesh.vertices.get(id));
 if(base.some(v=>!v))throw Error('Quad cavity references missing vertex');
 let rim=[...boundary];const rings=[rim];
 for(const [levelNo,{shrink,depth:t}] of levels.entries()){
  const inner=base.map(v=>{
   const p=v.position;
   // All four-sided rings have the same count and winding. The eye has a
   // raised, gently receding upper margin; mouth has a gently recessed seam.
   const upper=p[1]>=center[1],eyelid=kind==='eye'?(upper?.016:.008)*Math.max(0,1-levelNo/4):0;
   const lip=kind==='mouth'?.010*Math.max(0,1-levelNo/4):0;
   const nostril=kind==='nostril'?-.035*t:0;
   const position=[
    lerp(p[0],center[0],shrink),
    lerp(p[1],center[1],shrink)+nostril,
    lerp(p[2],center[2],shrink)-depth*t+eyelid+lip
   ];
   return mesh._vertex(position,v.uv);
  });
  for(let i=0;i<n;i++){
   const next=(i+1)%n;
   // Reverse original open boundary edge. Quad winding preserved.
   mesh._face([rim[next],rim[i],inner[i],inner[next]]);
  }
  rim=inner;rings.push(inner);
 }
 // Pair opposite arcs into quads. No common center or valence-N apex.
 // At the very deepest ring this fills the disk with (N/2 - 1) quads.
 // Each rim boundary edge is used exactly once in the opposite direction.
 const half=n/2;
 for(let k=0;k<half-1;k++){
  mesh._face([rim[n-1-k],rim[n-2-k],rim[k+1],rim[k]]);
 }
 return {rings,capQuads:half-1,totalNewFaces:mesh.faces.size-start,
  capTriangles:0,feature:kind,capValenceLimit:4};
}
