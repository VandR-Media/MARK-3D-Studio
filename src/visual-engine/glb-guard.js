/**
 * Explicit import gate for Visual Engine v2.
 * No silent loss of skinning, animation or unsupported glTF extensions.
 * Supported static glTF 2.0 PBR/textured multi-mesh scenes only.
 */
import {parseGlb,assertSelfContainedGlb} from '../glb.js';
const SUPPORTED_EXTENSIONS=new Set([
 'KHR_materials_transmission','KHR_materials_ior','KHR_materials_clearcoat',
 'KHR_materials_volume','KHR_materials_emissive_strength',
 'KHR_texture_transform','KHR_lights_punctual','KHR_materials_unlit'
]);
export function inspectVisualImport(input){
 const parsed=parseGlb(input),doc=parsed.json;
 assertSelfContainedGlb(doc);
 if((doc.skins||[]).length)throw Error('Скелетный GLB пока не поддерживается в Visual Engine v2. Импорт отменён без изменений.');
 if((doc.animations||[]).length)throw Error('Анимированный GLB не импортирован: его клипы ещё не сохраняются при экспорте.');
 for(const mesh of doc.meshes||[])for(const primitive of mesh.primitives||[])
  if(primitive.targets?.length)throw Error('GLB с morph targets заблокирован, пока не подтверждён обратный экспорт.');
 const unsupported=(doc.extensionsUsed||[]).filter(name=>!SUPPORTED_EXTENSIONS.has(name));
 if(unsupported.length)throw Error('GLB требует неподдерживаемые расширения: '+unsupported.join(', '));
 if(!doc.meshes?.length)throw Error('GLB не содержит полигональных мешей.');
 if((doc.nodes||[]).length>4000||doc.meshes.length>1500)throw Error('Модель превышает ресурсный лимит мобильной сцены.');
 return {meshes:doc.meshes.length,nodes:doc.nodes?.length||0,materials:doc.materials?.length||0,
  images:doc.images?.length||0,textures:doc.textures?.length||0,
  note:'Supported static PBR glTF. Compare exported GLB; no generic extension-lossless guarantee.'};
}
