/** HTML colors are sRGB; glTF baseColorFactor must be in linear-light space. */
export function srgbToLinear(x){x=Math.max(0,Math.min(1,x));return x<=0.04045?x/12.92:((x+0.055)/1.055)**2.4;}
export function linearToSrgb(x){x=Math.max(0,Math.min(1,x));return x<=0.0031308?x*12.92:1.055*x**(1/2.4)-0.055;}
export function hexToLinearRgb(hex){
  if(!/^#[\da-f]{6}$/i.test(hex)) throw new Error('Цвет должен иметь формат #RRGGBB.');
  return [1,3,5].map(i=>srgbToLinear(parseInt(hex.slice(i,i+2),16)/255));
}
export function linearRgbToHex(rgb){
  if(!Array.isArray(rgb)||rgb.length<3) throw new Error('Неверный цвет материала.');
  return '#'+rgb.slice(0,3).map(x=>Math.round(linearToSrgb(x)*255).toString(16).padStart(2,'0')).join('');
}
export function getMaterialValues(doc,i){
  const mat=doc?.materials?.[i];if(!mat)throw new RangeError('Материал не найден.');
  const p=mat.pbrMetallicRoughness||{};
  return {name:mat.name||'Материал '+(i+1),
    hex:linearRgbToHex(p.baseColorFactor||[1,1,1,1]),
    metallic:p.metallicFactor??1,roughness:p.roughnessFactor??1,
    unlit:Boolean(mat.extensions?.KHR_materials_unlit),textured:p.baseColorTexture!==undefined};
}
function unit(v,name){const n=Number(v);if(!Number.isFinite(n)||n<0||n>1)throw new RangeError(name+' должно быть от 0 до 1.');return n;}
export function setMaterialValues(doc,i,{hex,metallic,roughness}){
  const mat=doc?.materials?.[i];if(!mat)throw new RangeError('Материал не найден.');
  const p=mat.pbrMetallicRoughness||{};
  mat.pbrMetallicRoughness={...p,baseColorFactor:[...hexToLinearRgb(hex),p.baseColorFactor?.[3]??1],
    metallicFactor:unit(metallic,'Металличность'),roughnessFactor:unit(roughness,'Шероховатость')};
  return mat.pbrMetallicRoughness;
}