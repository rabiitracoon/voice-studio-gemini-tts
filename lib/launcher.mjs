import {execFile} from 'node:child_process';
import {createStudio,ROOT} from '../server.mjs';
import {hash} from './core.mjs';
const workspace=process.env.TTS_WORKSPACE||ROOT;
const initial=Number(process.env.TTS_PORT||4319);
function show(url) {console.log(`Voice Studio: ${url}\n종료하려면 이 창에서 Control+C를 누르세요.`);if(process.env.TTS_NO_OPEN!=='1')execFile('/usr/bin/open',[url],error=>{if(error)console.log('브라우저에서 위 주소를 열어 주세요.');});}
try {
  const r=await fetch(`http://127.0.0.1:${initial}/api/status`,{signal:AbortSignal.timeout(1200)}),s=await r.json();
  if(s.appId==='voice-studio-v1'&&s.workspaceId===hash(workspace)){show(`http://127.0.0.1:${initial}`);process.exit(0);}
}catch{}
const studio=await createStudio();let listening=false;
for(let port=initial;port<initial+20;port++) {
  const ready=await new Promise((resolve,reject)=>{function failed(e){studio.server.off('listening',started);if(e.code==='EADDRINUSE')resolve(false);else reject(e);}function started(){studio.server.off('error',failed);resolve(true);}studio.server.once('error',failed);studio.server.once('listening',started);studio.server.listen(port,'127.0.0.1');});
  if(ready){show(`http://127.0.0.1:${port}`);listening=true;break;}
}
if(!listening){console.error('사용 가능한 로컬 포트를 찾지 못했습니다.');process.exit(1);}
for(const sig of ['SIGINT','SIGTERM'])process.once(sig,()=>studio.close().then(()=>process.exit(0)));
