import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,readFile,writeFile,rename,readdir,copyFile,stat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {DEFAULTS,PROVIDERS,VOICES,EMOTIONS,EVENTS,check,shortText,profile,hash,splitScript,validateAnnotations,reviewHash,taggedScript,speechParts,chunkParts,promptPreview} from './lib/core.mjs';
import {Gemini} from './lib/gemini.mjs';
import * as codex from './lib/codex.mjs';
import * as claude from './lib/claude.mjs';
import {joinWavs,audioStats,parseWav} from './lib/audio.mjs';
import {Templates,DEFAULT_TEMPLATE} from './lib/templates.mjs';
import {annotationPrompt} from './lib/annotation.mjs';

export const ROOT=path.dirname(fileURLToPath(import.meta.url));
const UUID=/^[0-9a-f-]{36}$/;
async function jsonWrite(file,value) {const temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(value,null,2),{mode:0o600});await rename(temp,file);}
const summaries=p=>({id:p.id,title:p.title,createdAt:p.createdAt,updatedAt:p.updatedAt,status:p.status,segmentCount:p.segments.length});

export async function createStudio({root=ROOT,workspace=process.env.TTS_WORKSPACE||root,gemini=new Gemini(workspace),analyzer=args=>(args.project.profile.provider==='claude'?claude:codex).annotate(args),auth=provider=>(provider==='claude'?claude:codex).authStatus(),loginFn=(provider,signal)=>(provider==='claude'?claude:codex).login(signal)}={}) {
  const data=path.join(workspace,'data');await mkdir(path.join(data,'projects'),{recursive:true,mode:0o700});
  await mkdir(path.join(data,'audio-cache'),{recursive:true,mode:0o700});await mkdir(path.join(data,'voice-previews'),{recursive:true,mode:0o700});
  await gemini.load();let settings=profile(DEFAULTS);const templates=await new Templates(data).load();
  try {settings=profile(JSON.parse(await readFile(path.join(data,'settings.json'),'utf8')));}catch{}
  const projects=new Map(),jobs=new Map();
  for(const id of await readdir(path.join(data,'projects')))if(UUID.test(id))try {
    const p=JSON.parse(await readFile(path.join(data,'projects',id,'project.json'),'utf8'));
    if(['analyzing','generating'].includes(p.status)){p.status='interrupted';p.error='프로그램이 종료되어 작업이 중단되었습니다. 분석 또는 생성을 다시 실행해 주세요.';}
    projects.set(id,p);
  }catch{}
  const projectDir=p=>path.join(data,'projects',p.id);
  async function save(p) {p.updatedAt=new Date().toISOString();await mkdir(projectDir(p),{recursive:true,mode:0o700});await jsonWrite(path.join(projectDir(p),'project.json'),p);}
  function get(id) {check(UUID.test(id)&&projects.has(id),'작업을 찾을 수 없습니다.',404);return projects.get(id);}
  function idle(p) {check(!jobs.has(p.id),'진행 중인 작업이 있습니다. 완료하거나 취소해 주세요.',409);}
  function visible(p) {return {...p,reviewHash:p.annotations.length?reviewHash(p):null,job:jobs.has(p.id)};}
  function startJob(p,type,work) {
    idle(p);const controller=new AbortController();jobs.set(p.id,controller);p.status=type;p.error='';p.progress={done:0,total:0,message:type==='analyzing'?'대본의 감정 흐름을 분석하고 있습니다.':'음성 생성을 준비하고 있습니다.'};
    const task=(async()=>{await save(p);await work(controller.signal);})().catch(async e=>{p.status=controller.signal.aborted?'cancelled':'error';p.error=gemini.redact(e.message);}).finally(async()=>{try{await save(p);}catch(e){console.error('작업 저장 실패:',gemini.redact(e.message));}jobs.delete(p.id);});
    controller.task=task;
  }
  async function generate(p,signal) {
    const approved=reviewHash(p);check(p.approvedHash===approved,'현재 태그와 목소리 설정을 먼저 검수 완료해 주세요.',409);
    const chunks=chunkParts(speechParts(p),p.profile.chunkChars),render=path.join(projectDir(p),'renders',approved);
    await mkdir(render,{recursive:true,mode:0o700});const audio=[],details=[];let reused=0;
    p.progress={done:0,total:chunks.length,message:`${chunks.length}개 구간을 같은 목소리로 생성합니다.`};await save(p);
    for(let i=0;i<chunks.length;i++) {
      if(signal.aborted)throw new Error('작업이 취소되었습니다.');
      const cacheKey=hash({model:p.profile.ttsModel,voice:p.profile.voice,parts:chunks[i],format:'wav-24000-16-mono'}),cached=path.join(data,'audio-cache',cacheKey+'.wav');
      let buffer,usage={};
      try {buffer=await readFile(cached);parseWav(buffer);reused++;}catch {
        const generated=await gemini.synthesize(chunks[i],p.profile,signal);buffer=generated.buffer;usage=generated.usage;
        await writeFile(cached,buffer,{mode:0o600});
      }
      const filename=`chunk-${String(i+1).padStart(4,'0')}.wav`;await copyFile(cached,path.join(render,filename));audio.push(buffer);
      details.push({index:i+1,filename,cacheKey,stats:audioStats(buffer),usage});
      p.progress={done:i+1,total:chunks.length,reused,message:`${i+1} / ${chunks.length} 구간 완료${reused?` · 저장된 ${reused}개 구간 재사용`:''}`};await save(p);
    }
    if(signal.aborted)throw new Error('작업이 취소되었습니다.');
    check(reviewHash(p)===approved && p.approvedHash===approved,'검수한 내용이 변경되었습니다.',409);
    const combined=joinWavs(audio),stats=audioStats(combined);
    await writeFile(path.join(render,'narration.wav'),combined,{mode:0o600});
    await writeFile(path.join(render,'original.txt'),p.script,{mode:0o600});await writeFile(path.join(render,'tagged-script.txt'),taggedScript(p),{mode:0o600});
    const manifest={version:1,createdAt:new Date().toISOString(),sourceHash:p.sourceHash,reviewHash:approved,profile:p.profile,script:p.script,segments:p.segments,annotations:p.annotations,chunks:details,stats,reused};
    await jsonWrite(path.join(render,'review.json'),manifest);
    const base=`/media/${p.id}/${approved}`;
    p.output={createdAt:manifest.createdAt,reviewHash:approved,voice:p.profile.voice,stats,reused,wav:`${base}/narration.wav`,original:`${base}/original.txt`,tagged:`${base}/tagged-script.txt`,review:`${base}/review.json`,chunks:details.map(d=>({...d,url:`${base}/${d.filename}`}))};
    p.status='complete';p.progress.message='음성이 완성되었습니다. 재생해서 확인하고 WAV로 내려받으세요.';
  }
  let authCache=null,authTime=0;
  async function status() {if(Date.now()-authTime>15000){const [gpt,claude]=await Promise.all([auth('gpt'),auth('claude')]);authCache={gpt,claude};authTime=Date.now();}return {appId:'voice-studio-v1',workspaceId:hash(workspace),oauth:authCache,gemini:gemini.status(),settings,voices:VOICES,emotions:EMOTIONS,events:EVENTS};}
  const loginJobs={};
  function loginProvider(value) {const provider=value??'gpt';check(PROVIDERS.includes(provider),'감정 분석 AI를 확인해 주세요.');return provider;}
  async function route(method,url,body) {
    const segments=url.pathname.split('/').filter(Boolean);
    if(url.pathname==='/api/status' && method==='GET')return status();
    if(url.pathname==='/api/settings' && method==='POST') {settings=profile(body);if(body.apiKey)await gemini.save(body.apiKey);await jsonWrite(path.join(data,'settings.json'),settings);return {settings,gemini:gemini.status()};}
    if(url.pathname==='/api/login' && method==='POST') {
      const provider=loginProvider(body.provider),name=provider==='claude'?'Claude':'ChatGPT';
      check(loginJobs[provider]?.state!=='waiting','로그인이 이미 진행 중입니다.',409);
      const controller=new AbortController(),job={state:'waiting',message:`열린 브라우저에서 ${name} 로그인을 완료해 주세요.`,controller};loginJobs[provider]=job;
      loginFn(provider,controller.signal).then(()=>{authTime=0;loginJobs[provider]={state:'complete',message:'로그인 완료. 연결 상태를 새로 확인해 주세요.'};}).catch(e=>{loginJobs[provider]={state:'error',message:gemini.redact(e.message)};});
      return {state:job.state,message:job.message};
    }
    if(url.pathname==='/api/login' && method==='GET') {const job=loginJobs[loginProvider(url.searchParams.get('provider'))];return job?{state:job.state,message:job.message}:{state:'idle'};}
    if(url.pathname==='/api/templates' && method==='GET')return {templates:templates.list(),defaultId:DEFAULT_TEMPLATE};
    if(url.pathname==='/api/templates' && method==='POST')return {template:await templates.save({name:body.name,content:body.content})};
    if(segments[0]==='api' && segments[1]==='templates' && segments[2] && method==='POST') {
      const id=segments[2],action=segments[3];
      if(!action)return {template:await templates.save({id,name:body.name,content:body.content})};
      if(action==='reset')return {template:await templates.reset(id)};
      if(action==='delete') {await templates.remove(id);if(settings.templateId===id){settings=profile({...settings,templateId:DEFAULT_TEMPLATE});await jsonWrite(path.join(data,'settings.json'),settings);}return {deleted:true,settings};}
    }
    // Shows the exact analysis prompt (fixed rules + genre guide + data) without calling any model.
    if(url.pathname==='/api/analysis-prompt' && method==='POST') {
      const draft=profile(body.profile),saved=templates.get(draft.templateId);
      const template=typeof body.content==='string'?{name:shortText(body.name??saved?.name??'',40,'템플릿 이름'),content:shortText(body.content,8000,'템플릿 내용')}:saved;
      check(template,'분석 템플릿을 찾을 수 없습니다.',404);
      const script=typeof body.script==='string'&&body.script.length?body.script:'';shortText(body.notes||'',1500,'연출 메모',true);
      return {text:annotationPrompt({notes:body.notes||'',script,profile:draft,segments:script?splitScript(script):[]},template)};
    }
    if(url.pathname==='/api/models' && method==='GET')return {models:await gemini.models()};
    if(url.pathname==='/api/voices' && method==='GET')return {voices:await gemini.listVoices()};
    if(url.pathname==='/api/voices' && method==='POST') {
      shortText(body.name,80,'목소리 이름');shortText(body.description,800,'목소리 설명');check(['male','female','neutral'].includes(body.gender),'목소리 성별을 선택해 주세요.');
      const result=await gemini.createVoice(body);let preview=null;
      if(result.audio){parseWav(result.audio);const filename=randomUUID()+'.wav';await writeFile(path.join(data,'voice-previews',filename),result.audio,{mode:0o600});preview='/media/voice-previews/'+filename;}
      return {id:result.id,name:result.name,preview};
    }
    if(url.pathname==='/api/projects' && method==='GET')return {projects:[...projects.values()].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(summaries)};
    if(url.pathname==='/api/projects' && method==='POST') {
      shortText(body.title,100,'작업 이름');shortText(body.notes||'',1500,'연출 메모',true);
      const p={id:randomUUID(),title:body.title,notes:body.notes||'',script:body.script,segments:splitScript(body.script),sourceHash:hash(body.script),annotations:[],profile:profile(body.profile||settings),approvedHash:null,output:null,status:'draft',error:'',createdAt:new Date().toISOString()};
      projects.set(p.id,p);await save(p);return visible(p);
    }
    if(segments[0]==='api' && segments[1]==='projects' && segments[2]) {
      const p=get(segments[2]),action=segments[3];
      if(!action && method==='GET')return visible(p);
      if(action==='prompt' && ['GET','POST'].includes(method)) {
        const draft=method==='POST'?{...p,annotations:validateAnnotations(p.segments,body.annotations),profile:profile(body.profile)}:p;
        return {...promptPreview(draft),reviewHash:reviewHash(draft)};
      }
      if(action==='configure' && method==='POST') {idle(p);p.profile=profile(body.profile);p.approvedHash=null;p.status=p.annotations.length?'review':'draft';await save(p);return visible(p);}
      if(action==='analyze' && method==='POST') {
        const template=templates.get(p.profile.templateId);check(template,'분석 템플릿을 찾을 수 없습니다. 다른 템플릿을 선택해 주세요.',409);
        startJob(p,'analyzing',async signal=>{const annotations=await analyzer({project:p,template,cwd:path.join(projectDir(p),'analysis',randomUUID()),signal});check(!signal.aborted,'작업이 취소되었습니다.');p.annotations=validateAnnotations(p.segments,annotations);
          p.analysis={at:new Date().toISOString(),provider:p.profile.provider,model:p.profile.provider==='claude'?p.profile.claudeModel:p.profile.gptModel,templateId:template.id,templateName:template.name,templateContent:template.content};p.approvedHash=null;p.status='review';p.progress={done:1,total:1,message:'감정 태그를 검수해 주세요.'};});return visible(p);
      }
      if(action==='review' && method==='POST') {
        idle(p);const next=validateAnnotations(p.segments,body.annotations),nextProfile=profile(body.profile);
        p.annotations=next;p.profile=nextProfile;p.approvedHash=null;p.status='review';p.error='';await save(p);return visible(p);
      }
      if(action==='approve' && method==='POST') {idle(p);const digest=reviewHash(p);check(body.reviewHash===digest && body.confirmed===true,'최신 감정 태그와 목소리 설정을 확인해 주세요.',409);p.approvedHash=digest;p.status='approved';await save(p);return visible(p);}
      if(action==='generate' && method==='POST') {check(gemini.status().configured,'Gemini API 키를 먼저 연결해 주세요.');check(p.annotations.length && p.approvedHash===reviewHash(p),'현재 태그를 검수 완료한 뒤 음성을 생성해 주세요.',409);startJob(p,'generating',signal=>generate(p,signal));return visible(p);}
      if(action==='cancel' && method==='POST') {jobs.get(p.id)?.abort();return {cancelRequested:true};}
    }
    throw Object.assign(new Error('요청을 찾을 수 없습니다.'),{status:404});
  }
  const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.wav':'audio/wav','.txt':'text/plain; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'};
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    function respond(status,value) {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));}
    try {
      const host=req.headers.host||'';check(/^(127\.0\.0\.1|localhost):\d+$/.test(host),'로컬 앱에서만 접근할 수 있습니다.',403);
      const origin=`http://${host}`;check(!req.headers.origin || req.headers.origin===origin,'다른 웹사이트에서 접근할 수 없습니다.',403);
      const url=new URL(req.url,origin);
      if(url.pathname.startsWith('/api/')) {
        let body={};
        if(req.method==='POST') {
          check(req.headers['x-studio-request']==='1','앱 화면에서 요청해 주세요.',403);
          check(req.headers['content-type']?.startsWith('application/json'),'JSON 요청이 필요합니다.',415);
          let length=0,parts=[];for await(const part of req){length+=part.length;check(length<=2e6,'요청 크기가 너무 큽니다.',413);parts.push(part);}
          try {body=JSON.parse(Buffer.concat(parts).toString());}catch{check(false,'요청 형식이 잘못되었습니다.');}
          check(body && !Array.isArray(body) && typeof body==='object','요청 형식이 잘못되었습니다.');
        }
        respond(200,await route(req.method,url,body));return;
      }
      check(req.method==='GET'||req.method==='HEAD','지원하지 않는 요청입니다.',405);
      let file;
      if(url.pathname.startsWith('/media/')) {
        const match=url.pathname.match(/^\/media\/([0-9a-f-]{36})\/([0-9a-f]{64})\/(narration\.wav|chunk-\d{4}\.wav|original\.txt|tagged-script\.txt|review\.json)$/);
        const voice=url.pathname.match(/^\/media\/voice-previews\/([0-9a-f-]{36}\.wav)$/);
        check(match||voice,'파일을 찾을 수 없습니다.',404);
        file=match?path.join(data,'projects',match[1],'renders',match[2],match[3]):path.join(data,'voice-previews',voice[1]);
      } else {
        const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
        check(['index.html','app.js','voice-picker.js','style.css'].includes(name),'파일을 찾을 수 없습니다.',404);file=path.join(root,'public',name);
      }
      const info=await stat(file);const content=await readFile(file),type=mime[path.extname(file)]||'application/octet-stream';
      if(url.searchParams.has('download'))res.setHeader('Content-Disposition',`attachment; filename="${path.basename(file)}"`);
      // Ranges let the audio player seek through long narrations.
      const range=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
      if(range){const start=Number(range[1]),end=Math.min(Number(range[2]||info.size-1),info.size-1);check(start<=end && start<info.size,'음성 범위가 잘못되었습니다.',416);res.writeHead(206,{'Content-Type':type,'Accept-Ranges':'bytes','Content-Range':`bytes ${start}-${end}/${info.size}`,'Content-Length':end-start+1});res.end(req.method==='HEAD'?undefined:content.subarray(start,end+1));}
      else {res.writeHead(200,{'Content-Type':type,'Accept-Ranges':'bytes','Content-Length':info.size});res.end(req.method==='HEAD'?undefined:content);}
    }catch(e){if(!res.headersSent)respond(e.status|| (e.code==='ENOENT'?404:500),{error:gemini.redact(e.message)});else res.end();}
  });
  return {server,projects,jobs,status,async close(){for(const j of Object.values(loginJobs))j.controller?.abort();for(const c of jobs.values())c.abort();await Promise.allSettled([...jobs.values()].map(c=>c.task));await new Promise(resolve=>server.close(resolve));}};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const studio=await createStudio();const port=Number(process.env.TTS_PORT||4319);
  studio.server.on('error',e=>{console.error(e.code==='EADDRINUSE'?`이미 실행 중이거나 ${port} 포트가 사용 중입니다.`:e.message);process.exitCode=1;});
  studio.server.listen(port,'127.0.0.1',()=>console.log(`VOICE STUDIO http://127.0.0.1:${port}`));
  for(const sig of ['SIGINT','SIGTERM'])process.once(sig,()=>studio.close().then(()=>process.exit(0)));
}
