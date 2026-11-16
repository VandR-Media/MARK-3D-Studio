/**
 * MARK Cosmic face candidate v1: a newly authored continuous cranial surface.
 * Not a clone/rename of the v0.3 practice head. Pure deterministic geometry.
 * Anatomical landmarks are provisional; approved images are NOT embedded.
 */
import {loft,appendMeshes} from './production-geometry.js';
import {writeGlb} from './glb.js';
const gauss=(x,c,r)=>Math.exp(-2*((x-c)/r)**2);
const amount=(v,k,d)=>d*((v??.5)-.5)*k;
export function makeContourHead({width=.5,height=.5,forehead=.5,cheeks=.5,
 jaw=.5,chin=.5,nose=.5,sockets=.5,mouth=.5}={}){
 const inputs={width,height,forehead,cheeks,jaw,chin,nose,sockets,mouth};
 for(const [k,v] of Object.entries(inputs))if(!(typeof v==='number'&&v>=0&&v<=1&&Number.isFinite(v)))
  throw Error('Contour head '+k+' must be in [0,1]');
 const sections=[],rings=126,n=192;
 for(let i=0;i<=rings;i++){
  const t=(i+.45)/(rings+.9),latitude=-Math.PI/2+Math.PI*t;
  const y=1.16*Math.sin(latitude)*(1+amount(height,.18,1));
  const r=Math.cos(latitude);
  const jawLevel=gauss(y,-.57,.43),cheekLevel=gauss(y,-.07,.32);
  const cranialLevel=gauss(y,.55,.48);
  const jawWidth=1+amount(jaw,.30,1)*jawLevel-.06*gauss(y,-.83,.2);
  const faceWidth=1+amount(width,.24,1)+amount(forehead,.16,1)*cranialLevel;
  const contour=[];
  for(let j=0;j<n;j++){
   const a=2*Math.PI*j/n;
   let x=.83*r*Math.sin(a)*jawWidth*faceWidth;
   let z=.79*r*Math.cos(a);
   const front=Math.max(0,Math.cos(a)),ax=Math.abs(x);
   // Integrated continuous organic forms: no overlapping nose balls.
   const eyebrow=gauss(ax,.33,.23)*gauss(y,.52,.13);
   const socket=gauss(ax,.34,.20)*gauss(y,.35,.18);
   const cheek=gauss(ax,.48,.25)*gauss(y,-.04,.26);
   const nasalRoot=gauss(ax,.00,.135)*gauss(y,.22,.35);
   const nasalTip=gauss(ax,.00,.125)*gauss(y,-.09,.18);
   const alar=gauss(ax,.142,.065)*gauss(y,-.18,.12);
   const mouthRim=gauss(ax,.16,.28)*gauss(y,-.49,.115);
   const upperLip=gauss(ax,.19,.27)*gauss(y,-.455,.050);
   const lowerLip=gauss(ax,.19,.27)*gauss(y,-.555,.064);
   const chinPad=gauss(ax,.13,.28)*gauss(y,-.80,.17);
   const jawContour=gauss(ax,.52,.20)*gauss(y,-.63,.27);
   const nasolabial=gauss(ax,.31,.085)*gauss(y,-.36,.24);
   z+=front*(.040*eyebrow-.100*socket +(.082+.06*(cheeks-.5))*cheek+
    .195*nasalRoot+(.165+.11*(nose-.5))*nasalTip+.042*alar
    +.012*mouthRim+.032*upperLip+.030*lowerLip+.077*chinPad+.035*jawContour-.026*nasolabial);
   // Temple, chin and zygomatic silhouette supported by entire continuous mesh.
   x*=1+.034*cheekLevel*front-.026*gauss(y,-.83,.18);
   z+=.016*Math.sin(a*2)**2*gauss(y,.78,.27);
   contour.push([x,y,z]);
  }
  sections.push(contour);
 }
 return loft(sections);
}
export function createContourHeadGlb(opts={}){
 const empty={asset:{version:'2.0',generator:'MARK Modeling API 0.4.1 — authored contour head candidate'},
  scene:0,scenes:[{nodes:[]}],nodes:[],meshes:[],materials:[],accessors:[],bufferViews:[],
  buffers:[{byteLength:0}]};
 const src=writeGlb({chunks:[{type:0x4e4f534a,data:new Uint8Array(0)},
   {type:0x004e4942,data:new Uint8Array(0)}]},empty);
 return appendMeshes(src,[{
  name:'Cosmic candidate continuous face — not approved',
  geometry:makeContourHead(opts),
  material:{name:'Candidate skin PBR',color:[.77,.52,.40,1],roughness:.78,metallic:0}
 }]).bytes;
}
