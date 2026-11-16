/**
 * Anatomical ear patch: contiguous quad surface stitched to an actual
 * aperture in the skull side, not a detached sphere or a tube overlay.
 *
 * Ring 2 = helix rim, ring 3 = antihelix ridge, ring 5 = recessed concha.
 * It remains a stylized topology prototype, NOT a production ear sculpt.
 */
const levels=[
 // radial growth, lateral projection, posterior offset
 [1.08,.05,-.012],
 [1.24,.18,-.03],
 [1.12,.22,-.047],
 [.92,.16,-.059],
 [.52,.075,-.084],
 [.18,.018,-.094],
 [.075,-.022,-.106]
];
export function buildEarPatch(mesh,boundary,{center,side}={}){
 if(!Array.isArray(boundary)||boundary.length<8||boundary.length%2!==0)
  throw Error('Ear patch requires an even rim of at least 8 vertices');
 if(!Array.isArray(center)||center.length!==3||![-1,1].includes(side))
  throw Error('Ear patch requires oriented lateral center');
 const base=boundary.map(id=>mesh.vertices.get(id));
 if(base.some(v=>!v))throw Error('Ear patch rim vertex is absent');
 const n=boundary.length,rings=[[...boundary]],all=[...boundary];
 let previous=boundary;
 for(let level=0;level<levels.length;level++){
  const [spread,push,back]=levels[level];
  const next=base.map(v=>{
   const p=v.position,yy=p[1]-center[1];
   const lower=Math.max(0,Math.min(1,(-yy-.08)/.25));
   const lobe=(level>=1&&level<=3)?lower*.038:0;
   // Tragus is a shallow inner cartilage prominence, not a separate ball.
   const localTragus=(level===3||level===4)?
    .022*Math.exp(-((yy+.11)/.085)**2)*Math.exp(-((p[2]-center[2]-.05)/.12)**2):0;
   const pos=[
    center[0]+(p[0]-center[0])*spread+side*(push+lobe+localTragus),
    center[1]+yy*spread-lobe*.7,
    center[2]+(p[2]-center[2])*spread+back
   ];
   return mesh._vertex(pos,v.uv);
  });
  for(let k=0;k<n;k++){
   const j=(k+1)%n;
   mesh._face([previous[j],previous[k],next[k],next[j]]);
  }
  previous=next;rings.push(next);all.push(...next);
 }
 // Cap the deep concha with opposing quad arches, no valence-N star vertex.
 for(let k=0;k<n/2-1;k++)
  mesh._face([previous[n-1-k],previous[n-2-k],previous[k+1],previous[k]]);
 return {
  vertices:all,helix:[...rings[2]],antihelix:[...rings[3]],
  concha:[...rings[5],...rings[6]],
  lobe:all.filter(id=>mesh.vertices.get(id).position[1]<center[1]-.18),
  quadCapFaces:n/2-1,feature:'connected-ear'
 };
}
