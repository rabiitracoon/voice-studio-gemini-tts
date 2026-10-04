import {check} from './core.mjs';

export function parseWav(buffer) {
  check(buffer.length>=44 && buffer.toString('ascii',0,4)==='RIFF' && buffer.toString('ascii',8,12)==='WAVE','API 응답이 유효한 WAV 파일이 아닙니다.',502);
  let format,pcm;
  for(let offset=12;offset+8<=buffer.length;) {
    const name=buffer.toString('ascii',offset,offset+4),size=buffer.readUInt32LE(offset+4),start=offset+8;
    check(start+size<=buffer.length,'음성 데이터가 잘렸습니다.',502);
    if(name==='fmt ') {
      check(size>=16,'WAV 형식 정보가 잘못되었습니다.',502);
      format={codec:buffer.readUInt16LE(start),channels:buffer.readUInt16LE(start+2),rate:buffer.readUInt32LE(start+4),bits:buffer.readUInt16LE(start+14)};
    }
    if(name==='data') pcm=buffer.subarray(start,start+size);
    offset=start+size+(size%2);
  }
  check(format && pcm?.length && format.codec===1 && format.channels===1 && format.rate===24000 && format.bits===16 && pcm.length%2===0,'24kHz·16bit·모노 PCM 음성이 필요합니다.',502);
  return {format,pcm,duration:pcm.length/48000};
}
export function wav(pcm) {
  const head=Buffer.alloc(44);
  head.write('RIFF');head.writeUInt32LE(pcm.length+36,4);head.write('WAVEfmt ',8);head.writeUInt32LE(16,16);
  head.writeUInt16LE(1,20);head.writeUInt16LE(1,22);head.writeUInt32LE(24000,24);head.writeUInt32LE(48000,28);
  head.writeUInt16LE(2,32);head.writeUInt16LE(16,34);head.write('data',36);head.writeUInt32LE(pcm.length,40);
  return Buffer.concat([head,pcm]);
}
// Decode RIFF chunks instead of joining WAV headers. Keep every sample, including pauses.
export function joinWavs(buffers) {return wav(Buffer.concat(buffers.map(b=>parseWav(b).pcm)));}
export function audioStats(buffer) {
  const {pcm,duration}=parseWav(buffer);let sum=0,peak=0,clipped=0;
  for(let i=0;i<pcm.length;i+=2) {const s=pcm.readInt16LE(i)/32768;sum+=s*s;peak=Math.max(peak,Math.abs(s));if(Math.abs(s)>.999)clipped++;}
  return {duration,peakDb:peak?20*Math.log10(peak):null,rmsDb:sum?20*Math.log10(Math.sqrt(sum/(pcm.length/2))):null,clippedSamples:clipped};
}
