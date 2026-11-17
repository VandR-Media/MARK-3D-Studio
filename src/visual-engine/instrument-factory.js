/**
 * MARK Stereo Visual Collection — real parameterized 3D object recipes.
 * First two acceptance candidates only. All geometry is generated as real meshes,
 * not images or CSS-perspective imitations; 2D overlays are for legible text.
 */
const mat=(color,metalness=0,roughness=.65,extra={})=>({
 type:extra.type||'standard',color,metalness,roughness,
 emissive:extra.emissive||'#000000',emissiveIntensity:extra.emissiveIntensity||0,
 opacity:extra.opacity??1,transmission:extra.transmission??0,
 ...extra
});
const materials={
 enclosure:mat('#172131',.77,.29),bodyface:mat('#101a27',.7,.39),
 bezel:mat('#536579',.9,.19),bezeledge:mat('#9bbed2',.92,.22),
 dial:mat('#e4cf9a',.13,.65),dialDark:mat('#0f1927',.25,.50),
 amber:mat('#ffae52',.1,.35,{emissive:'#ff9519',emissiveIntensity:.54}),
 glass:mat('#9ac8ed',.05,.08,{type:'physical',opacity:.83,transmission:.64,thickness:.12,ior:1.47}),
 screw:mat('#a2b2bd',.94,.21),
 needle:mat('#ff904b',.4,.28,{emissive:'#f45620',emissiveIntensity:.17}),
 darkled:mat('#16212a',.17,.45),
 greenled:mat('#19ef9c',.1,.28,{emissive:'#16d677',emissiveIntensity:.0}),
 yellowled:mat('#f6df49',.1,.28,{emissive:'#ffb61e',emissiveIntensity:.0}),
 redled:mat('#ff5d55',.1,.24,{emissive:'#ff202e',emissiveIntensity:.0}),
 cyanled:mat('#53e3ff',.1,.28,{emissive:'#27bfff',emissiveIntensity:.0}),
 magentaled:mat('#fa6dff',.1,.28,{emissive:'#e92cfa',emissiveIntensity:.0}),
 black:mat('#03060d',.13,.73),rubber:mat('#111319',.05,.83),
 marker:mat('#d3ecff',.63,.21)
};
const bands=['low','mid','high'];
function builder(){
 const objects=[],bindings=[],overlays=[];
 const add=(id,name,geometry,material,position,parent='instrument.root',rotation=[0,0,0],meta={})=>{
  objects.push({id,name,geometry,material,position,rotation,scale:[1,1,1],parent,
   visible:true,meta});return id;
 };
 const label=(text,x,y,color='#bfe1f4',size=12)=>overlays.push({text,x,y,color,size});
 add('instrument.root','Instrument root',{type:'group'},null,[0,0,0],null);
 return {objects,bindings,overlays,add,label};
}
function casework(add,{width=9,height=5.2,depth=.72}={}){
 add('case.main','Milled aluminium outer body',{type:'bevel-box',width,height,depth,radius:.16,bevel:.105},'enclosure',[0,0,0]);
 add('case.front','Brushed front anodized panel',{type:'bevel-box',width:width-.23,height:height-.22,depth:.13,radius:.12,bevel:.045},'bodyface',[0,0,depth/2+.03]);
 add('case.lowerline','Lower chrome edge',{type:'box',width:width-.45,height:.022,depth:.018},'bezeledge',[0,-height/2+.28,depth/2+.125]);
 add('case.upperline','Upper chrome edge',{type:'box',width:width-.45,height:.024,depth:.018},'bezeledge',[0,height/2-.28,depth/2+.125]);
 for(const x of [-width/2+.33,width/2-.33])for(const y of [-height/2+.34,height/2-.34]){
  const id='screw.'+(x<0?'l':'r')+'.'+(y<0?'b':'t');
  add(id,'Recessed machined steel screw',{type:'cylinder',radiusTop:.085,radiusBottom:.085,height:.048,radialSegments:24},
   'screw',[x,y,depth/2+.15],'instrument.root',[Math.PI/2,0,0]);
  add(id+'.slot','Screwdriver slot',{type:'box',width:.10,height:.013,depth:.008},
   'black',[x,y,depth/2+.177],'instrument.root',[0,0,-.48]);
 }
}
function addSegmentColumns(g,{columns,originY,step=.19,width=.46,steps=11,parent='instrument.root',colorful=false,z=.85}={}){
 columns.forEach((col,i)=>{
  const group='meter.'+col.channel+'.'+col.band;
  g.add(group,'Real LED '+col.channel+' '+col.band,{type:'group'},null,
   [col.x,originY,z],parent);
  for(let j=0;j<steps;j++){
   const shade=j>=Math.ceil(steps*.83)?'redled':j>=Math.ceil(steps*.63)?'yellowled':
    colorful?(col.channel==='left'?'cyanled':'magentaled'):'greenled';
   g.add(group+'.seg'+j,'Physical luminous lens '+j,
    {type:'bevel-box',width,height:step*.65,depth:.075,radius:.018,bevel:.012},
    shade,[0,j*step,.01],group,[0,0,0],{role:'led',threshold:(j+1)/steps,shade});
  }
  g.bindings.push({target:group,signal:col.channel+'.'+col.band,response:'led-column',gain:1});
 });
}
function analog(params){
 const p={width:params.width??9.15,height:params.height??5.2};
 if(p.width<8||p.width>11||p.height<4.6||p.height>7)throw Error('Analog dimensions outside safe range');
 const g=builder(),{add,label}=g;
 casework(add,{...p,depth:.8});
 add('analog.header','Header inlaid strip',{type:'bevel-box',width:7.7,height:.34,depth:.07,radius:.04,bevel:.012},
  'black',[0,2.05,.54]);
 label('MARK  •  ANALOG STUDIO',.5,.14,'#d7f4ff',14);
 for(const channel of ['left','right']){
  const x=channel==='left'?-2.13:2.13;
  const group='gauge.'+channel;
  add(group,channel.toUpperCase()+' physical VU gauge',{type:'group'},null,[x,.53,.55]);
  add(group+'.back','Deep recessed inset',{type:'bevel-box',width:3.67,height:2.72,depth:.29,radius:.12,bevel:.08},
   'black',[0,0,0],group);
  add(group+'.dial','Warm ivory physical dial face',{type:'bevel-box',width:3.30,height:2.38,depth:.025,radius:.06,bevel:.019},
   'dial',[0,0,.17],group);
  add(group+'.glass','Transmissive curved safety cover',{type:'bevel-box',width:3.43,height:2.46,depth:.065,radius:.055,bevel:.031},
   'glass',[0,0,.27],group);
  // Real 3D VU tick strokes in a physical arc; readable text is 2D.
  for(let i=0;i<=16;i++){
   const t=-1.06+i*(2.12/16),r=1.63;
   add(group+'.tick'+i,'Engraved radial VU tick',
    {type:'box',width:.021,height:(i%4===0?.20:.12),depth:.011},'black',
    [Math.sin(t)*r,-.82+Math.cos(t)*r,.199],group,[0,0,-t]);
  }
  add(group+'.pivot','Needle axis (mechanical)',{type:'cylinder',radiusTop:.12,radiusBottom:.13,height:.115,radialSegments:32},
   'bezel',[0,-.82,.284],group,[Math.PI/2,0,0]);
  add('needle.'+channel,'3D tapered needle',{type:'needle',length:1.60,width:.055,depth:.028},
   'needle',[0,-.82,.321],group,[0,0,-.97]);
  g.bindings.push({target:'needle.'+channel,signal:channel+'.rms',response:'needle',gain:1.85,offset:-.97});
  label(channel.toUpperCase(),channel==='left'?.275:.725,.365,'#243142',14);
  label('VU',channel==='left'?.275:.725,.42,'#283747',17);
 }
 add('analog.bottom.bay','Six-band window',{type:'bevel-box',width:8.0,height:1.02,depth:.085,radius:.08,bevel:.04},
  'black',[0,-1.61,.52]);
 const cols=[];
 for(let c=0;c<2;c++)for(let b=0;b<3;b++){
  const channel=c===0?'left':'right',x=(c===0?-2.2:2.2)+(b-1)*.92;
  cols.push({channel,band:bands[b],x});
  label((channel==='left'?'L ':'R ')+bands[b].toUpperCase(),.5+x/9.15,.82,
   channel==='left'?'#a6ddff':'#ffc0e8',10);
 }
 addSegmentColumns(g,{columns:cols,originY:-1.99,step:.083,steps:8,width:.27,z:.65});
 return {...g,name:'MARK Analog Studio — physical 3D stereo VU',materials:structuredClone(materials)};
}
function matrix(params){
 const p={width:params.width??9.15,height:params.height??5.2,segments:params.segments??18};
 if(p.width<8||p.width>11||p.height<4.6||p.height>7||
  !Number.isInteger(p.segments)||p.segments<8||p.segments>28)
  throw Error('Spectrum Matrix dimensions / segments outside safe range');
 const g=builder(),{add,label}=g;
 casework(add,{...p,depth:.87});
 add('matrix.header','LED display upper bezel',{type:'bevel-box',width:8.0,height:.4,depth:.07,radius:.05,bevel:.02},
  'bezel',[0,2.07,.55]);
 label('MARK  •  SPECTRUM MATRIX',.5,.13,'#c6e8ff',14);
 add('matrix.blackbed','Deep antiglare backplane',{type:'bevel-box',width:8.05,height:3.57,depth:.19,radius:.13,bevel:.045},
  'black',[0,-.18,.61]);
 add('matrix.glass','Light-transmitting protected LED glass',{type:'bevel-box',width:7.93,height:3.46,depth:.045,radius:.07,bevel:.025},
  'glass',[0,-.18,.80]);
 const columns=[];
 for(let ci=0;ci<2;ci++)for(let bi=0;bi<3;bi++){
  const channel=ci===0?'left':'right',band=bands[bi],x=(ci===0?-2.05:2.05)+(bi-1)*.99;
  columns.push({channel,band,x});
  label(band.toUpperCase(),.5+x/9.15,.26,'#d9e5ee',11);
 }
 add('matrix.separator','Physical center divider',{type:'box',width:.022,height:3.26,depth:.075},
  'bezel',[0,-.19,.75]);
 // Eighteen independent *physical meshes* per channel/band.
 addSegmentColumns(g,{columns,originY:-1.68,step:2.95/(p.segments-1),steps:p.segments,width:.60});
 label('LEFT',.30,.87,'#5bdbff',13);label('RIGHT',.70,.87,'#f2a0df',13);
 label('20–200',.27,.92,'#9eb9c5',9);
 label('200–2k',.5,.92,'#9eb9c5',9);
 label('2k–16k',.73,.92,'#9eb9c5',9);
 return {...g,name:'MARK Spectrum Matrix — 6 physical stereo LED columns',materials:structuredClone(materials)};
}
export function buildInstrument(kind,params={}){
 if(!params||typeof params!=='object'||Array.isArray(params))throw Error('Invalid instrument parameters');
 if(kind==='analog-studio')return analog(params);
 if(kind==='spectrum-matrix')return matrix(params);
 throw Error('Unimplemented 3D instrument: '+kind+'. Four additional modes remain gated by first two visual acceptance tests.');
}
