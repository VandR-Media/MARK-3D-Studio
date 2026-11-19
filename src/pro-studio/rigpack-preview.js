/**
 * EXPERIMENTAL rig project transfer pack, NOT production .markscene v3.
 * Two-entry ZIP/STORE with an auditable manifest + unmodified GLB bytes.
 * Supports safe archive/reopen of animated assets without deleting skin/morph
 * semantics. NOT a mesh editor, exporter-from-modified-geometry, or v3 writer.
 */
import {createHash} from 'node:crypto';
import {inspectRiggedGlb,comparePreservedRiggedGlb} from './rigged-glb-audit.js';

const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const MAX_ASSET=64*1024*1024, MAX_ARCHIVE=MAX_ASSET+64*1024;
const MANIFEST='manifest.json',ASSET='assets/source.glb';
const HEADER_LOCAL=0x04034b50,HEADER_CENTRAL=0x02014b50,HEADER_END=0x06054b50;
const HASH=x=>createHash('sha256').update(x).digest('hex');
function requireThat(ok,code,detail){if(!ok){const err=Error('MARK_RIGPACK_'+code+': '+detail);err.code=code;throw err;}}
function raw(data){return data instanceof Uint8Array?data:new Uint8Array(data);}
const crcTable=Uint32Array.from({length:256},(_,i)=>{let c=i;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc32(bytes){let c=0xffffffff;for(const x of bytes)c=crcTable[(c^x)&255]^(c>>>8);return(c^0xffffffff)>>>0;}

function zipStored(entries){
 let size=22,centralSize=0,localSize=0;
 const info=entries.map(([name,data])=>{
  const nameBytes=encoder.encode(name),contents=raw(data);
  requireThat(nameBytes.length<255&&contents.length<=MAX_ASSET,'ZIP_BUDGET','entry too large');
  size+=30+nameBytes.length+contents.length+46+nameBytes.length;
  localSize+=30+nameBytes.length+contents.length;
  centralSize+=46+nameBytes.length;
  return {nameBytes,contents,crc:crc32(contents)};
 });
 requireThat(size<=MAX_ARCHIVE,'ZIP_BUDGET','archive too large');
 const output=new Uint8Array(size),v=new DataView(output.buffer);
 let offset=0;const offsets=[];
 for(const x of info){const n=x.nameBytes.length;offsets.push(offset);
  v.setUint32(offset,HEADER_LOCAL,true);v.setUint16(offset+4,20,true);
  v.setUint16(offset+6,0,true);v.setUint16(offset+8,0,true); // store, no data descriptor
  v.setUint32(offset+14,x.crc,true);
  v.setUint32(offset+18,x.contents.length,true);v.setUint32(offset+22,x.contents.length,true);
  v.setUint16(offset+26,n,true);v.setUint16(offset+28,0,true);
  output.set(x.nameBytes,offset+30);output.set(x.contents,offset+30+n);
  offset+=30+n+x.contents.length;
 }
 const central=offset;
 for(let i=0;i<info.length;i++){const x=info[i],n=x.nameBytes.length;
  v.setUint32(offset,HEADER_CENTRAL,true);v.setUint16(offset+4,20,true);v.setUint16(offset+6,20,true);
  v.setUint16(offset+8,0,true);v.setUint16(offset+10,0,true);
  v.setUint32(offset+16,x.crc,true);v.setUint32(offset+20,x.contents.length,true);
  v.setUint32(offset+24,x.contents.length,true);v.setUint16(offset+28,n,true);
  v.setUint32(offset+42,offsets[i],true);output.set(x.nameBytes,offset+46);
  offset+=46+n;
 }
 v.setUint32(offset,HEADER_END,true);v.setUint16(offset+8,info.length,true);
 v.setUint16(offset+10,info.length,true);v.setUint32(offset+12,offset-central,true);
 v.setUint32(offset+16,central,true);v.setUint16(offset+20,0,true);
 requireThat(offset+22===output.length,'ZIP_INTERNAL','ZIP length inconsistency');
 return output;
}
function unzipStored(input){
 const bytes=raw(input);requireThat(bytes.length>=22&&bytes.length<=MAX_ARCHIVE,'ZIP_BUDGET','invalid archive size');
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 const end=bytes.length-22;
 requireThat(v.getUint32(end,true)===HEADER_END,'ZIP_EOCD','missing terminal ZIP directory record');
 const count=v.getUint16(end+10,true),start=v.getUint32(end+16,true),directorySize=v.getUint32(end+12,true);
 requireThat(count===2&&v.getUint16(end+8,true)===count&&start+directorySize===end,
  'ZIP_DIRECTORY','expected exactly two entries with no archive comments');
 const names=new Set(),result=new Map();let ptr=start;
 for(let i=0;i<count;i++){
  requireThat(ptr+46<=end&&v.getUint32(ptr,true)===HEADER_CENTRAL,'ZIP_CENTRAL','bad central directory');
  const flags=v.getUint16(ptr+8,true),method=v.getUint16(ptr+10,true),crc=v.getUint32(ptr+16,true),
   compressed=v.getUint32(ptr+20,true),plain=v.getUint32(ptr+24,true);
  const n=v.getUint16(ptr+28,true),extra=v.getUint16(ptr+30,true),comment=v.getUint16(ptr+32,true);
  const local=v.getUint32(ptr+42,true);
  requireThat(n>0&&ptr+46+n+extra+comment<=end&&flags===0&&method===0&&compressed===plain&&
   plain<=MAX_ASSET,'ZIP_ENTRY','unsupported compression/flags/entry size');
  const name=decoder.decode(bytes.subarray(ptr+46,ptr+46+n));
  requireThat((name===MANIFEST||name===ASSET)&&!names.has(name),'ZIP_ENTRY_NAME','unexpected or duplicate ZIP filename');
  names.add(name);
  requireThat(local+30<=start&&v.getUint32(local,true)===HEADER_LOCAL,'ZIP_LOCAL','invalid local header offset');
  const localFlags=v.getUint16(local+6,true),localMethod=v.getUint16(local+8,true),
   localCRC=v.getUint32(local+14,true),localLen=v.getUint32(local+18,true),
   localNameLen=v.getUint16(local+26,true),localExtra=v.getUint16(local+28,true);
  const dataStart=local+30+localNameLen+localExtra;
  requireThat(localFlags===0&&localMethod===0&&localCRC===crc&&localLen===plain&&
   dataStart+plain<=start&&decoder.decode(bytes.subarray(local+30,local+30+localNameLen))===name,
   'ZIP_LOCAL','local ZIP header conflicts with central directory');
  const entry=bytes.slice(dataStart,dataStart+plain);
  requireThat(crc32(entry)===crc,'ZIP_CRC','invalid CRC for '+name);result.set(name,entry);
  ptr+=46+n+extra+comment;
 }
 requireThat(ptr===end&&names.has(MANIFEST)&&names.has(ASSET),'ZIP_DIRECTORY','incomplete rig pack');
 return result;
}

export function createRigPreviewPack(glbInput,{
 projectId='rig-preview',name='Imported Rigged GLB',clipIndex=0,sourceName='source.glb',license='unknown'
}={}){
 const glb=raw(glbInput),inspection=inspectRiggedGlb(glb);
 requireThat(/^[a-z][a-z0-9._-]{1,79}$/.test(projectId),'PROJECT_ID','invalid project ID');
 requireThat(Number.isInteger(clipIndex)&&clipIndex>=0&&
  (!inspection.animations.length?clipIndex===0:clipIndex<inspection.animations.length),
  'CLIP_INDEX','selected clip is outside imported GLB');
 requireThat(typeof name==='string'&&name.length<=160&&typeof sourceName==='string'&&sourceName.length<=160&&
  typeof license==='string'&&license.length<=200,'MANIFEST_FIELDS','invalid project metadata');
 const manifest={schema:'mark.rigpack-preview/1',formatStatus:'EXPERIMENTAL_NOT_CANONICAL_MARKSCENE',
  projectId,name,selection:{clipIndex,playbackTimeSeconds:0},
  asset:{path:ASSET,sourceName,license,sha256:inspection.sha256,byteLength:glb.length},
  semanticSummary:{skins:inspection.skins,morphs:inspection.morphs,animations:inspection.animations},
  limitations:['Original animated GLB source preserved exactly; no mesh editing or re-export of changed skins/morphs',
   'Not yet the production v3 .markscene container; use .markrigpack extension']};
 const archive=zipStored([[MANIFEST,encoder.encode(JSON.stringify(manifest,null,2)+'\n')],[ASSET,glb]]);
 return {archive,manifest,inspection,archiveSha256:HASH(archive)};
}

export function openRigPreviewPack(archive){
 const files=unzipStored(archive),manifestBytes=files.get(MANIFEST),glb=files.get(ASSET);
 requireThat(manifestBytes.length<50*1024,'MANIFEST_BUDGET','manifest too large');
 let manifest;try{manifest=JSON.parse(decoder.decode(manifestBytes));}
 catch(e){requireThat(false,'MANIFEST_JSON',e.message);}
 requireThat(manifest?.schema==='mark.rigpack-preview/1'&&
  manifest.formatStatus==='EXPERIMENTAL_NOT_CANONICAL_MARKSCENE',
  'MANIFEST_SCHEMA','wrong project format/version');
 requireThat(manifest.asset?.path===ASSET&&manifest.asset?.sha256===HASH(glb)&&
  manifest.asset.byteLength===glb.length,'ASSET_HASH','GLB hash/size changed');
 const inspection=inspectRiggedGlb(glb);
 requireThat(JSON.stringify(manifest.semanticSummary)===
  JSON.stringify({skins:inspection.skins,morphs:inspection.morphs,animations:inspection.animations}),
  'ASSET_SEMANTICS','manifest rig/clip inventory differs from actual source');
 return {manifest,glb,inspection,archiveSha256:HASH(raw(archive))};
}

export function reportRigPreviewRoundTrip(sourceBytes,loadedPack){
 return {schema:'mark.rigpack-roundtrip/1',
  status:'transport-only',
  sourcePreservation:comparePreservedRiggedGlb(sourceBytes,loadedPack.glb),
  unsupported:['No editable bone/UV/mesh operations in this preview',
   'No independent GLTFExporter re-serialization/animation playback verification yet',
   'No canonical production .markscene v3 persistence']};
}

