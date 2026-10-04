import './voice-picker.js';
const $=s=>document.querySelector(s);
let state={status:null,project:null,dirty:false,busy:false,fileOriginal:null,loginPolling:{},prompt:null};
const providers={gpt:{name:'ChatGPT',model:'gptModel'},claude:{name:'Claude',model:'claudeModel'}};
const templateName=id=>state.templates?.find(t=>t.id===id)?.name||'삭제된 템플릿';
const analysisLabel=p=>`${providers[p.provider].name} OAuth · ${p[providers[p.provider].model]} · ${templateName(p.templateId)}`;
const labels={draft:'대본 준비',analyzing:'감정 분석 중',review:'검수 대기',approved:'생성 준비 완료',generating:'음성 생성 중',complete:'음성 완성',error:'확인 필요',cancelled:'취소됨',interrupted:'중단됨'};
const eventLabels={'':'없음','<short pause>':'짧은 쉼','<long pause>':'긴 쉼','<gasp>':'헉 (놀람)','<exhales>':'숨 내쉼','<giggle>':'킥킥','<tsk>':'쯧','<breath>':'호흡','<sigh>':'한숨','<laugh>':'웃음','<chuckle>':'작은 웃음'};
function el(tag,text,className) {const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;}
function notice(message) {$('#notice').textContent=message;$('#notice').hidden=!message;}
async function api(url,body) {
  const r=await fetch('/api/'+url,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json','X-Studio-Request':'1'},body:body===undefined?undefined:JSON.stringify(body)});
  const result=await r.json();if(!r.ok)throw new Error(result.error||'요청에 실패했습니다.');return result;
}
async function action(fn) {if(state.busy)return;state.busy=true;buttons();try{notice('');await fn();}catch(e){notice(e.message);}finally{state.busy=false;buttons();}}
function currentProfile() {return {...(state.project?.profile||state.status.settings),provider:$('#work-provider').value,templateId:$('#work-template').value,voice:$('#work-voice').value.trim(),energy:$('#work-energy').value,pace:$('#work-pace').value,chunkChars:Number($('#work-chunk').value)};}
function preset(p) {$('#work-provider').value=p.provider;setTemplate('#work-template',p.templateId);$('#work-voice').value=p.voice;$('#work-energy').value=p.energy;$('#work-pace').value=p.pace;$('#work-chunk').value=p.chunkChars;}
function markDirty() {if(state.project){state.dirty=true;$('#review-confirm').checked=false;queuePrompt();}buttons();}
let promptRevision=0,promptTimer;
function promptKey() {return state.project?.annotations.length?JSON.stringify({id:state.project.id,annotations:state.project.annotations,profile:currentProfile()}):null;}
function promptReady() {return !!state.prompt?.key&&state.prompt.key===promptKey();}
function queuePrompt() {
  clearTimeout(promptTimer);const revision=++promptRevision,p=state.project;state.prompt=null;
  $('#prompt-status').classList.remove('invalid');
  if(!p?.annotations.length){$('#gemini-prompt').value='';$('#prompt-profile').textContent='';return;}
  const key=promptKey(),body={annotations:structuredClone(p.annotations),profile:currentProfile()};
  $('#prompt-status').textContent='현재 연출 지시를 반영하고 있습니다…';buttons();
  promptTimer=setTimeout(async()=>{
    try {
      const preview=await api(`projects/${p.id}/prompt`,body);if(revision!==promptRevision||key!==promptKey())return;
      state.prompt={key,preview};const textbox=$('#gemini-prompt');textbox.value=preview.text;
      textbox.style.height='auto';textbox.style.height=Math.min(680,Math.max(340,textbox.scrollHeight+2))+'px';
      $('#prompt-profile').textContent=`${preview.voice} · ${preview.chunkCount}회 생성 · ${preview.partCount}개 입력 구간 · 연출 ${preview.styleCount}종 / 전환 ${preview.styleChanges}회`;
      $('#prompt-status').textContent='✓ 현재 설정으로 Gemini에 전달할 내용입니다.';
    }catch(e){if(revision!==promptRevision)return;$('#prompt-status').textContent=e.message;$('#prompt-status').classList.add('invalid');$('#gemini-prompt').value='';$('#prompt-profile').textContent='';}
    finally{if(revision===promptRevision)buttons();}
  },180);
}
function buttons() {
  const p=state.project,running=p?.job||false,locked=state.busy||running,hasTags=!!p?.annotations.length;
  $('#analyze').disabled=locked||!$('#script').value.trim();$('#analyze').textContent=p?.status==='analyzing'?'감정 분석 중…':hasTags?'감정 태그 다시 만들기 ↗':'감정 태그 만들기 ↗';
  $('#new-project').disabled=state.busy;$('#save-review').disabled=locked||!hasTags||!promptReady();$('#approve').disabled=locked||!hasTags||!$('#review-confirm').checked||!promptReady();
  const approved=hasTags&&!state.dirty&&p.approvedHash===p.reviewHash;
  $('#generate').disabled=locked||!approved||!state.status?.gemini.configured||!promptReady();$('#generate').textContent=p?.status==='generating'?'음성 생성 중…':p?.output&&p.output.reviewHash===p.reviewHash?'완성 음성 다시 불러오기 ▶':'음성 생성 ▶';
  $('#cancel').hidden=!running;$('#cancel').disabled=state.busy;
  for(const s of ['#work-provider','#work-template','#work-voice','#work-energy','#work-pace','#work-chunk'])$(s).disabled=locked;
  $('#approval-status').textContent=state.dirty?'태그 또는 목소리 설정이 변경되었습니다. 다시 검수 완료해 주세요.':approved?'검수 완료 · 아래 음성 생성 버튼을 눌러 주세요.':'검수 완료 후에만 음성을 생성할 수 있습니다.';
  $('#generation-title').textContent=running?(p.status==='analyzing'?'이야기의 감정을 읽고 있습니다':'목소리를 생성하고 있습니다'):approved?'검수가 끝났습니다. 목소리를 만들어 보세요.':p?.status==='complete'?'이야기가 목소리가 되었습니다':'목소리에 담을 준비를 해주세요';
  $('#generation-subtitle').textContent=approved?`${p.profile.voice} · ${p.profile.ttsModel} · 24kHz 무손실 WAV`:!state.status?.gemini.configured?'연결 및 목소리 설정에서 Gemini API 키를 먼저 연결해 주세요.':'감정 태그를 검수한 뒤 음성을 생성할 수 있습니다.';
  for(let i=1;i<=3;i++)$(`#step-${i}`).classList.toggle('active',i===1&&!hasTags&&!running||i===2&&(p?.status==='analyzing'||hasTags&&!approved)||i===3&&(approved||p?.status==='generating'||p?.status==='complete'));
  for(const n of document.querySelectorAll('.annotation textarea,.annotation select'))n.disabled=locked;
  $('#plain-style').disabled=locked;
  $('#copy-prompt').disabled=!promptReady();
}
async function refreshList() {
  const {projects}=await api('projects');$('#projects').replaceChildren();$('#project-count').textContent=projects.length;
  for(const p of projects){const b=el('button',undefined,'project-item'+(p.id===state.project?.id?' active':''));b.append(el('strong',p.title),el('small',`${labels[p.status]||p.status} · ${new Date(p.createdAt).toLocaleDateString('ko-KR')}`));b.addEventListener('click',()=>action(async()=>{if(state.dirty)await saveReview();await load(p.id);}));$('#projects').append(b);}
}
function select(options,value,onChange) {const s=el('select');for(const [key,text]of options){const o=el('option',text);o.value=key;s.append(o);}s.value=value;s.addEventListener('change',()=>onChange(s.value));return s;}
function renderAnnotations() {
  const p=state.project,has=!!p?.annotations.length;$('#review-empty').hidden=has;$('#prompt-review').hidden=!has;$('#review-toolbar').hidden=!has;$('#approval').hidden=!has;$('#segment-count').textContent=has?`${p.segments.length}개 구간`:'준비 전';$('#annotations').replaceChildren();
  queuePrompt();if(!has)return;
  p.segments.forEach((segment,i)=>{
    const a=p.annotations[i],card=el('article',undefined,'annotation'),head=el('div',undefined,'annotation-head');head.append(el('strong',`${i+1}번 구간`),el('span',`분석 감정 · ${a.emotion}`));
    const sourceLabel=el('label','대본 원문 · 읽기 전용'),source=el('textarea',undefined,'segment-source');source.value=segment.text;source.readOnly=true;source.rows=2;source.setAttribute('aria-label',`${i+1}번 구간의 대본 원문`);sourceLabel.append(source);card.append(head,sourceLabel);
    if(segment.text.trim()){
      const styleLabel=el('label','Gemini에 전달할 연출 지시'),input=el('textarea',undefined,'style-textbox');input.value=a.style;input.maxLength=180;input.rows=2;input.setAttribute('aria-label',`${i+1}번 구간의 연출 지시`);input.placeholder='예: warm and reassuring';input.addEventListener('input',()=>{state.project.annotations[i].style=input.value;markDirty();});styleLabel.append(input);card.append(styleLabel);
    }else card.append(el('p','이 공백 구간은 앞뒤 문장에 합쳐서 전달합니다.','blank-segment-note'));
    const events=el('div',undefined,'events-row');for(const [key,title]of [['before','앞 호흡 / 쉼'],['after','뒤 호흡 / 쉼']]){const label=el('label',title);label.append(select(state.status.events.map(e=>[e,eventLabels[e]]),a[key],v=>{state.project.annotations[i][key]=v;markDirty();}));events.append(label);}
    card.append(events,el('small',`분석 참고 · ${a.reason}`));$('#annotations').append(card);
  });
}
function renderOutput() {
  const p=state.project,o=p?.output,$out=$('#output');$out.replaceChildren();$out.hidden=!o;
  if(!o)return;
  const min=Math.floor(o.stats.duration/60),sec=Math.floor(o.stats.duration%60);
  $out.append(el('h2','완성된 내레이션'),el('p',`${o.voice} · ${min}분 ${sec}초 · 24kHz / 16bit / 모노 WAV${o.reviewHash!==p.reviewHash?' · 이전 검수본의 음성입니다.':''}`));
  const audio=el('audio');audio.controls=true;audio.preload='metadata';audio.src=o.wav;$out.append(audio);
  const links=el('div',undefined,'download-links');for(const [label,url]of [['WAV 내려받기',o.wav],['감정 태그 대본',o.tagged],['검수 기록',o.review],['원문 대본',o.original]]){const link=el('a',label);link.href=url+'?download';link.download='';links.append(link);}$out.append(links);
  const details=el('details');details.append(el('summary',`생성 구간 ${o.chunks.length}개 · 음질 확인`));const list=el('div',undefined,'chunk-list');for(const c of o.chunks){const item=el('div'),clip=el('audio');clip.controls=true;clip.preload='none';clip.src=c.url;item.append(el('p',`${c.index}번 · ${Math.round(c.stats.duration)}초`),clip);list.append(item);}details.append(list,el('p',`피크 ${o.stats.peakDb?.toFixed(1)??'무음'} dBFS · 잘린 샘플 ${o.stats.clippedSamples}개. 원본 음성을 그대로 보존합니다.`));$out.append(details);
}
function renderProject(p,{full=false}={}) {
  state.project=p;
  if(full){state.dirty=false;state.providerChanged=false;state.fileOriginal=null;$('#title').value=p.title;$('#script').value=p.script;$('#notes').value=p.notes;for(const selector of ['#title','#script','#notes'])$(selector).readOnly=true;$('#script-file').disabled=true;preset(p.profile);$('#review-confirm').checked=false;renderAnnotations();renderOutput();}
  $('#script-count').textContent=`${p.script.length.toLocaleString()}자`;$('#source-status').textContent='✓ 원문 보존 검사 통과';$('#analysis-model').textContent=analysisLabel(p.profile);
  $('#progress-wrap').hidden=!p.job;$('#progress-message').textContent=p.progress?.message||'';$('#progress-fill').style.width=p.progress?.total?`${p.progress.done/p.progress.total*100}%`:'12%';
  if(p.error)notice(p.error);buttons();
}
async function load(id) {renderProject(await api(`projects/${id}`),{full:true});await refreshList();localStorage.setItem('voiceStudioLastProject',id);}
function newProject() {
  state.project=null;state.dirty=false;state.providerChanged=false;state.fileOriginal=null;for(const s of ['#title','#script','#notes']){$(s).value='';$(s).readOnly=false;}$('#script-file').disabled=false;$('#script-file').value='';$('#script-count').textContent='0자';$('#source-status').textContent='원문을 입력해 주세요';$('#progress-wrap').hidden=true;preset(state.status.settings);$('#analysis-model').textContent=analysisLabel(state.status.settings);localStorage.removeItem('voiceStudioLastProject');renderAnnotations();renderOutput();notice('');buttons();refreshList().catch(e=>notice(e.message));$('#script').focus();
}
async function saveReview() {const p=state.project;if(!p)return;if(p.annotations.length){const updated=await api(`projects/${p.id}/review`,{annotations:p.annotations,profile:currentProfile()});state.dirty=false;renderProject(updated);}else{renderProject(await api(`projects/${p.id}/configure`,{profile:currentProfile()}));state.dirty=false;}}
$('#script').addEventListener('input',()=>{state.fileOriginal=null;$('#script-count').textContent=`${$('#script').value.length.toLocaleString()}자`;buttons();});
$('#script-file').addEventListener('change',()=>action(async()=>{const file=$('#script-file').files[0];if(!file)return;if(file.size>500000)throw new Error('텍스트 파일이 너무 큽니다. 60,000자 이내의 대본을 사용해 주세요.');const text=await file.text();if(text.includes('\uFFFD'))throw new Error('UTF-8 텍스트 파일을 사용해 주세요.');state.fileOriginal=text;$('#script').value=text;if(!$('#title').value)$('#title').value=file.name.replace(/\.txt$/i,'');$('#script-count').textContent=`${text.length.toLocaleString()}자`;buttons();}));
$('#analyze').addEventListener('click',()=>action(async()=>{
  if(!state.project){const script=state.fileOriginal??$('#script').value;const p=await api('projects',{title:$('#title').value.trim()||'새 음성 작업',script,notes:$('#notes').value,profile:currentProfile()});renderProject(p,{full:true});localStorage.setItem('voiceStudioLastProject',p.id);}else if(state.dirty||state.providerChanged)await saveReview();
  state.providerChanged=false;renderProject(await api(`projects/${state.project.id}/analyze`,{}));await refreshList();
}));
$('#new-project').addEventListener('click',()=>action(async()=>{if(state.dirty)await saveReview();newProject();}));
for(const s of ['#work-voice','#work-energy','#work-pace','#work-chunk'])$(s).addEventListener('change',markDirty);
for(const s of ['#work-provider','#work-template'])$(s).addEventListener('change',()=>{$('#analysis-model').textContent=analysisLabel(currentProfile());if(state.project)state.providerChanged=true;});
$('#review-confirm').addEventListener('change',buttons);
$('#copy-prompt').addEventListener('click',async()=>{if(!promptReady())return;try{await navigator.clipboard.writeText($('#gemini-prompt').value);notice('Gemini 프롬프트를 복사했습니다.');}catch{$('#gemini-prompt').focus();$('#gemini-prompt').select();notice('텍스트를 선택했습니다. ⌘C로 복사해 주세요.');}});
$('#save-review').addEventListener('click',()=>action(async()=>{await saveReview();notice('검수 내용을 저장했습니다.');}));
$('#approve').addEventListener('click',()=>action(async()=>{if(!$('#review-confirm').checked)return;await saveReview();renderProject(await api(`projects/${state.project.id}/approve`,{reviewHash:state.project.reviewHash,confirmed:true}));await refreshList();}));
$('#plain-style').addEventListener('click',()=>{for(const a of state.project.annotations){a.style='';a.before='';a.after='';a.emotion='담담함';a.reason='기본 목소리로 자연스럽게 읽습니다.';}markDirty();renderAnnotations();});
$('#generate').addEventListener('click',()=>action(async()=>{renderProject(await api(`projects/${state.project.id}/generate`,{}));await refreshList();}));
$('#cancel').addEventListener('click',()=>action(async()=>{await api(`projects/${state.project.id}/cancel`,{});notice('취소를 요청했습니다. 완료된 음성 구간은 보관됩니다.');}));

function renderStatus(r) {
  state.status=r;const names=Object.entries(providers).filter(([id])=>r.oauth[id].ready).map(([,v])=>v.name);$('#connection').textContent=names.length?`${names.join('·')} 연결됨`:'ChatGPT·Claude 로그인 필요';$('#connection-dot').classList.toggle('ready',names.length>0);$('#oauth-message').textContent=r.oauth.gpt.message;$('#claude-message').textContent=r.oauth.claude.message;$('#key-message').textContent=r.gemini.configured?`API 키 연결됨 · ${r.gemini.source}`:'Gemini API 키를 연결해 주세요.';
  addVoices(Object.entries(r.voices).map(([id,description])=>({id,name:id,description})));buttons();
}
function addVoices(voices) {for(const selector of ['#voice-id','#work-voice'])$(selector).addVoices(voices);}
$('#open-settings').addEventListener('click',()=>{const p=state.status.settings;$('#default-provider').value=p.provider;setTemplate('#default-template',p.templateId);$('#gpt-model').value=p.gptModel;$('#claude-model').value=p.claudeModel;$('#tts-model').value=p.ttsModel;$('#voice-id').value=p.voice;$('#api-key').value='';$('#settings-dialog').showModal();});
$('#close-settings').addEventListener('click',()=>$('#settings-dialog').close());
$('#settings-dialog').addEventListener('close',()=>$('#voice-id').close());
$('#save-settings').addEventListener('click',()=>action(async()=>{const p={...state.status.settings,provider:$('#default-provider').value,templateId:$('#default-template').value,gptModel:$('#gpt-model').value.trim(),claudeModel:$('#claude-model').value.trim(),ttsModel:$('#tts-model').value.trim(),voice:$('#voice-id').value.trim()};await api('settings',{...p,apiKey:$('#api-key').value.trim()});$('#api-key').value='';renderStatus(await api('status'));if(!state.project)preset(state.status.settings);$('#settings-dialog').close();notice('기본 설정을 저장했습니다. 새 작업부터 적용됩니다.');}));
$('#load-models').addEventListener('click',()=>action(async()=>{const {models}=await api('models');$('#tts-models').replaceChildren();for(const m of models){const o=el('option',m.name);o.value=m.id;$('#tts-models').append(o);}notice(`${models.length}개 TTS 모델을 확인했습니다.`);}));
$('#load-voices').addEventListener('click',()=>action(async()=>{const {voices}=await api('voices');addVoices(voices);$('#voice-id').open();if(!voices.length)notice('한국어 음성이 조회되지 않았습니다. 기본 제공 목소리를 사용할 수 있습니다.');}));
$('#design-voice').addEventListener('click',()=>action(async()=>{
  $('#design-voice').disabled=true;$('#design-result').textContent='전용 목소리를 만들고 있습니다…';
  try {const v=await api('voices',{name:$('#design-name').value,description:$('#design-description').value,gender:$('#design-gender').value});addVoices([v]);$('#voice-id').value=v.id;$('#design-result').replaceChildren(el('p',`생성 완료 · ${v.id}`));if(v.preview){const audio=el('audio');audio.controls=true;audio.src=v.preview;$('#design-result').append(audio);}}
  catch(e){$('#design-result').textContent=e.message;throw e;}finally{$('#design-voice').disabled=false;}
}));
for(const [provider,button,message] of [['gpt','#login','#login-message'],['claude','#claude-login','#claude-login-message']])$(button).addEventListener('click',()=>action(async()=>{const result=await api('login',{provider});$(message).textContent=result.message;state.loginPolling[provider]=true;}));
let polling=false;
setInterval(async()=>{
  if(polling||state.busy)return;polling=true;
  try {
    if(state.project?.job){const previous=state.project,next=await api(`projects/${previous.id}`);if(!next.job){renderProject(next,{full:true});await refreshList();}else renderProject(next);}
    for(const [provider,message] of [['gpt','#login-message'],['claude','#claude-login-message']])if(state.loginPolling[provider]){const r=await api(`login?provider=${provider}`);$(message).textContent=r.message||'';if(r.state!=='waiting'){state.loginPolling[provider]=false;renderStatus(await api('status'));}}
  }catch(e){notice(e.message);}finally{polling=false;}
},1200);
window.addEventListener('beforeunload',event=>{if(state.dirty){event.preventDefault();event.returnValue='';}});
// Analysis prompt templates: the genre guide is editable; fixed rules are shown in the full preview.
function templateOption(t) {const o=el('option',t.builtin?`${t.name}${t.modified?' · 수정됨':''}`:`${t.name} · 내 템플릿`);o.value=t.id;return o;}
function setTemplate(selector,id) {
  const n=$(selector);n.querySelector('option[data-missing]')?.remove();n.value=id;
  if(n.value!==id){const o=el('option','삭제된 템플릿');o.value=id;o.dataset.missing='1';n.append(o);n.value=id;}
}
async function loadTemplates() {
  const r=await api('templates');state.templates=r.templates;
  for(const s of ['#work-template','#default-template','#tpl-select']){const n=$(s),v=n.value;n.replaceChildren(...state.templates.map(templateOption));if(v)setTemplate(s,v);}
  $('#analysis-model').textContent=analysisLabel(state.status&&$('#work-template').value?currentProfile():state.status.settings);
}
let tpl={id:null,dirty:false},tplTimer,tplRevision=0;
function tplCurrent() {return state.templates.find(t=>t.id===tpl.id);}
function tplRender() {
  const t=tplCurrent();
  $('#tpl-reset').hidden=!t?.builtin||!t.modified;$('#tpl-delete').hidden=!t||t.builtin;
  $('#tpl-status').textContent=tpl.dirty?'저장하지 않은 변경이 있습니다.':!t?'새 템플릿입니다. 저장하면 목록에 추가됩니다.':t.builtin?(t.modified?'기본 템플릿을 수정해 사용 중입니다. 기본값 복원으로 되돌릴 수 있습니다.':'기본 템플릿입니다. 수정해서 저장할 수 있습니다.'):'직접 만든 템플릿입니다.';
  $('#tpl-save').disabled=!tpl.dirty;
}
function tplLoad(id) {const t=state.templates.find(x=>x.id===id)||state.templates[0];tpl={id:t.id,dirty:false};$('#tpl-select').value=t.id;$('#tpl-name').value=t.name;$('#tpl-content').value=t.content;tplRender();tplPreview();}
function tplDiscard() {return !tpl.dirty||confirm('저장하지 않은 템플릿 변경을 버릴까요?');}
function tplPreview() {
  clearTimeout(tplTimer);if(!$('#tpl-full').open)return;const revision=++tplRevision;
  tplTimer=setTimeout(async()=>{
    try {const r=await api('analysis-prompt',{script:state.fileOriginal??$('#script').value,notes:$('#notes').value,profile:{...currentProfile(),templateId:tpl.id||state.status.settings.templateId},name:$('#tpl-name').value,content:$('#tpl-content').value});if(revision===tplRevision)$('#tpl-preview').value=r.text;}
    catch(e){if(revision===tplRevision)$('#tpl-preview').value=e.message;}
  },250);
}
async function tplSave(asNew) {
  const body={name:$('#tpl-name').value,content:$('#tpl-content').value};
  const {template}=await api(asNew||!tpl.id?'templates':`templates/${tpl.id}`,body);
  await loadTemplates();tplLoad(template.id);notice(`'${template.name}' 템플릿을 저장했습니다.`);return template;
}
$('#open-templates').addEventListener('click',()=>{tplLoad($('#work-template').value);$('#template-dialog').showModal();});
$('#close-templates').addEventListener('click',()=>{if(tplDiscard())$('#template-dialog').close();});
$('#template-dialog').addEventListener('cancel',e=>{if(!tplDiscard())e.preventDefault();});
$('#tpl-select').addEventListener('change',()=>{if(tplDiscard())tplLoad($('#tpl-select').value);else $('#tpl-select').value=tpl.id;});
for(const s of ['#tpl-name','#tpl-content'])$(s).addEventListener('input',()=>{tpl.dirty=true;tplRender();tplPreview();});
$('#tpl-full').addEventListener('toggle',tplPreview);
$('#tpl-new').addEventListener('click',()=>{if(!tplDiscard())return;tpl={id:null,dirty:true};$('#tpl-name').value='새 장르 템플릿';$('#tpl-select').value='';tplRender();tplPreview();$('#tpl-name').select();});
$('#tpl-save').addEventListener('click',()=>action(()=>tplSave(false)));
$('#tpl-save-as').addEventListener('click',()=>action(async()=>{const t=tplCurrent();if(t&&$('#tpl-name').value.trim()===t.name)$('#tpl-name').value=`${t.name} 복사본`.slice(0,40);await tplSave(true);}));
$('#tpl-reset').addEventListener('click',()=>action(async()=>{if(!confirm('이 기본 템플릿을 처음 내용으로 되돌릴까요?'))return;await api(`templates/${tpl.id}/reset`,{});await loadTemplates();tplLoad(tpl.id);notice('기본 템플릿을 복원했습니다.');}));
$('#tpl-delete').addEventListener('click',()=>action(async()=>{const t=tplCurrent();if(!t||!confirm(`'${t.name}' 템플릿을 삭제할까요?`))return;const r=await api(`templates/${t.id}/delete`,{});state.status.settings=r.settings;await loadTemplates();tplLoad(state.status.settings.templateId);notice('템플릿을 삭제했습니다.');}));
$('#tpl-use').addEventListener('click',()=>action(async()=>{const t=tpl.dirty?await tplSave(false):tplCurrent();setTemplate('#work-template',t.id);$('#work-template').dispatchEvent(new Event('change'));$('#template-dialog').close();notice(`'${t.name}' 템플릿으로 감정 분석합니다.`);}));
await action(async()=>{renderStatus(await api('status'));await loadTemplates();preset(state.status.settings);const last=localStorage.getItem('voiceStudioLastProject');if(last){try{await load(last);}catch{newProject();}}else{await refreshList();buttons();}});
