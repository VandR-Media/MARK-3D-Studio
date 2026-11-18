/**
 * Physically attached dial typography for MARK Visual Engine.
 * Text is rasterized ONLY as a glyph texture on a real 3D plane, not as a
 * camera-independent overlay or a stand-in for the 3D instrument.
 * Occlusion, perspective, rotation and zoom are performed by WebGL2.
 */
import * as THREE from 'three';

export function createSurfaceLabel(item){
 const fontSize=Math.min(32,Math.max(9,item.size||12));
 const scale=3;
 const canvas=document.createElement('canvas');
 const context=canvas.getContext('2d');
 if(!context)throw Error('2D context unavailable for physical dial markings');
 context.font=`800 ${fontSize*scale}px Arial, sans-serif`;
 const text=String(item.text);
 const textWidth=Math.ceil(context.measureText(text).width+fontSize*scale*.9);
 canvas.width=Math.max(64,textWidth);
 canvas.height=Math.ceil(fontSize*scale*1.6);
 const cx=canvas.getContext('2d');
 cx.clearRect(0,0,canvas.width,canvas.height);
 cx.font=`800 ${fontSize*scale}px Arial, sans-serif`;
 cx.textAlign='center';cx.textBaseline='middle';
 cx.fillStyle=item.color||'#ffffff';
 cx.fillText(text,canvas.width/2,canvas.height/2);
 const texture=new THREE.CanvasTexture(canvas);
 texture.colorSpace=THREE.SRGBColorSpace;
 texture.minFilter=THREE.LinearFilter;texture.magFilter=THREE.LinearFilter;
 texture.generateMipmaps=true;texture.needsUpdate=true;
 const worldHeight=.012*fontSize; // 12px => 0.144 scene units
 const worldWidth=worldHeight*canvas.width/canvas.height;
 const geometry=new THREE.PlaneGeometry(worldWidth,worldHeight);
 const material=new THREE.MeshBasicMaterial({
  map:texture,transparent:true,alphaTest:.04,depthTest:true,depthWrite:false,
  toneMapped:false,side:THREE.FrontSide
 });
 const mesh=new THREE.Mesh(geometry,material);
 mesh.name='surface_label_'+text.replace(/[^a-z\d]+/gi,'_').slice(0,28);
 mesh.position.fromArray(item.offset||[0,0,0]);
 // Plane orientation inherited from its physical, potentially rotated anchor.
 mesh.userData.surfaceLabel=true;
 mesh.userData.dialText=text;
 mesh.renderOrder=2;
 return mesh;
}
