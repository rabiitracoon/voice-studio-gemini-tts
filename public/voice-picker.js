const node=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;};

// Keep the choices in the page: native datalist popups filter on the selected ID
// and their browser-owned surface cannot be styled or kept stable by the app.
class VoicePicker extends HTMLElement {
  #voices=new Map();
  #value='Kore';
  #outside=event=>{if(!this.contains(event.target))this.close();};

  connectedCallback() {
    document.addEventListener('click',this.#outside);
    if(this.trigger)return;
    this.classList.add('voice-picker');
    this.label=this.getAttribute('aria-label')||'목소리';
    this.trigger=node('button',undefined,'voice-trigger');this.trigger.type='button';
    this.titleNode=node('span');this.arrow=node('span','⌄','voice-arrow');this.arrow.setAttribute('aria-hidden','true');
    this.trigger.append(this.titleNode,this.arrow);
    this.panel=node('div',undefined,'voice-panel');this.panel.id=this.id+'-choices';this.panel.hidden=true;
    this.trigger.setAttribute('aria-controls',this.panel.id);this.trigger.setAttribute('aria-expanded','false');
    this.search=node('input');this.search.type='search';this.search.placeholder='이름 또는 특징으로 찾기';this.search.autocomplete='off';this.search.setAttribute('aria-label',this.label+' 검색');
    this.count=node('p',undefined,'voice-count');this.count.setAttribute('aria-live','polite');
    this.list=node('ul',undefined,'voice-choices');this.list.setAttribute('aria-label',this.label+' 목록');
    this.custom=node('details',undefined,'voice-custom');this.custom.append(node('summary','전용 음성 ID 직접 입력'));
    const row=node('div',undefined,'input-button');this.customInput=node('input');this.customInput.placeholder='voice_…';this.customInput.maxLength=201;this.customInput.setAttribute('aria-label',this.label+' 음성 ID');
    const apply=node('button','ID 사용','secondary');apply.type='button';row.append(this.customInput,apply);
    this.error=node('p',undefined,'voice-error');this.error.setAttribute('role','status');this.error.hidden=true;this.custom.append(row,this.error);
    this.panel.append(this.search,this.count,this.list,this.custom);this.append(this.trigger,this.panel);
    this.trigger.addEventListener('click',()=>this.panel.hidden?this.open():this.close());
    this.trigger.addEventListener('keydown',event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();this.open();const options=this.options();(event.key==='ArrowUp'?options.at(-1):options.find(n=>n.getAttribute('aria-pressed')==='true')||options[0])?.focus();}});
    this.search.addEventListener('input',()=>this.renderChoices());
    this.search.addEventListener('keydown',event=>{if(event.key==='ArrowDown'){event.preventDefault();this.options()[0]?.focus();}});
    this.list.addEventListener('keydown',event=>{
      const options=this.options(),index=options.indexOf(event.target);if(index<0)return;
      let next;if(event.key==='ArrowDown')next=(index+1)%options.length;else if(event.key==='ArrowUp')next=(index-1+options.length)%options.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=options.length-1;
      if(next!==undefined){event.preventDefault();options[next].focus();}
    });
    this.addEventListener('keydown',event=>{if(event.key==='Escape'&&!this.panel.hidden){event.preventDefault();event.stopPropagation();this.close(true);}});
    // Only a committed voice choice should invalidate the script review.
    for(const type of ['input','change'])this.addEventListener(type,event=>{if(event.target!==this)event.stopPropagation();});
    apply.addEventListener('click',()=>this.applyCustom());
    this.customInput.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();this.applyCustom();}});
    this.value=this.getAttribute('value')||this.#value;this.disabled=this.hasAttribute('disabled');
  }

  disconnectedCallback() {document.removeEventListener('click',this.#outside);}
  get value() {return this.#value;}
  set value(value) {this.#value=String(value||'').trim();this.renderSelection();}
  get disabled() {return this.hasAttribute('disabled');}
  set disabled(value) {this.toggleAttribute('disabled',!!value);if(this.trigger)this.trigger.disabled=!!value;if(value)this.close();}

  addVoices(voices) {
    let changed=false;
    for(const voice of voices){if(!voice.id)continue;const item={id:voice.id,name:voice.name||voice.id,description:voice.description||''};if(JSON.stringify(this.#voices.get(item.id))!==JSON.stringify(item)){this.#voices.set(item.id,item);changed=true;}}
    this.renderSelection();if(changed&&this.panel&&!this.panel.hidden)this.renderChoices();
  }
  renderSelection() {
    if(!this.trigger)return;
    const voice=this.#voices.get(this.value),name=voice?.name||this.value,description=voice?.description||'';
    this.titleNode.textContent=name+(description?' · '+description:'');this.trigger.title=this.value+(description?' · '+description:'');
    this.trigger.setAttribute('aria-label',this.label+': '+name+(description?' · '+description:''));
    for(const button of this.options())button.setAttribute('aria-pressed',String(button.dataset.voice===this.value));
  }
  options() {return this.list?Array.from(this.list.querySelectorAll('button')):[];}
  renderChoices() {
    const query=this.search.value.trim().toLocaleLowerCase(),voices=Array.from(this.#voices.values());
    if(this.value&&!this.#voices.has(this.value))voices.push({id:this.value,name:this.value,description:'저장된 음성 ID'});
    const filtered=voices.filter(v=>[v.id,v.name,v.description].join(' ').toLocaleLowerCase().includes(query));
    this.list.replaceChildren();this.count.textContent=query?`${filtered.length}개 검색 결과`:`${voices.length}개 목소리 · 특징을 보고 선택하세요`;
    for(const voice of filtered){
      const item=node('li'),button=node('button',undefined,'voice-choice'+(voice.name!==voice.id?' voice-choice-library':''));button.type='button';button.dataset.voice=voice.id;button.setAttribute('aria-pressed',String(voice.id===this.value));
      button.append(node('strong',voice.name),node('small',voice.description||'전용 목소리'));if(voice.name!==voice.id)button.append(node('span',voice.id,'voice-choice-id'));
      button.addEventListener('click',()=>this.choose(voice.id));item.append(button);this.list.append(item);
    }
    if(!filtered.length)this.list.append(node('li','검색 결과가 없습니다. 다른 이름이나 특징을 입력해 주세요.','voice-no-results'));
  }
  open() {
    if(this.disabled)return;
    this.search.value='';this.error.hidden=true;this.custom.open=false;this.customInput.value=this.#voices.has(this.value)?'':this.value;
    this.renderChoices();this.panel.hidden=false;this.trigger.setAttribute('aria-expanded','true');this.search.focus();
  }
  close(focus=false) {if(!this.panel)return;this.panel.hidden=true;this.trigger.setAttribute('aria-expanded','false');if(focus)this.trigger.focus();}
  choose(value) {if(this.disabled)return;const changed=this.value!==value;this.value=value;this.close(true);if(changed)this.dispatchEvent(new Event('change',{bubbles:true}));}
  applyCustom() {
    const value=this.customInput.value.trim();if(!/^[A-Za-z0-9][A-Za-z0-9_.-]{1,200}$/.test(value)){this.error.textContent='음성 ID를 확인해 주세요. 공백 없이 입력하세요.';this.error.hidden=false;return;}
    this.choose(value);
  }
}
customElements.define('voice-picker',VoicePicker);
