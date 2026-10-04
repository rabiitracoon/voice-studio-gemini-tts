import {readFile,writeFile,rename} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {check,shortText} from './core.mjs';

export const DEFAULT_TEMPLATE='youtube-story';
export const TEMPLATE_ID=/^[a-z0-9][a-z0-9-]{0,63}$/;
// Genre directing guides. Only this part of the analysis prompt is user-editable; the fixed
// rules (verbatim script, output schema, Gemini style/tag constraints) are always added around it.
export const BUILTIN_TEMPLATES=[
  {id:'youtube-story',name:'썰 · 스토리텔링',content:`목표: 친구에게 흥미진진한 썰을 풀어 주는 인기 유튜버처럼 읽습니다. 뉴스·다큐·아나운서처럼 평평하고 고른 낭독은 가장 피해야 할 실패입니다. 시청자는 화자가 이야기를 실제로 느낄 때 끝까지 듣습니다: 도입의 호기심, 점점 커지는 긴장, 충격, 어이없음, 결말의 웃음.

구성: 대본 전체를 먼저 읽고 훅 → 상황 설명 → 빌드업 → 클라이맥스 → 반전 → 리액션 → 마무리 비트로 나눕니다.

연출(style):
- 청자의 감정이 바뀌어야 하는 곳마다 style을 바꿉니다. 긴장·웃음 구간에서는 보통 1~3문장마다 바뀝니다. 감정이 고조되면 style도 함께 고조시킵니다. 짧은 영상은 보통 4~8종을 씁니다.
- 좋은 예: "eager and intrigued, rising inflection", "hushed and eerie, almost whispering", "tense and breathless, voice tightening", "panicked, urgent, louder", "deadpan and dry", "incredulous, pitch jumping up", "laughing while talking, amused", "playful and teasing, sing-song"
- calm, neutral, steady, matter-of-fact, relaxed, conversational 같은 단어는 아나운서 톤을 만듭니다. 반전 펀치라인처럼 의도적인 대비에만, 분명한 감정과 함께 씁니다.
- 인용 대사는 그 인물의 감정을 생생하게 연기해 주변 내레이션과 다르게 들리게 합니다.
- 반전 전후는 분명히 대비시킵니다. 예: 반전 전 "tense and ominous" → 반전 후 "deadpan and dry" 또는 "laughing disbelief".

호흡·리액션(before/after):
- 가장 강한 순간에 배치합니다: 충격 직전·직후 <gasp>, 웃긴 결말·황당한 디테일에 <chuckle>/<laugh>/<giggle>, 어이없음·안도에 <sigh>/<exhales>, 가벼운 못마땅함에 <tsk>, 강한 대사 앞 <breath>, 반전·펀치라인 직전 <short pause>, 큰 장면 전환에만 <long pause>.
- 짧은 영상 기준 3~8개. 모든 문장에 넣지 않습니다.`},
  {id:'horror',name:'공포 · 미스터리',content:`목표: 불 끄고 듣는 괴담·미스터리 채널처럼 읽습니다. 낮고 은밀하게 시작해 서서히 조여 오는 긴장, 결정적인 순간에 확 터지는 공포가 있어야 합니다. 평평한 낭독은 피합니다.

구성: 평범한 일상 → 이상한 징후 → 점점 커지는 불안 → 공포의 정점 → 서늘한 여운.

연출(style):
- 일상 부분은 오히려 담담하게 읽어 이후의 공포와 대비시킵니다. 불안이 커질수록 목소리를 낮추고 숨을 섞습니다.
- 좋은 예: "low and ominous, slow-building dread", "hushed, almost whispering, uneasy", "tense, breath held, voice trembling slightly", "sudden fear, sharp and louder", "shaken, unsettled whisper", "quiet and haunting, lingering"
- 인용 대사는 겁에 질리거나 기이하게 연기합니다.
- 공포의 정점 직후에는 짧게 숨을 고르는 듯한 여운을 남깁니다.

호흡·리액션(before/after):
- <breath>, <gasp>, <short pause>를 적극 활용합니다. 결정적인 문장 직전에 멈춰 긴장을 만들고, 장면이 바뀔 때 <long pause>를 씁니다.
- 웃음 태그는 쓰지 않습니다(의도된 기괴한 웃음 제외). 짧은 영상 기준 4~10개.`},
  {id:'comedy',name:'코미디 · 예능',content:`목표: 예능 자막이 떠오르는 리듬으로 읽습니다. 과장된 리액션, 어이없음, 빠른 텐션 변화가 핵심입니다. 진지한 척하다가 허무하게 끝나는 대비를 살립니다.

구성: 밑밥 → 점점 이상해지는 전개 → 펀치라인 → 리액션·마무리 멘트.

연출(style):
- 펀치라인 직전은 진지하거나 과장되게, 펀치라인 직후는 웃음이 섞이거나 허탈하게 대비시킵니다.
- 좋은 예: "cheeky and playful, bouncy", "mock-serious, overly dramatic", "exasperated, voice cracking up", "bursting with laughter", "deadpan and dry", "smug, teasing sing-song", "shocked, high-pitched disbelief"
- 인용 대사는 캐릭터를 살짝 과장해 흉내 내듯 연기합니다.

호흡·리액션(before/after):
- 펀치라인 앞 <short pause>, 직후 <laugh>/<chuckle>/<giggle>, 어이없을 때 <sigh>/<tsk>, 깜짝 놀랄 때 <gasp>.
- 짧은 영상 기준 5~10개. 같은 웃음 태그를 연달아 반복하지 않습니다.`},
  {id:'explainer',name:'정보 · 지식 해설',content:`목표: 똑똑하고 열정적인 지식 유튜버처럼 읽습니다. 신뢰감은 있지만 아나운서처럼 평평하지 않게, "이거 진짜 신기하지 않아요?" 하는 호기심과 놀라움을 전달합니다.

구성: 질문 훅 → 배경 → 핵심 설명 → 놀라운 사실 → 정리.

연출(style):
- 질문과 놀라운 사실에서 에너지를 올리고, 설명 구간은 명료하고 자신감 있게 읽습니다. 숫자·핵심 개념이 나오는 구간은 강조합니다.
- 좋은 예: "curious and engaging, rising inflection", "clear and confident, warm", "emphatic, stressing key points", "amazed, genuinely impressed", "thoughtful, slightly lowered voice", "upbeat and wrapping up"
- 과한 연기는 피하되 열정은 분명히 들리게 합니다.

호흡·리액션(before/after):
- 놀라운 사실 직전 <short pause>, 긴 설명 시작 전 가끔 <breath>. 웃음 태그는 가벼운 농담에만 씁니다.
- 짧은 영상 기준 2~5개.`},
  {id:'healing',name:'감동 · 힐링',content:`목표: 마음을 울리는 사연 채널처럼 읽습니다. 따뜻하고 진심 어린 목소리로, 감정이 차오르는 순간에는 목이 메이는 듯한 섬세함이 있어야 합니다.

구성: 잔잔한 시작 → 사연 전개 → 아픔·위기 → 감동의 순간 → 여운 있는 마무리.

연출(style):
- 감정의 정점을 가장 섬세하게 연출합니다. 과장된 흐느낌은 피합니다.
- 좋은 예: "soft and warm, intimate", "gentle, a little wistful", "heavy-hearted, voice lowering", "emotional, voice catching", "tearful but hopeful", "tender and reassuring"

호흡·리액션(before/after):
- <breath>, <sigh>, <exhales>, <short pause>를 쓰고, 마무리 여운에 <long pause>를 씁니다. 웃음은 미소 짓는 장면의 <chuckle>만 씁니다.
- 짧은 영상 기준 3~6개.`},
  {id:'issue',name:'이슈 · 시사 정리',content:`목표: 이슈를 빠르고 날카롭게 정리하는 시사 유튜버처럼 읽습니다. 신뢰감과 긴박감이 있고, 핵심에서 힘을 주며, 황당한 대목에서는 어이없음을 살짝 드러냅니다. 뉴스 앵커처럼 고르게 읽지 않습니다.

구성: 충격적인 훅 → 사건 배경 → 핵심 쟁점 → 반응·논란 → 정리.

연출(style):
- 좋은 예: "urgent and punchy", "serious, firm emphasis", "skeptical, slightly incredulous", "pointed and critical", "concerned, lowered voice", "brisk and decisive, wrapping up"
- 인용 발언은 발언자의 태도가 느껴지게 읽습니다.

호흡·리액션(before/after):
- 핵심 폭로 앞 <short pause>, 황당한 대목에 <sigh>/<tsk>. 웃음 태그는 거의 쓰지 않습니다.
- 짧은 영상 기준 2~5개.`}
];
const builtin=new Map(BUILTIN_TEMPLATES.map(t=>[t.id,t]));

