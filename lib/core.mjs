import {createHash} from 'node:crypto';

export const EMOTIONS = ['담담함','따뜻함','기쁨','설렘','슬픔','긴장','놀람','단호함','호기심','위로','분노','경외'];
export const EVENTS = ['', '<short pause>', '<breath>', '<sigh>', '<laugh>', '<chuckle>'];
export const VOICES = {Kore:'단단한', Orus:'단단한', Charon:'설명하는', Sulafat:'따뜻한', Iapetus:'명료한', Schedar:'고른', Sadaltager:'지적인', Achernar:'부드러운', Puck:'경쾌한', Zephyr:'밝은', Fenrir:'활기찬', Leda:'젊은', Aoede:'산뜻한', Callirrhoe:'편안한', Autonoe:'밝은', Enceladus:'숨결이 느껴지는', Umbriel:'편안한', Algieba:'매끄러운', Despina:'매끄러운', Erinome:'명료한', Algenib:'거친', Rasalgethi:'설명하는', Laomedeia:'경쾌한', Alnilam:'단단한', Gacrux:'성숙한', Pulcherrima:'힘 있는', Achird:'친근한', Zubenelgenubi:'자연스러운', Vindemiatrix:'온화한', Sadachbia:'생동감 있는'};
export const DEFAULTS = {gptModel:'gpt-6.1-sol',ttsModel:'gemini-3.8-flash-tts',voice:'Kore',pace:'natural',chunkChars:1400};
export function hash(value) {return createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');}
export function check(condition, message, status=400) {if(!condition) throw Object.assign(new Error(message),{status});}
export function shortText(value, limit, label, allowEmpty=false) {
  check(typeof value==='string' && value.length<=limit && (allowEmpty || value.trim().length>0), `${label}을(를) 확인해 주세요.`);
  check(!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value),`${label}에 허용되지 않는 문자가 있습니다.`);
  return value;
}
export function profile(input) {
  const p={...DEFAULTS,...input};
  for(const name of ['gptModel','ttsModel']) check(typeof p[name]==='string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,100}$/.test(p[name]),'모델 ID를 확인해 주세요.');
  check(typeof p.voice==='string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{1,200}$/.test(p.voice),'음성 ID를 확인해 주세요.');
  check(['natural','slow','brisk'].includes(p.pace),'읽기 속도를 확인해 주세요.');
  check([800,1400,2200].includes(p.chunkChars),'생성 구간 길이를 확인해 주세요.');
  return Object.fromEntries(Object.keys(DEFAULTS).map(k=>[k,p[k]]));
}
// The model never owns these strings. Slice the original without trim or Unicode normalization.
export function splitScript(script, maxChars=420) {
  shortText(script,60000,'대본');
  check(!/<[^>]*>/.test(script),'대본의 <…> 표기는 TTS 음성 태그로 해석될 수 있습니다. 꺾쇠 없는 원문을 사용해 주세요.');
  const sentence=new Intl.Segmenter('ko',{granularity:'sentence'});
  const units=[];
  for(const {segment} of sentence.segment(script)) {
    let rest=segment;
    while(rest.length>maxChars) {
      let end=rest.slice(0,maxChars+1).lastIndexOf(' ');
      if(end<maxChars/2) end=maxChars;
      else end+=1;
      const code=rest.charCodeAt(end-1);
      if(code>=0xd800 && code<=0xdbff) end-=1;
      units.push(rest.slice(0,end));rest=rest.slice(end);
    }
    if(rest)units.push(rest);
  }
  let offset=0;
  const segments=units.map((text,i)=>{const part={id:`s${String(i+1).padStart(4,'0')}`,start:offset,end:offset+text.length,text};offset+=text.length;return part;});
  check(segments.length<=800,'대본 구간이 너무 많습니다. 대본을 나누어 제작해 주세요.');
  check(segments.map(s=>s.text).join('')===script,'원문 보존 검사에 실패했습니다.');
  return segments;
}
export function validateAnnotations(segments, input) {
  check(Array.isArray(input)&&input.length===segments.length,'모든 구간의 감정 태그가 필요합니다.');
  return segments.map((segment,i)=>{
    const a=input[i];
    check(a && a.id===segment.id,'감정 태그의 순서 또는 구간이 일치하지 않습니다.');
    check(!Object.keys(a).some(k=>!['id','emotion','style','reason','before','after'].includes(k)),'감정 태그에 원문 또는 허용되지 않는 항목이 포함되어 있습니다.');
    check(EMOTIONS.includes(a.emotion),'감정을 선택해 주세요.');
    check(EVENTS.includes(a.before)&&EVENTS.includes(a.after),'지원되는 호흡·쉼 태그를 선택해 주세요.');
    shortText(a.style,180,'어투 지시',true);shortText(a.reason,400,'연출 설명',true);
    check(!/[<>]/.test(a.style),'어투에는 짧은 연출 지시만 작성해 주세요.');
    return {id:a.id,emotion:a.emotion,style:a.style,reason:a.reason,before:a.before,after:a.after};
  });
}
export function assertSource(project) {
  const expected=splitScript(project.script);
  check(hash(project.script)===project.sourceHash && JSON.stringify(expected)===JSON.stringify(project.segments),'원문 보존 검사에 실패했습니다. 음성 생성을 중단합니다.',409);
}
export function reviewHash(project) {
  assertSource(project);
  return hash({sourceHash:project.sourceHash,annotations:validateAnnotations(project.segments,project.annotations),profile:profile(project.profile)});
}
export function taggedScript(p) {
  return p.segments.map((s,i)=>{const a=p.annotations[i];return `⟦${a.emotion}${a.style?` · ${a.style}`:''}⟧${a.before}${s.text}${a.after}`;}).join('');
}
export function speechParts(project) {
  assertSource(project);
  const annotations=validateAnnotations(project.segments,project.annotations);
  const pace={natural:'',slow:'unhurried pace',brisk:'brisk pace'}[project.profile.pace];
  const parts=[];let leading='';
  project.segments.forEach((s,i)=>{
    const a=annotations[i];
    const text=a.before+s.text+a.after;
    // Gemini rejects standalone blank lines. Preserve their exact bytes and any
    // reviewed vocal events on the adjacent spoken part, without changing saved segments.
    if(!s.text.trim()) {
      if(parts.length)parts[parts.length-1].text+=text;
      else leading+=text;
      return;
    }
    parts.push({text:leading+text,speech_metadata:{style:[a.style,pace].filter(Boolean).join(', ')}});
    leading='';
  });
  check(parts.length>0,'음성으로 읽을 대본 내용이 없습니다.');
  return parts;
}
export function chunkParts(parts,maxChars=1400) {
  const chunks=[];let current=[],size=0;
  for(const part of parts) {
    // Budget the style too; leave headroom for 8,192 input and 16,384 audio tokens.
    const n=part.text.length+part.speech_metadata.style.length;
    if(current.length && (size+n>maxChars || current.length>=20)) {chunks.push(current);current=[];size=0;}
    current.push(part);size+=n;
  }
  if(current.length)chunks.push(current);
  return chunks;
}
export function ttsBody(parts,p) {
  check(Array.isArray(parts) && parts.length>0 && parts.every(part=>typeof part.text==='string' && part.text.trim().length>0),'빈 대본 구간을 음성 요청에 보낼 수 없습니다.');
  const input=parts.map(part=>{
    const metadata={...part.speech_metadata};
    if(typeof metadata.style==='string' && !metadata.style.trim())delete metadata.style;
    return {text:part.text,...(Object.keys(metadata).length?{speech_metadata:metadata}:{})};
  });
  return {contents:[{role:'user',parts:input}],generationConfig:{responseModalities:['AUDIO'],responseFormat:{audio:{mimeType:'AUDIO_WAV',sampleRate:24000}},speechConfig:{voiceConfig:{voice:p.voice}}}};
}
export function promptPreview(project) {
  const p={...project,profile:profile(project.profile)};
  const chunks=chunkParts(speechParts(p),p.profile.chunkChars);
  const requests=chunks.map(parts=>({model:p.profile.ttsModel,body:ttsBody(parts,p.profile)}));
  let partCount=0;
  const text=requests.map((request,i)=>{
    const parts=request.body.contents[0].parts;
    return `[음성 생성 ${i+1} / ${requests.length}]\n\n`+parts.map(part=>{
      partCount++;
      const style=part.speech_metadata?.style;
      return `[${partCount}번 연출 지시]\n${style||'(추가 연출 지시 없음)'}\n\n[${partCount}번 읽을 대본]\n${part.text}`;
    }).join('\n\n');
  }).join('\n\n────────────────────\n\n');
  return {model:p.profile.ttsModel,voice:p.profile.voice,chunkCount:chunks.length,partCount,text,requests};
}
