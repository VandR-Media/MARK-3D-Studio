/**
 * MARK Audio stereo PCM contract v1.
 * Consumes already decoded *real* LEFT/RIGHT PCM; never invokes a microphone.
 * Rolling 2048-sample Hann FFT at requested measurement cadence, separate L/R
 * frequency bins, RMS, peak and waveform. No audio playback thread blocking.
 * Production Android ExoPlayer PCM tap / worker integration NOT yet wired.
 */
export const AUDIO_SCHEMA='mark.audio.stereo/1';
const BANDS={low:[20,200],mid:[200,2000],high:[2000,16000]};
const zeroChannel=()=>({rms:0,peak:0,low:0,mid:0,high:0,waveform:Array(128).fill(0)});
const finite=x=>typeof x==='number'&&Number.isFinite(x),clamp=x=>Math.max(0,Math.min(1,x));
export function zeroStereoFrame({timestampMs=0,playing=false,source='silence'}={}){
 return {schema:AUDIO_SCHEMA,timestampMs,source,playing,left:zeroChannel(),right:zeroChannel(),beat:0,bass:0};
}
export function validateStereoFrame(frame){
 if(frame?.schema!==AUDIO_SCHEMA||!finite(frame.timestampMs)||frame.timestampMs<0||
  typeof frame.playing!=='boolean'||!['pcm','demo','silence'].includes(frame.source))
  throw Error('MARK Audio: invalid stereo frame');
 for(const side of ['left','right']){
  const c=frame[side];if(!c)throw Error('MARK Audio: missing '+side);
  for(const k of ['rms','peak','low','mid','high'])
   if(!finite(c[k])||c[k]<0||c[k]>1)throw Error('MARK Audio: invalid '+side+'.'+k);
  if(!Array.isArray(c.waveform)||c.waveform.length!==128||
   c.waveform.some(x=>!finite(x)||x< -1||x>1))
   throw Error('MARK Audio: waveform must be genuine 128 normalized PCM samples');
 }
 if(!finite(frame.beat)||frame.beat<0||frame.beat>1||!finite(frame.bass)||
  frame.bass<0||frame.bass>1)throw Error('MARK Audio: invalid beat/bass');
 return frame;
}
function fftMagnitude(windowed){
 const n=windowed.length,re=Float64Array.from(windowed),im=new Float64Array(n);
 let k=0;
 for(let i=1;i<n;i++){
  let bit=n>>1;while(k&bit){k^=bit;bit>>=1;}k^=bit;
  if(i<k){const t=re[i];re[i]=re[k];re[k]=t;}
 }
 for(let len=2;len<=n;len*=2){
  const angle=-2*Math.PI/len,wr=Math.cos(angle),wi=Math.sin(angle),half=len/2;
  for(let i=0;i<n;i+=len){
   let ur=1,ui=0;
   for(let j=0;j<half;j++){
    const m=i+j,p=m+half,vr=ur*re[p]-ui*im[p],vi=ur*im[p]+ui*re[p];
    re[p]=re[m]-vr;im[p]=im[m]-vi;re[m]+=vr;im[m]+=vi;
    const t=ur*wr-ui*wi;ui=ur*wi+ui*wr;ur=t;
   }
  }
 }
 return Float64Array.from({length:n/2+1},(_,i)=>Math.hypot(re[i],im[i]));
}
class Channel{
 constructor(n){this.buf=new Float32Array(n);this.n=n;this.write=0;this.count=0;}
 append(samples){
  if(!ArrayBuffer.isView(samples)&&!Array.isArray(samples))throw Error('PCM blocks must be arrays');
  for(let i=0;i<samples.length;i++){
   const value=samples[i];if(!finite(value)||value < -1.001||value>1.001)throw Error('PCM outside [-1,1]');
   this.buf[this.write]=Math.max(-1,Math.min(1,value));
   this.write=(this.write+1)%this.n;this.count=Math.min(this.count+1,this.n);
  }
 }
 measure(sampleRate){
  const n=this.n,samples=new Float32Array(n),missing=n-this.count;
  for(let i=missing;i<n;i++)samples[i]=this.buf[(this.write+n-(n-i))%n];
  let power=0,peak=0;
  for(const a of samples){power+=a*a;peak=Math.max(peak,Math.abs(a));}
  const windowed=new Float64Array(n);
  for(let i=0;i<n;i++)windowed[i]=samples[i]*(.5-.5*Math.cos(2*Math.PI*i/(n-1)));
  const bins=fftMagnitude(windowed),out={rms:clamp(Math.sqrt(power/n)),peak:clamp(peak)};
  for(const [key,[low,high]] of Object.entries(BANDS)){
   const start=Math.max(1,Math.ceil(low*n/sampleRate));
   const end=Math.min(n/2,Math.floor(high*n/sampleRate));
   let sum=0;
   for(let i=start;i<=end;i++)sum+=bins[i]*bins[i];
   // Hann window gain compensated using a fixed reference. These are normalized
   // visualization magnitudes, NOT calibrated dBFS.
   out[key]=clamp(Math.sqrt(sum)/(n*.612));
  }
  const waveform=[];
  for(let i=0;i<128;i++)waveform.push(samples[n-128+i]);
  out.waveform=waveform;
  return out;
 }
}
export class StereoPcmAnalyzer{
 constructor({sampleRate=48000,fftSize=2048}={}){
  if(!Number.isInteger(sampleRate)||sampleRate<8000||sampleRate>192000||
   !Number.isInteger(fftSize)||fftSize<512||fftSize>8192||(fftSize&(fftSize-1)))
   throw Error('Invalid PCM sampleRate / FFT size');
  this.sampleRate=sampleRate;this.fftSize=fftSize;
  this.left=new Channel(fftSize);this.right=new Channel(fftSize);
  this.previousBass=0;this.lastTimestampMs=0;this.playing=false;
 }
 reset(){this.left=new Channel(this.fftSize);this.right=new Channel(this.fftSize);
  this.previousBass=0;this.playing=false;}
 feed(left,right,{timestampMs=0}={}){
  if(!Number.isFinite(timestampMs)||timestampMs<0)throw Error('Invalid PCM clock');
  if(!left||!right||left.length!==right.length)throw Error('PCM L/R block length mismatch');
  if(left.length>this.sampleRate*2)throw Error('PCM block too large');
  this.left.append(left);this.right.append(right);this.lastTimestampMs=timestampMs;this.playing=true;
 }
 measure({playing=this.playing,timestampMs=this.lastTimestampMs}={}){
  if(!playing){this.previousBass=0;return zeroStereoFrame({timestampMs,playing:false});}
  const left=this.left.measure(this.sampleRate),right=this.right.measure(this.sampleRate);
  const bass=clamp((left.low+right.low)*.5);
  const onset=Math.max(0,bass-this.previousBass);
  this.previousBass=bass;
  return validateStereoFrame({schema:AUDIO_SCHEMA,timestampMs,source:'pcm',playing:true,
   left,right,bass,beat:clamp(onset*3.2)});
 }
}