export class Templates {
  constructor(dir) {this.file=path.join(dir,'templates.json');this.saved=[];}
  async load() {
    try {const value=JSON.parse(await readFile(this.file,'utf8'));if(Array.isArray(value.templates))this.saved=value.templates.filter(t=>TEMPLATE_ID.test(t?.id)&&typeof t.name==='string'&&typeof t.content==='string');}catch{}
    return this;
  }
  async persist() {const temp=this.file+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify({templates:this.saved},null,2),{mode:0o600});await rename(temp,this.file);}
  list() {
    const saved=new Map(this.saved.map(t=>[t.id,t]));
    const builtins=BUILTIN_TEMPLATES.map(t=>({...t,...saved.get(t.id),id:t.id,builtin:true,modified:saved.has(t.id)}));
    return [...builtins,...this.saved.filter(t=>!builtin.has(t.id)).map(t=>({...t,builtin:false,modified:false}))];
  }
  get(id) {return this.list().find(t=>t.id===id)||null;}
  async save({id,name,content}) {
    shortText(name,40,'템플릿 이름');shortText(content,8000,'템플릿 내용');
    if(id!==undefined)check(typeof id==='string' && this.get(id),'템플릿을 찾을 수 없습니다.',404);
    else {check(this.saved.filter(t=>!builtin.has(t.id)).length<50,'템플릿은 50개까지 저장할 수 있습니다.');id='custom-'+randomUUID().slice(0,8);}
    this.saved=[...this.saved.filter(t=>t.id!==id),{id,name:name.trim(),content,updatedAt:new Date().toISOString()}];
    await this.persist();return this.get(id);
  }
  async remove(id) {
    const t=this.get(id);check(t,'템플릿을 찾을 수 없습니다.',404);check(!t.builtin,'기본 템플릿은 삭제할 수 없습니다. 기본값 복원을 사용해 주세요.');
    this.saved=this.saved.filter(x=>x.id!==id);await this.persist();
  }
  async reset(id) {
    check(builtin.has(id),'기본 템플릿만 복원할 수 있습니다.');
    this.saved=this.saved.filter(x=>x.id!==id);await this.persist();return this.get(id);
  }
}
