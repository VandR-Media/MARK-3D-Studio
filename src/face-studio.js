/**
 * Local-space, continuous-surface face deformations for a forward-facing (+Z)
 * humanoid practice mesh. NOT an automatic likeness generator for MARK Cosmic.
 * All effects change Float32 POSITION and are exported through MeshEditor.
 */
export const FACE_PARAMETERS=[
 ['headWidth','Ширина головы'],['headHeight','Высота головы'],
 ['forehead','Лоб'],['cheeks','Объём щёк'],['cheekbones','Скулы'],
 ['jawWidth','Ширина челюсти'],['chin','Подбородок'],
 ['noseWidth','Ширина носа'],['noseLength','Длина носа'],['noseBridge','Переносица'],
 ['eyesHeight','Положение глаз'],['eyeSockets','Глазницы'],
 ['mouthWidth','Ширина рта'],['lips','Объём губ'],['ears','Уши'],['nostrils','Ноздри'],
 ['eyesSpacing','Расстояние глазниц'],['eyeSize','Размер глазниц'],
 ['upperEyelid','Контур верхнего века'],['lowerEyelid','Контур нижнего века']
];
const valid=new Set(FACE_PARAMETERS.map(p=>p[0]));
const gauss=(x,c,r)=>Math.exp(-2*(((x-c)/r)**2));
const clamp=(v,min,max)=>Math.min(max,Math.max(min,v));
export function deformFace(editor,param,amount){
 if(!valid.has(param))throw Error('Face Studio: неизвестный параметр');
 if(!Number.isFinite(amount)||Math.abs(amount)>1)throw Error('Face Studio: значение должно быть от −1 до 1');
 if(!editor?.positions||editor.positions.length<9||typeof editor.begin!=='function')throw Error('Face Studio: выберите полигональную сетку головы');
 if(amount===0)return false;
 const p=editor.positions;
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
 for(let i=0;i<p.length;i+=3)for(let axis=0;axis<3;axis++){
  min[axis]=Math.min(min[axis],p[i+axis]);max[axis]=Math.max(max[axis],p[i+axis]);
 }
 const w=Math.max(1e-5,(max[0]-min[0])/2),h=Math.max(1e-5,(max[1]-min[1])/2),
  d=Math.max(1e-5,max[2]-min[2]);
 const cx=(min[0]+max[0])/2,cy=(min[1]+max[1])/2,cz=(min[2]+max[2])/2;
 if(w<1e-4||h<1e-4||d<1e-4)throw Error('Face Studio: недостаточный объём модели');
 const frontGate=z=>clamp((z-.0)/.22,0,1); // normalized z relative to full head depth
 editor.begin();
 try{
  let touched=0;
  for(let i=0;i<p.length;i+=3){
   const x=(p[i]-cx)/w,y=(p[i+1]-cy)/h,z=(p[i+2]-cz)/d;
   const front=frontGate(z),absx=Math.abs(x),side=Math.sign(x);
   let dx=0,dy=0,dz=0;
   switch(param){
    case 'headWidth':dx=amount*.13*x;break;
    case 'headHeight':dy=amount*.12*y;break;
    case 'forehead':dz=amount*.12*gauss(absx,0,.8)*gauss(y,.66,.32)*front;break;
    case 'cheeks':dz=amount*.14*gauss(absx,.48,.26)*gauss(y,-.12,.27)*front;break;
    case 'cheekbones':dz=amount*.10*gauss(absx,.53,.21)*gauss(y,.10,.22)*front;break;
    case 'jawWidth':dx=amount*.12*side*gauss(absx,.55,.38)*gauss(y,-.66,.31);break;
    case 'chin':dz=amount*.16*gauss(absx,0,.32)*gauss(y,-.73,.22)*front;break;
    case 'noseWidth':dx=amount*.09*side*gauss(absx,.12,.16)*gauss(y,-.06,.25)*front;break;
    case 'noseLength':dz=amount*.24*gauss(absx,0,.18)*gauss(y,-.13,.22)*front;break;
    case 'noseBridge':dz=amount*.15*gauss(absx,0,.14)*gauss(y,.17,.27)*front;break;
    case 'eyesHeight':dy=amount*.11*gauss(absx,.40,.21)*gauss(y,.36,.16)*front;break;
    case 'eyesSpacing':dx=amount*.10*side*gauss(absx,.40,.23)*gauss(y,.36,.21)*front;break;
    case 'eyeSize':
     dx=amount*.075*(x-side*.40)*gauss(absx,.40,.25)*gauss(y,.36,.22)*front;
     dy=amount*.065*(y-.36)*gauss(absx,.40,.25)*gauss(y,.36,.22)*front;break;
    case 'upperEyelid':
     dy=amount*.055*gauss(absx,.40,.22)*gauss(y,.49,.12)*front;
     dz=amount*.03*gauss(absx,.40,.22)*gauss(y,.49,.12)*front;break;
    case 'lowerEyelid':
     dy=-amount*.055*gauss(absx,.40,.22)*gauss(y,.26,.12)*front;
     dz=amount*.025*gauss(absx,.40,.22)*gauss(y,.26,.12)*front;break;
    case 'eyeSockets':dz=-amount*.10*gauss(absx,.4,.2)*gauss(y,.37,.17)*front;break;
    case 'mouthWidth':dx=amount*.09*side*gauss(absx,.22,.27)*gauss(y,-.43,.13)*front;break;
    case 'lips':dz=amount*.085*gauss(absx,.14,.29)*gauss(y,-.44,.10)*front;break;
    case 'ears':dx=amount*.11*side*gauss(absx,.87,.14)*gauss(y,-.06,.3);break;
    case 'nostrils':dz=-amount*.055*gauss(absx,.13,.07)*gauss(y,-.20,.065)*front;break;
   }
   const X=p[i]+dx*w,Y=p[i+1]+dy*h,Z=p[i+2]+dz*d;
   if(!Number.isFinite(X+Y+Z))throw Error('Face Studio: ошибочное преобразование');
   if(Math.abs(X-p[i])+Math.abs(Y-p[i+1])+Math.abs(Z-p[i+2])>1e-8){p[i]=X;p[i+1]=Y;p[i+2]=Z;touched++;}
  }
  if(!touched){editor.cancel();return false;}
  return editor.commit();
 }catch(err){editor.cancel();throw err;}
}
