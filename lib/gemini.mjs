import {readFile,writeFile,chmod} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {check,ttsBody} from './core.mjs';
import {parseWav} from './audio.mjs';

const exec=promisify(execFile);
export const API_BASE='https://generativelanguage.googleapis.com/v1beta';
export class Gemini {
  constructor(root,{fetchImpl=fetch}={}) {this.root=root;this.fetch=fetchImpl;this.secret='';this.source='';}
  async load() {
    this.secret=(process.env.GEMINI_API_KEY||process.env.GOOGLE_API_KEY||'').trim();this.source=this.secret?'환경 변수':'';
    if(!this.secret)try {this.secret=JSON.parse(await readFile(path.join(this.root,'data','secrets.json'),'utf8')).geminiKey;this.source='이 Mac에 저장한 키';}catch{}
    if(!this.secret)try {
      const {stdout}=await exec('/usr/bin/textutil',['-convert','txt','-stdout',path.join(this.root,'API key.rtf')]);
      this.secret=stdout.match(/(?:AIza[A-Za-z0-9_-]+|AQ\.[A-Za-z0-9_.-]+)/)?.[0]||'';this.source=this.secret?'제공하신 API key.rtf':'';
    }catch{}
    return this.status();
  }
  status() {return {configured:!!this.secret,source:this.source};}
  async save(key) {
    check(typeof key==='string' && key.trim().length>=20 && key.trim().length<=500 && !/\s/.test(key.trim()),'Gemini API 키를 확인해 주세요.');
    await writeFile(path.join(this.root,'data','secrets.json'),JSON.stringify({geminiKey:key.trim()}),{mode:0o600});
    await chmod(path.join(this.root,'data','secrets.json'),0o600);this.secret=key.trim();this.source='이 Mac에 저장한 키';
  }
  redact(message) {return String(message).replaceAll(this.secret||'\0','[비공개 키]').replace(/(?:AIza[A-Za-z0-9_-]+|AQ\.[A-Za-z0-9_.-]+)/g,'[비공개 키]');}
  async request(route,{body,signal,retries=2}={}) {
    check(this.secret,'설정에서 Gemini API 키를 연결해 주세요.');
    for(let attempt=0;;attempt++) {
      if(signal?.aborted)throw new Error('작업이 취소되었습니다.');
      let response;
      try {response=await this.fetch(`${API_BASE}/${route}`,{method:body?'POST':'GET',headers:{'x-goog-api-key':this.secret,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(240000)]):AbortSignal.timeout(240000)});}
      catch {throw new Error(signal?.aborted?'작업이 취소되었습니다.':'Gemini 연결이 중단되었거나 시간이 초과되었습니다. 재시도 시 추가 요청 비용이 발생할 수 있습니다.');}
      const payload=await response.json().catch(()=>({}));
      if(response.ok)return payload;
      if([429,500,502,503,504].includes(response.status) && attempt<retries) {
        const wait=Math.min(30000,Math.max(1000,Number(response.headers.get('retry-after'))*1000||2000*2**attempt));
        await new Promise((resolve,reject)=>{const timer=setTimeout(done,wait);function done(){signal?.removeEventListener('abort',abort);resolve();}function abort(){clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(new Error('작업이 취소되었습니다.'));}signal?.addEventListener('abort',abort,{once:true});});continue;
      }
      const hint=response.status===404?'선택한 모델 또는 음성 ID의 이용 가능 여부를 확인해 주세요.':response.status===429?'API 할당량 또는 결제 설정을 확인해 주세요.':response.status===401||response.status===403?'API 키와 프로젝트 권한을 확인해 주세요.':'';
      throw Object.assign(new Error(`Gemini 요청 실패 (${response.status}). ${hint} ${this.redact(payload.error?.message||'응답을 확인해 주세요.').slice(0,1000)}`),{status:502});
    }
  }
  async models() {const r=await this.request('models?pageSize=1000');return (r.models||[]).filter(m=>(m.supportedGenerationMethods||[]).includes('generateContent')&&/tts/i.test(m.name)).map(m=>({id:m.name.replace(/^models\//,''),name:m.displayName||m.name}));}
  async listVoices() {const r=await this.request('voices?language_code=ko-KR&page_size=1000');return (r.voices||[]).map(v=>({id:v.id,name:v.display_name||v.displayName||v.id,description:v.description||'',type:v.type||''}));}
  async createVoice({name,description,gender},signal) {
    const result=await this.request('voices',{body:{store:true,voice:{model:'gemini-3.8-flash-tts',type:'prompted',display_name:name,language_code:'ko-KR',gender,prompted:{input:description}}},signal,retries:0});
    check(typeof result.id==='string' && result.id.startsWith('voice_'),'음성 생성 응답에 저장된 음성 ID가 없습니다.',502);
    const audio=result.sample_audio||result.sampleAudio;
    return {id:result.id,name,audio:audio?.data?Buffer.from(audio.data,'base64'):null};
  }
  async synthesize(parts,p,signal) {
    const result=await this.request(`models/${p.ttsModel}:generateContent`,{body:ttsBody(parts,p),signal});
    const candidate=result.candidates?.[0];
    check(!candidate?.finishReason || candidate.finishReason==='STOP',`음성이 완성되지 않았습니다 (${candidate?.finishReason}). 짧은 생성 구간을 선택해 다시 검수해 주세요.`,502);
    const audioParts=(candidate?.content?.parts||[]).filter(p=>p.inlineData?.data);
    check(audioParts.length===1,`Gemini가 완전한 음성 파일을 반환하지 않았습니다. ${result.promptFeedback?.blockReason||''}`,502);
    const inline=audioParts[0].inlineData;
    check(/audio\/(wav|x-wav)/i.test(inline.mimeType||''),'WAV 형식이 아닌 응답을 받았습니다.',502);
    const buffer=Buffer.from(inline.data,'base64');parseWav(buffer);
    return {buffer,usage:result.usageMetadata||{}};
  }
}
