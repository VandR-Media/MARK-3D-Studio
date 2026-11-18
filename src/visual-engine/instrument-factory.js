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
 enclosure:mat('#263342',.84,.31),bodyface:mat('#141e2b',.82,.36),
 bezel:mat('#677684',.91,.28),bezeledge:mat('#8494a3',.79,.37),
 dial:mat('#c9a571',.06,.65,{emissive:'#e8a14f',emissiveIntensity:.26}),dialdark:mat('#111821',.24,.53),
 amber:mat('#ffa94a',.08,.39,{emissive:'#ff8c23',emissiveIntensity:.62}),
 glass:mat('#f5faff',0,.095,{type:'physical',opacity:1,transmission:.99,thickness:.012,ior:1.45}),
 screw:mat('#8998a8',.94,.26),
 needle:mat('#e9683c',.42,.27,{emissive:'#ee491f',emissiveIntensity:.10}),
 darkled:mat('#16212a',.17,.45),
 greenled:mat('#19ef9c',.1,.28,{emissive:'#16d677',emissiveIntensity:.0}),
 yellowled:mat('#f6df49',.1,.28,{emissive:'#ffb61e',emissiveIntensity:.0}),
 redled:mat('#ff5d55',.1,.24,{emissive:'#ff202e',emissiveIntensity:.0}),
 cyanled:mat('#53e3ff',.1,.28,{emissive:'#27bfff',emissiveIntensity:.0}),
 magentaled:mat('#fa6dff',.1,.28,{emissive:'#e92cfa',emissiveIntensity:.0}),
 black:mat('#05070d',.10,.83),rubber:mat('#101319',.08,.90),
 engraving:mat('#c4d7e1',.48,.62),overload:mat('#d94d40',.15,.38,{emissive:'#e03d23',emissiveIntensity:.18}),
 amberedge:mat('#b37a43',.72,.38,{emissive:'#d5812a',emissiveIntensity:.10}),
 leftaccent:mat('#197d9f',.68,.29,{emissive:'#176a8e',emissiveIntensity:.20}),
 rightaccent:mat('#965c91',.68,.29,{emissive:'#834077',emissiveIntensity:.20}),
 marker:mat('#d3ecff',.63,.21)
};
const bands=['low','mid','high'];
function builder(){
 const objects=[],bindings=[],overlays=[];
 const add=(id,name,geometry,material,position,parent='instrument.root',rotation=[0,0,0],meta={})=>{
  objects.push({id,name,geometry,material,position,rotation,scale:[1,1,1],parent,
   visible:true,meta});return id;
 };
 // All device-face text is anchored to physical 3D scene nodes. x/y is only
 // a viewport fallback for older viewers, NOT authoritative placement.
 const label=(text,x,y,color='#bfe1f4',size=12,anchor=null,offset=null)=>{
  const item={text,x,y,color,size};
  if(anchor){item.anchor=anchor;item.offset=offset;}
  overlays.push(item);
 };
 add('instrument.root','Instrument root',{type:'group'},null,[0,0,0],null);
 return {objects,bindings,overlays,add,label};
}
function casework(add,{width=9,height=5.2,depth=.72}={}){
 add('case.main','Milled aluminium outer body',{type:'bevel-box',width,height,depth,radius:.16,bevel:.105},'enclosure',[0,0,0]);
 add('case.front','Brushed front anodized panel',{type:'bevel-box',width:width-.23,height:height-.22,depth:.13,radius:.12,bevel:.045},'bodyface',[0,0,depth/2+.03]);
 // Layered machined rim and inner gasket establish genuine physical depth.
 add('case.perimeter','Satin steel raised perimeter',
  {type:'bevel-box',width:width-.09,height:height-.09,depth:.092,radius:.13,bevel:.028},
  'bezel',[0,0,depth/2-.02]);
 add('case.gasket','Inset rubber shadow reveal',
  {type:'bevel-box',width:width-.28,height:height-.27,depth:.046,radius:.12,bevel:.012},
  'rubber',[0,0,depth/2+.038]);
 // Understated machined ventilation slots along both side cheeks.
 for(const side of [-1,1])for(let i=0;i<8;i++){
  add('vent.'+(side<0?'left':'right')+'.'+i,'Milled ventilation recess',
   {type:'bevel-box',width:.10,height:.055,depth:.012,radius:.02,bevel:.004},
   'black',[side*(width/2-.20),-1.00+i*.25,depth/2+.115]);
 }
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
 add('analog.left.trim','Left channel ceramic accent',
  {type:'box',width:3.62,height:.035,depth:.015},'leftaccent',[-2.13,1.95,.64]);
 add('analog.right.trim','Right channel ceramic accent',
  {type:'box',width:3.62,height:.035,depth:.015},'rightaccent',[2.13,1.95,.64]);
 add('analog.header','Header inlaid strip',{type:'bevel-box',width:7.7,height:.34,depth:.07,radius:.04,bevel:.012},
  'black',[0,2.05,.54]);
 label('MARK  •  ANALOG STUDIO',.5,.14,'#d7f4ff',14,'analog.header',[0,0,.083]);
 for(const channel of ['left','right']){
  const x=channel==='left'?-2.13:2.13;
  const group='gauge.'+channel;
  add(group,channel.toUpperCase()+' physical VU gauge',{type:'group'},null,[x,.53,.55]);
  for(const side of [-1,1]){
   add(group+'.bezel.side.'+(side<0?'l':'r'),'Raised solid machined VU rim',
    {type:'bevel-box',width:.145,height:2.86,depth:.16,radius:.045,bevel:.025},
    'bezel',[side*1.84,0,.31],group);
   add(group+'.bezel.end.'+(side<0?'b':'t'),'Raised solid machined VU rim',
    {type:'bevel-box',width:3.70,height:.145,depth:.16,radius:.045,bevel:.025},
    'bezel',[0,side*1.38,.31],group);
  }
  add(group+'.back','Deep recessed inset',{type:'bevel-box',width:3.67,height:2.72,depth:.29,radius:.12,bevel:.08},
   'black',[0,0,0],group);
  add(group+'.dial','Warm ivory physical dial face',{type:'bevel-box',width:3.30,height:2.38,depth:.025,radius:.06,bevel:.019},
   'dial',[0,0,.17],group);
  add(group+'.glass','Transmissive curved safety cover',{type:'bevel-box',width:3.43,height:2.46,depth:.065,radius:.055,bevel:.031},
   'glass',[0,0,.32],group);
  // Real 3D VU tick strokes in a physical arc; readable text is 2D.
  for(let i=0;i<=16;i++){
   const t=-1.06+i*(2.12/16),r=1.63;
   add(group+'.tick'+i,'Engraved radial VU tick',
    {type:'box',width:i%4===0?.032:.021,height:(i%4===0?.20:.12),depth:.011},i>=13?'overload':'black',
    [Math.sin(t)*r,-.82+Math.cos(t)*r,.199],group,[0,0,-t]);
  }
  // Physical overload arc, small dial graduations and amber lower rail.
  for(let j=0;j<8;j++){
   const t=.68+j*.051;
   add(group+'.overload'+j,'Red overload scale band',{type:'box',width:.045,height:.13,depth:.013},
    'overload',[Math.sin(t)*1.44,-.82+Math.cos(t)*1.44,.213],group,[0,0,-t]);
  }
  add(group+'.lightbar','Warm reflected lamp glow',
   {type:'box',width:2.9,height:.032,depth:.014},'amber',[0,-1.02,.221],group);
  add(group+'.pivot','Needle axis (mechanical)',{type:'cylinder',radiusTop:.12,radiusBottom:.13,height:.115,radialSegments:32},
   'bezel',[0,-.82,.217],group,[Math.PI/2,0,0]);
  add('needle.'+channel,'3D tapered needle',{type:'needle',length:1.60,width:.055,depth:.028},
   'needle',[0,-.82,.239],group,[0,0,.97]);
  // Needle geometry points along +Y. Positive Z rotation tilts it LEFT;
  // increasing signal must decrease Z rotation to sweep RIGHT into +3 VU.
  g.bindings.push({target:'needle.'+channel,signal:channel+'.rms',
   response:'needle',gain:1.85,offset:.97,sweep:-1.94,attackMs:120,releaseMs:300});
  label(channel.toUpperCase(),channel==='left'?.275:.725,.365,'#29303b',13,group,[-1.03,-.92,.24]);
  label('VU',channel==='left'?.275:.725,.42,'#29303b',16,group,[0,-.27,.24]);
  for(const [i,value] of ['-20','-10','-5','0','+3'].entries()){
   const angle=-.84+i*.42;
   label(value,.5,.5,i===4?'#c32e20':'#28303b',10,group,
    [Math.sin(angle)*1.27,-.82+Math.cos(angle)*1.27,.236]);
  }
 }
 add('analog.bottom.bay','Six-band window',{type:'bevel-box',width:8.0,height:1.02,depth:.085,radius:.08,bevel:.04},
  'black',[0,-1.61,.52]);
 const cols=[];
 for(let c=0;c<2;c++)for(let b=0;b<3;b++){
  const channel=c===0?'left':'right',x=(c===0?-2.2:2.2)+(b-1)*.92;
  cols.push({channel,band:bands[b],x});
  label((channel==='left'?'L ':'R ')+bands[b].toUpperCase(),.5+x/9.15,.82,
   channel==='left'?'#a6ddff':'#ffc0e8',10,'analog.bottom.bay',[x,.365,.12]);
 }
 addSegmentColumns(g,{columns:cols,originY:-1.99,step:.083,steps:8,width:.27,z:.65,colorful:true});
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
 label('MARK  •  SPECTRUM MATRIX',.5,.13,'#c6e8ff',14,'matrix.header',[0,0,.082]);
 add('matrix.border','Machined silver display surround',
  {type:'bevel-box',width:8.17,height:3.73,depth:.13,radius:.16,bevel:.045},
  'bezel',[0,-.18,.55]);
 for(const side of [-1,1]){
  add('matrix.rim.side.'+(side<0?'l':'r'),'Thin bright machined LCD side rim',
   {type:'bevel-box',width:.078,height:3.63,depth:.08,radius:.024,bevel:.012},
   'bezeledge',[side*4.03,-.18,.86]);
  add('matrix.rim.end.'+(side<0?'b':'t'),'Thin bright machined LCD upper rim',
   {type:'bevel-box',width:8.05,height:.075,depth:.08,radius:.024,bevel:.012},
   'bezeledge',[0,-.18+side*1.79,.86]);
 }
 add('matrix.blackbed','Deep antiglare backplane',{type:'bevel-box',width:8.05,height:3.57,depth:.19,radius:.13,bevel:.045},
  'black',[0,-.18,.61]);
 add('matrix.glass','Neutral ultra-clear protective front glass',{type:'bevel-box',width:7.93,height:3.46,depth:.028,radius:.07,bevel:.012},
  'glass',[0,-.18,.86]);
 const columns=[];
 for(let ci=0;ci<2;ci++)for(let bi=0;bi<3;bi++){
  const channel=ci===0?'left':'right',band=bands[bi],x=(ci===0?-2.05:2.05)+(bi-1)*.99;
  columns.push({channel,band,x});
  add('matrix.recess.'+channel+'.'+band,'Deep antiglare LED column channel',
   {type:'bevel-box',width:.77,height:3.17,depth:.055,radius:.05,bevel:.013},
   'black',[x,-.19,.716]);
  add('matrix.rail.'+channel+'.'+band,'Machined LED column side rail',
   {type:'bevel-box',width:.83,height:3.25,depth:.025,radius:.05,bevel:.01},
   channel==='left'?'leftaccent':'rightaccent',[x,-.19,.700]);
  label(band.toUpperCase(),.5+x/9.15,.26,'#ecf8ff',12,'matrix.blackbed',[x,1.47,.30]);
 }
 add('matrix.separator','Physical center divider',{type:'box',width:.042,height:3.34,depth:.075},
  'bezel',[0,-.19,.75]);
 // Eighteen independent *physical meshes* per channel/band.
 addSegmentColumns(g,{columns,originY:-1.68,step:2.95/(p.segments-1),steps:p.segments,width:.60,z:.74});
 label('LEFT',.30,.87,'#5bdbff',13,'case.main',[-2.05,-2.20,.57]);
 label('RIGHT',.70,.87,'#f2a0df',13,'case.main',[2.05,-2.20,.57]);
 label('20–200',.27,.92,'#9eb9c5',9,'case.main',[-2.99,-2.42,.57]);
 label('200–2k',.5,.92,'#9eb9c5',9,'case.main',[0,-2.42,.57]);
 label('2k–16k',.73,.92,'#9eb9c5',9,'case.main',[2.99,-2.42,.57]);
 return {...g,name:'MARK Spectrum Matrix — 6 physical stereo LED columns',materials:structuredClone(materials)};
}
export function buildInstrument(kind,params={}){
 if(!params||typeof params!=='object'||Array.isArray(params))throw Error('Invalid instrument parameters');
 if(kind==='analog-studio')return analog(params);
 if(kind==='spectrum-matrix')return matrix(params);
 throw Error('Unimplemented 3D instrument: '+kind+'. Four additional modes remain gated by first two visual acceptance tests.');
}
