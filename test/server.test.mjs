import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createStudio,ROOT} from '../server.mjs';
import {wav} from '../lib/audio.mjs';
import {ttsBody,DEFAULTS} from '../lib/core.mjs';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function fixture(t,{failCall=0,loginFn}={}) {
  const workspace=await mkdtemp(path.join(os.tmpdir(),'voice-studio-test-'));let calls=0;const requests=[];
  const gemini={load:async()=>{},status:()=>({configured:true,source:'test'}),redact:s=>s,synthesize:async(parts,profile)=>{requests.push({model:profile.ttsModel,body:ttsBody(parts,profile)});calls++;if(calls===failCall)throw new Error('테스트 API 오류');return {buffer:wav(Buffer.alloc(2400,1)),usage:{}};}};
  const analyzed=[],templatesUsed=[];
  const analyzer=async({project,template})=>templatesUsed.push(template)&&analyzed.push(project.profile.provider)&&project.segments.map(s=>({id:s.id,emotion:'따뜻함',style:'warm and reflective',reason:'테스트 연출',before:'',after:''}));
  const studio=await createStudio({root:ROOT,workspace,gemini,analyzer,auth:async provider=>({ready:true,message:'test '+provider}),loginFn});await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${studio.server.address().port}`;
  t.after(async()=>{await studio.close();await rm(workspace,{recursive:true,force:true});});
  async function api(route,body){const r=await fetch(base+'/api/'+route,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json','X-Studio-Request':'1'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
  async function complete(id){for(let i=0;i<300;i++){const r=await api('projects/'+id);if(!r.body.job)return r.body;await delay(10);}throw new Error('Test timed out');}
  async function prepared(script='오늘의 이야기를 시작합니다. 좋은 하루예요. '){const {body:p}=await api('projects',{title:'검증',script});await api(`projects/${p.id}/analyze`,{});return complete(p.id);}
  return {studio,base,workspace,analyzed,templatesUsed,api,complete,prepared,calls:()=>calls,requests:()=>structuredClone(requests)};
}
test('프롬프트 미리보기는 빈 줄·호흡·속도를 포함해 실제 생성 요청과 일치한다',async t=>{
  const f=await fixture(t),p=await f.prepared('\r\n\r\n'+Array.from({length:70},(_,i)=>`${i+1}번째 원문 그대로 읽는 문장입니다.\r\n\r\n`).join(''));
  const annotations=structuredClone(p.annotations),spoken=p.segments.findIndex(s=>s.text.trim());annotations[spoken].before='<breath>';annotations[spoken].after='<short pause>';
  for(let i=0;i<annotations.length;i++)if(!p.segments[i].text.trim())annotations[i].style='blank-only style must not be sent';
  const {body:saved}=await f.api(`projects/${p.id}/review`,{annotations,profile:{...p.profile,voice:'Sulafat',pace:'slow',chunkChars:800}});
  await f.api(`projects/${p.id}/approve`,{reviewHash:saved.reviewHash,confirmed:true});
  const {status,body:preview}=await f.api(`projects/${p.id}/prompt`);assert.equal(status,200);assert.equal(f.calls(),0);assert.ok(preview.chunkCount>1);
  assert.equal(preview.voice,'Sulafat');assert.equal(preview.reviewHash,saved.reviewHash);assert.ok(preview.text.includes('<breath>'));assert.ok(preview.text.includes('warm and reflective, animated and expressive, speaking slowly'));assert.ok(!preview.text.includes('blank-only style'));
  const parts=preview.requests.flatMap(r=>r.body.contents[0].parts);
  assert.equal(parts.map(part=>part.text).join(''),p.segments.map((s,i)=>annotations[i].before+s.text+annotations[i].after).join(''));
  assert.equal((await f.api(`projects/${p.id}`)).body.approvedHash,saved.reviewHash);
  await f.api(`projects/${p.id}/generate`,{});assert.equal((await f.complete(p.id)).status,'complete');assert.deepEqual(f.requests(),preview.requests);
});
test('수정 중인 프롬프트 확인은 원문·검수·승인을 저장하거나 음성을 생성하지 않는다',async t=>{
  const f=await fixture(t),p=await f.prepared();await f.api(`projects/${p.id}/approve`,{reviewHash:p.reviewHash,confirmed:true});
  const {body:before}=await f.api(`projects/${p.id}`),draft=structuredClone(p.annotations);draft[0].style='soft and thoughtful';
  const {status,body:preview}=await f.api(`projects/${p.id}/prompt`,{annotations:draft,profile:{...p.profile,voice:'Puck'}});
  assert.equal(status,200);assert.equal(preview.voice,'Puck');assert.ok(preview.text.includes('soft and thoughtful'));assert.notEqual(preview.reviewHash,p.reviewHash);
  assert.deepEqual((await f.api(`projects/${p.id}`)).body,before);assert.equal(f.calls(),0);
  draft[0].text='바꾸려는 원문';assert.equal((await f.api(`projects/${p.id}/prompt`,{annotations:draft,profile:p.profile})).status,400);assert.equal(f.calls(),0);
});
test('검수 완료 이전에는 실제 TTS 요청이 절대 발생하지 않는다',async t=>{const f=await fixture(t),p=await f.prepared();let r=await f.api(`projects/${p.id}/generate`,{});assert.equal(r.status,409);assert.equal(f.calls(),0);r=await f.api(`projects/${p.id}/approve`,{reviewHash:'stale',confirmed:true});assert.equal(r.status,409);assert.equal(f.calls(),0);});
test('검수 승인 후 생성·원문 다운로드·승인 취소가 동작한다',async t=>{const f=await fixture(t),p=await f.prepared();assert.equal((await f.api(`projects/${p.id}/approve`,{reviewHash:p.reviewHash,confirmed:true})).status,200);await f.api(`projects/${p.id}/generate`,{});const done=await f.complete(p.id);assert.equal(done.status,'complete');assert.equal(f.calls(),1);assert.equal(await(await fetch(f.base+done.output.original)).text(),p.script);assert.ok((await fetch(f.base+done.output.wav)).ok);const changed=structuredClone(done.annotations);changed[0].style='calm';const saved=await f.api(`projects/${p.id}/review`,{annotations:changed,profile:done.profile});assert.equal(saved.body.approvedHash,null);assert.equal((await f.api(`projects/${p.id}/generate`,{})).status,409);});
test('부분 실패 후 재시도는 성공한 구간을 재생성하지 않는다',async t=>{const f=await fixture(t,{failCall:2}),p=await f.prepared(Array.from({length:130},(_,i)=>`${i+1}번째 이야기도 같은 목소리로 끝까지 읽습니다. `).join(''));await f.api(`projects/${p.id}/approve`,{reviewHash:p.reviewHash,confirmed:true});await f.api(`projects/${p.id}/generate`,{});const failed=await f.complete(p.id);assert.equal(failed.status,'error');assert.equal(f.calls(),2);await f.api(`projects/${p.id}/generate`,{});const done=await f.complete(p.id);assert.equal(done.status,'complete');assert.equal(done.output.reused,1);assert.equal(f.calls(),done.output.chunks.length+1);});
test('검수 저장에 원문 수정 필드를 넣으면 차단한다',async t=>{const f=await fixture(t),p=await f.prepared();p.annotations[0].text='고친 원문';const r=await f.api(`projects/${p.id}/review`,{annotations:p.annotations,profile:p.profile});assert.equal(r.status,400);assert.equal(f.calls(),0);});
test('빈 줄을 포함한 기존 검수본은 재분석 없이 생성하고 원문을 그대로 내려받는다',async t=>{
  const f=await fixture(t),p=await f.prepared('\n\n첫 문장입니다.\r\n\r\n두 번째 문장입니다.\n\n');
  assert.ok(p.segments.some(s=>!s.text.trim()));
  await f.api(`projects/${p.id}/approve`,{reviewHash:p.reviewHash,confirmed:true});
  await f.api(`projects/${p.id}/generate`,{});const done=await f.complete(p.id);
  assert.equal(done.status,'complete');assert.deepEqual(done.segments,p.segments);assert.deepEqual(done.annotations,p.annotations);
  assert.equal(done.approvedHash,p.reviewHash);assert.equal(await(await fetch(f.base+done.output.original)).text(),p.script);
});
test('다른 웹사이트의 요청·CSRF·비공개 파일 다운로드를 차단한다',async t=>{const f=await fixture(t);assert.equal((await fetch(f.base+'/api/projects',{headers:{Origin:'https://foreign.example'}})).status,403);assert.equal((await fetch(f.base+'/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);assert.equal((await fetch(f.base+'/data/secrets.json')).status,404);assert.equal((await fetch(f.base+'/media/../data/secrets.json')).status,404);});
test('오디오 탐색 범위 요청과 작업의 영구 저장이 동작한다',async t=>{const f=await fixture(t),p=await f.prepared();await f.api(`projects/${p.id}/approve`,{reviewHash:p.reviewHash,confirmed:true});await f.api(`projects/${p.id}/generate`,{});const done=await f.complete(p.id),r=await fetch(f.base+done.output.wav,{headers:{Range:'bytes=0-43'}});assert.equal(r.status,206);assert.equal((await r.arrayBuffer()).byteLength,44);const stored=JSON.parse(await readFile(path.join(f.workspace,'data','projects',p.id,'project.json'),'utf8'));assert.equal(stored.script,p.script);assert.equal(stored.approvedHash,done.reviewHash);});
test('감정 분석 AI를 Claude로 선택하면 분석기가 provider를 받고 검수 해시는 유지된다',async t=>{
  const f=await fixture(t),{body:created}=await f.api('projects',{title:'AI 선택',script:'오늘의 이야기를 시작합니다.',profile:{...DEFAULTS,provider:'claude'}});
  assert.equal(created.profile.provider,'claude');await f.api(`projects/${created.id}/analyze`,{});const analyzed=await f.complete(created.id);assert.deepEqual(f.analyzed,['claude']);
  const {body:switched}=await f.api(`projects/${created.id}/review`,{annotations:analyzed.annotations,profile:{...analyzed.profile,provider:'gpt'}});
  assert.equal(switched.profile.provider,'gpt');assert.equal(switched.reviewHash,analyzed.reviewHash);
  await f.api(`projects/${created.id}/analyze`,{});await f.complete(created.id);assert.deepEqual(f.analyzed,['claude','gpt']);
  assert.equal((await f.api('projects',{title:'잘못된 AI',script:'문장입니다.',profile:{...DEFAULTS,provider:'bard'}})).status,400);
});
test('연결 상태는 GPT와 Claude를 따로 보고하고 로그인은 선택한 provider로 실행된다',async t=>{
  const logins=[],f=await fixture(t,{loginFn:async provider=>{logins.push(provider);}});
  const {body:status}=await f.api('status');assert.deepEqual(Object.keys(status.oauth),['gpt','claude']);assert.equal(status.oauth.claude.message,'test claude');assert.equal(status.settings.provider,'gpt');
  await f.api('login',{provider:'claude'});await f.api('login',{});await delay(20);assert.deepEqual(logins,['claude','gpt']);
  assert.equal((await f.api('login?provider=claude')).body.state,'complete');assert.equal((await f.api('login',{provider:'x'})).status,400);
  const {body:saved}=await f.api('settings',{...status.settings,provider:'claude',claudeModel:'claude-sonnet-5-5'});assert.equal(saved.settings.provider,'claude');assert.equal(saved.settings.claudeModel,'claude-sonnet-5-5');
});
test('장르 템플릿을 만들고 수정·복원·삭제할 수 있고, 분석에는 선택한 템플릿이 쓰인다',async t=>{
  const f=await fixture(t);let {body}=await f.api('templates');
  assert.ok(body.templates.length>=6);assert.equal(body.defaultId,'youtube-story');assert.ok(body.templates.every(x=>x.builtin));
  const {body:created}=await f.api('templates',{name:'게임 리뷰',content:'흥분한 게이머처럼 읽습니다.'});const id=created.template.id;assert.equal(created.template.builtin,false);
  assert.equal((await f.api(`templates/${id}`,{name:'게임 리뷰',content:'수정된 지침'})).body.template.content,'수정된 지침');
  const edited=await f.api('templates/horror',{name:'공포',content:'더 무섭게'});assert.equal(edited.body.template.modified,true);
  assert.equal((await f.api('templates/horror/delete',{})).status,400);
  const reset=await f.api('templates/horror/reset',{});assert.equal(reset.body.template.modified,false);assert.notEqual(reset.body.template.content,'더 무섭게');
  const {body:p}=await f.api('projects',{title:'템플릿',script:'갑자기 문이 열렸다.',profile:{...DEFAULTS,templateId:id}});
  await f.api(`projects/${p.id}/analyze`,{});const done=await f.complete(p.id);
  assert.equal(f.templatesUsed[0].content,'수정된 지침');assert.equal(done.analysis.templateName,'게임 리뷰');assert.equal(done.analysis.templateContent,'수정된 지침');
  await f.api('settings',{...DEFAULTS,templateId:id});const del=await f.api(`templates/${id}/delete`,{});assert.equal(del.body.settings.templateId,'youtube-story');
  assert.equal((await f.api(`projects/${p.id}/analyze`,{})).status,409);
  ({body}=await f.api('templates'));assert.ok(!body.templates.some(x=>x.id===id));
  assert.equal((await f.api('templates',{name:'',content:'x'})).status,400);
});
test('분석 프롬프트 미리보기는 저장하지 않은 지침과 고정 규칙·대본을 모두 보여 준다',async t=>{
  const f=await fixture(t);
  const {status,body}=await f.api('analysis-prompt',{script:'첫 문장입니다. 둘째 문장!',notes:'메모',profile:{...DEFAULTS,energy:'dramatic'},name:'임시',content:'원문을 고쳐서 읽어 주세요.'});
  assert.equal(status,200);assert.ok(body.text.includes('GENRE DIRECTING GUIDE: 임시'));assert.ok(body.text.includes('원문을 고쳐서 읽어 주세요.'));
  assert.ok(body.text.includes('must NEVER be rewritten'));assert.ok(body.text.includes('FIXED RULES'));assert.ok(body.text.includes('DRAMATIC'));assert.ok(body.text.includes('둘째 문장!'));
  const empty=await f.api('analysis-prompt',{script:'',profile:DEFAULTS});assert.equal(empty.status,200);assert.ok(empty.body.text.includes('썰 · 스토리텔링'));
  assert.equal(f.calls(),0);
});
