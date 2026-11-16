/** GLB 2.0 parser/writer: edits JSON while preserving the original BIN chunk. */
const MAGIC=0x46546c67, JSON_CHUNK=0x4e4f534a, BIN_CHUNK=0x004e4942;
const dec=new TextDecoder('utf-8',{fatal:true}), enc=new TextEncoder();
function bytesOf(input) {
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer,input.byteOffset,input.byteLength);
  throw new TypeError('Требуется бинарный GLB-файл.');
}
export function parseGlb(input) {
  const bytes=bytesOf(input);
  if (bytes.length<20) throw new Error('Файл слишком короткий для GLB.');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if (view.getUint32(0,true)!==MAGIC) throw new Error('Неверная сигнатура GLB.');
  if (view.getUint32(4,true)!==2) throw new Error('Поддерживается только GLB 2.0.');
  if (view.getUint32(8,true)!==bytes.length) throw new Error('Длина GLB не совпадает с заголовком.');
  const chunks=[];let off=12;
  while(off<bytes.length) {
    if(off+8>bytes.length) throw new Error('Повреждён заголовок блока GLB.');
    const size=view.getUint32(off,true),type=view.getUint32(off+4,true);off+=8;
    if(size%4!==0||size>bytes.length-off) throw new Error('Повреждён размер блока GLB.');
    chunks.push({type,data:bytes.slice(off,off+size)});off+=size;
  }
  if(!chunks.length||chunks[0].type!==JSON_CHUNK) throw new Error('Первый блок GLB должен содержать JSON.');
  if(chunks.slice(1).some(c=>c.type===JSON_CHUNK)) throw new Error('В GLB несколько JSON-блоков.');
  let json;
  try{json=JSON.parse(dec.decode(chunks[0].data).replace(/[\u0000 \t\r\n]+$/gu,''));}
  catch(e){throw new Error('Некорректный JSON в GLB: '+e.message);}
  if(json?.asset?.version!=='2.0') throw new Error('Файл не содержит asset.version = 2.0.');
  return {json,chunks};
}
export function writeGlb(parsed,doc=parsed.json) {
  if(!parsed?.chunks?.length||parsed.chunks[0].type!==JSON_CHUNK) throw new Error('Нельзя экспортировать некорректный GLB.');
  const encoded=enc.encode(JSON.stringify(doc));
  const padded=new Uint8Array(Math.ceil(encoded.length/4)*4);padded.fill(32);padded.set(encoded);
  const chunks=[{type:JSON_CHUNK,data:padded},...parsed.chunks.slice(1)];
  const size=12+chunks.reduce((n,c)=>n+8+c.data.length,0);
  if(size>0xffffffff) throw new Error('GLB превышает 4 ГБ.');
  const output=new Uint8Array(size),v=new DataView(output.buffer);
  v.setUint32(0,MAGIC,true);v.setUint32(4,2,true);v.setUint32(8,size,true);
  let off=12;
  for(const chunk of chunks) {
    if(chunk.data.length%4) throw new Error('Размер блока GLB не кратен четырём.');
    v.setUint32(off,chunk.data.length,true);v.setUint32(off+4,chunk.type,true);
    output.set(chunk.data,off+8);off+=8+chunk.data.length;
  }
  return output;
}
export function isGlbWithBinary(parsed){return parsed.chunks.some(c=>c.type===BIN_CHUNK);}
export function assertSelfContainedGlb(doc) {
  const uris=[...(doc.buffers||[]).map(b=>b.uri),...(doc.images||[]).map(i=>i.uri)];
  if(uris.some(uri=>typeof uri==='string'&&!uri.startsWith('data:')))
    throw new Error('GLB содержит внешние файлы. Нужен самодостаточный GLB.');
}