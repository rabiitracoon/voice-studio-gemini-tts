import test from 'node:test';
import assert from 'node:assert/strict';
import {splitScript,validateAnnotations,hash,reviewHash,speechParts,chunkParts,ttsBody,DEFAULTS,profile} from '../lib/core.mjs';
import {wav,parseWav,joinWavs,audioStats} from '../lib/audio.mjs';
import {Gemini} from '../lib/gemini.mjs';
import {parseClaudeResult} from '../lib/claude.mjs';
function project(script='첫 번째 문장입니다.\r\n\r\n두 번째 문장입니다!  '){const segments=splitScript(script);return {script,sourceHash:hash(script),segments,profile:{...DEFAULTS,energy:'natural'},annotations:segments.map(s=>({id:s.id,emotion:'담담함',style:'calm',reason:'차분하게',before:'',after:''}))};}

test('원문 공백·CRLF·분해형 한글·이모지를 문자 단위로 보존한다',()=>{
  for(const script of ['  안녕!\r\n\r\n좋은 아침. \t끝입니다.  ','대본입니다. 🎙️ 안녕하세요?\n끝!','한'.repeat(900)+'😀'.repeat(300)+' 끝.']){const parts=splitScript(script);assert.equal(parts.map(s=>s.text).join(''),script);for(const s of parts){assert.equal(script.slice(s.start,s.end),s.text);assert.ok(!/[\uD800-\uDBFF]$/.test(s.text));}}
});
test('모델이 원문 필드를 반환하면 거부한다',()=>{const p=project();p.annotations[0].text='변경된 대본';assert.throws(()=>validateAnnotations(p.segments,p.annotations),/원문/);});
test('태그 구간의 누락·순서 변경·임의 음성 태그를 거부한다',()=>{const p=project();assert.throws(()=>validateAnnotations(p.segments,[]));assert.throws(()=>validateAnnotations(p.segments,[...p.annotations].reverse()));p.annotations[0].before='<explosion>';assert.throws(()=>validateAnnotations(p.segments,p.annotations));});
test('원문 손상·구간 손상은 음성 전송 전에 중단한다',()=>{const p=project();p.script+='추가';assert.throws(()=>speechParts(p),/원문/);const q=project();q.segments[0].text='바뀜';assert.throws(()=>reviewHash(q),/원문/);});
test('원문에 포함된 꺾쇠 태그는 몰래 정리하지 않고 거부한다',()=>{assert.throws(()=>splitScript('안녕 <laugh> 하세요.'),/꺾쇠/);});
test('감정 지시는 대본과 분리되어 Gemini 3.8 규격으로 전달된다',()=>{const p=project();p.annotations[0].before='<breath>';const parts=speechParts(p),body=ttsBody(parts,p.profile);assert.ok(parts[0].text.startsWith('<breath>'+p.segments[0].text));assert.deepEqual(parts[0].speech_metadata,{style:'calm'});assert.deepEqual(body.generationConfig.speechConfig,{voiceConfig:{voice:'Kore'}});assert.equal(body.generationConfig.responseFormat.audio.sampleRate,24000);assert.equal(parts.map(s=>s.text).join('').replace('<breath>',''),p.script);});
test('태그·목소리·속도·모델 변경은 승인 해시를 변경한다',()=>{const p=project(),initial=reviewHash(p);for(const [key,value]of [['voice','Sulafat'],['pace','slow'],['ttsModel','gemini-future-tts']]){const q=structuredClone(p);q.profile[key]=value;assert.notEqual(reviewHash(q),initial);}p.annotations[0].style='joyful';assert.notEqual(reviewHash(p),initial);});
test('최신 GPT 모델 ID는 코드 변경 없이 지정할 수 있다',()=>{assert.equal(profile({...DEFAULTS,gptModel:'gpt-future-sol'}).gptModel,'gpt-future-sol');assert.throws(()=>profile({...DEFAULTS,gptModel:'../invalid'}));});
test('긴 대본의 생성 구간은 순서와 모든 원문을 유지한다',()=>{const p=project('동일한 문장을 그대로 읽습니다. '.repeat(400));const parts=speechParts(p),chunks=chunkParts(parts,800);assert.ok(chunks.length>1);assert.deepEqual(chunks.flat(),parts);});
test('앞·중간·뒤의 빈 줄과 공백을 인접 문장에 보존해 빈 TTS 입력을 없앤다',()=>{
  for(const script of ['\n\n  첫 문장입니다.\n\n두 번째 문장입니다.\n\n','\r\n\t\r\n첫 문장입니다.\r\n\r\n\r\n두 번째 문장입니다!\r\n\r\n',' '.repeat(500)+'문장입니다.\n'+'\t'.repeat(500)]) {
    const p=project(script),snapshot=structuredClone(p),digest=reviewHash(p),parts=speechParts(p);
    assert.ok(p.segments.some(s=>!s.text.trim()),'회귀 사례에 공백 전용 구간이 있어야 한다');
    assert.ok(parts.every(part=>part.text.trim()));
    assert.equal(parts.map(part=>part.text).join(''),script);
    assert.deepEqual(p,snapshot);assert.equal(reviewHash(p),digest);
    assert.ok(ttsBody(parts,p.profile).contents[0].parts.every(part=>part.text.trim()));
  }
});
test('빈 줄의 검수된 호흡 태그도 순서대로 보존한다',()=>{
  const p=project('\n\n앞 문장입니다.\n\n뒤 문장입니다.\n\n');
  p.annotations.forEach((a,i)=>{if(!p.segments[i].text.trim()){a.before='<breath>';a.after='<short pause>';}});
  const expected=p.segments.map((s,i)=>p.annotations[i].before+s.text+p.annotations[i].after).join('');
  const parts=speechParts(p);assert.equal(parts.map(part=>part.text).join(''),expected);
  assert.ok(parts.every(part=>part.text.replace(/<[^>]*>/g,'').trim()));
});
test('비어 있는 어투는 선택적 메타데이터에서 생략한다',()=>{
  const p=project('대본을 그대로 읽습니다.');p.annotations[0].style='  ';
  const part=ttsBody(speechParts(p),p.profile).contents[0].parts[0];
  assert.equal(part.text,p.script);assert.ok(!('speech_metadata' in part));
  assert.throws(()=>ttsBody([{text:'\n\t ',speech_metadata:{style:''}}],p.profile),/빈 대본/);
});
test('WAV 결합은 RIFF 메타데이터를 건너뛰고 오디오 샘플만 보존한다',()=>{
  const a=Buffer.from([1,0,2,0]),b=Buffer.from([3,0,4,0]);const first=wav(a),junk=Buffer.from('JUNK\x04\0\0\0abcd','binary');const extended=Buffer.concat([first.subarray(0,12),junk,first.subarray(12)]);extended.writeUInt32LE(extended.length-8,4);
  assert.deepEqual(parseWav(extended).pcm,a);const joined=joinWavs([extended,wav(b)]);assert.deepEqual(parseWav(joined).pcm,Buffer.concat([a,b]));assert.equal(joined.length,52);
});
test('잘린 음성·다른 샘플링률·무음은 구분한다',()=>{assert.throws(()=>parseWav(wav(Buffer.alloc(8)).subarray(0,46)));const wrong=wav(Buffer.alloc(8));wrong.writeUInt32LE(8000,24);assert.throws(()=>parseWav(wrong));assert.equal(audioStats(wav(Buffer.alloc(8))).peakDb,null);});
test('API 응답의 MAX_TOKENS는 완성된 음성으로 저장하지 않는다',async()=>{const g=new Gemini('/tmp',{fetchImpl:async()=>new Response(JSON.stringify({candidates:[{finishReason:'MAX_TOKENS'}]}),{status:200})});g.secret='test-not-a-real-key';await assert.rejects(g.synthesize(speechParts(project()),DEFAULTS),/완성되지/);});
test('Gemini 키는 쿼리·요청 본문에 포함되지 않는다',async()=>{let request;const audio=wav(Buffer.alloc(40));const g=new Gemini('/tmp',{fetchImpl:async(url,args)=>{request={url,...args};return new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{inlineData:{mimeType:'audio/wav',data:audio.toString('base64')}}]}}]}),{status:200});}});g.secret='test-not-a-real-key';await g.synthesize(speechParts(project()),DEFAULTS);assert.equal(request.headers['x-goog-api-key'],g.secret);assert.ok(!request.url.includes(g.secret));assert.ok(!request.body.includes(g.secret));assert.equal(g.redact('key '+g.secret),'key [비공개 키]');});
test('감정 분석 AI와 Claude 모델 ID를 지정할 수 있고 잘못된 값은 거부한다',()=>{
  assert.equal(profile(DEFAULTS).provider,'gpt');
  assert.equal(profile({...DEFAULTS,provider:'claude',claudeModel:'claude-future-5'}).claudeModel,'claude-future-5');
  assert.throws(()=>profile({...DEFAULTS,provider:'other'}));assert.throws(()=>profile({...DEFAULTS,claudeModel:'../invalid'}));
});
test('감정 분석 AI 변경은 승인 해시를 바꾸지 않고, 요청 형식이 바뀐 이전 승인은 다시 검수해야 한다',()=>{
  const p=project(),initial=reviewHash(p),q=structuredClone(p);q.profile.provider='claude';q.profile.claudeModel='opus';assert.equal(reviewHash(q),initial);
  const {provider,claudeModel,...old}=p.profile;
  assert.notEqual(initial,hash({sourceHash:p.sourceHash,annotations:validateAnnotations(p.segments,p.annotations),profile:old}));
});
test('Claude CLI 결과에서 구조화 출력·텍스트 JSON·오류를 구분한다',()=>{
  const annotations=[{id:'s0001'}];
  assert.deepEqual(parseClaudeResult(JSON.stringify({type:'result',is_error:false,structured_output:{annotations}})).annotations,annotations);
  assert.deepEqual(parseClaudeResult(JSON.stringify([{type:'system'},{type:'result',result:'```json\n{"annotations":[{"id":"s0001"}]}\n```'}])).annotations,annotations);
  assert.throws(()=>parseClaudeResult(JSON.stringify({type:'result',is_error:true,result:'Not logged in'})),/Not logged in/);
  assert.throws(()=>parseClaudeResult(JSON.stringify({type:'result',result:'JSON이 아닙니다'})),/JSON/);assert.throws(()=>parseClaudeResult('not json'));
});
test('연속된 같은 연출은 한 part로 합치고, 연출이 바뀌는 곳에서만 나눈다',()=>{
  const p=project('첫 문장입니다. 둘째 문장인데,\n셋째 줄입니다. 넷째는 다릅니다. 다섯째도 다릅니다.');
  const styles=['warm','warm','warm','hushed and tense','hushed and tense'];p.annotations.forEach((a,i)=>{a.style=styles[i];});p.annotations[3].before='<short pause>';
  const parts=speechParts(p);assert.equal(p.segments.length,5);
  assert.deepEqual(parts.map(x=>x.speech_metadata.style),['warm','hushed and tense']);
  assert.equal(parts.map(x=>x.text).join(''),p.script.replace('넷째','<short pause>넷째'));
  p.profile.pace='brisk';assert.deepEqual(speechParts(p).map(x=>x.speech_metadata.style),['warm, speaking rapidly','hushed and tense, speaking rapidly']);
});
test('같은 연출이어도 생성 구간 길이를 넘기지 않도록 part를 나눈다',()=>{
  const p=project('같은 연출로 길게 이어지는 문장입니다. '.repeat(200));p.profile.chunkChars=800;
  const parts=speechParts(p);assert.ok(parts.length>1);assert.ok(parts.every(x=>x.text.length+x.speech_metadata.style.length<=800));assert.equal(parts.map(x=>x.text).join(''),p.script);
});
test('연기 강도는 모든 연출 지시에 같은 문구로 붙고 승인 해시를 바꾼다',()=>{
  const p=project(),natural=reviewHash(p);assert.equal(DEFAULTS.energy,'lively');
  p.profile.energy='lively';assert.deepEqual(speechParts(p).map(x=>x.speech_metadata.style),['calm, animated and expressive']);assert.notEqual(reviewHash(p),natural);
  p.annotations.forEach(a=>{a.style='';});p.profile.energy='dramatic';p.profile.pace='brisk';
  assert.deepEqual(speechParts(p).map(x=>x.speech_metadata.style),['highly animated, vivid and emphatic, speaking rapidly']);
  assert.throws(()=>profile({...DEFAULTS,energy:'loud'}));
});
