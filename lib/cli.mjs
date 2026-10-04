import {spawn} from 'node:child_process';
import {accessSync,constants} from 'node:fs';
import path from 'node:path';

export const SECRET_ENV=['OPENAI_API_KEY','CODEX_API_KEY','CODEX_ACCESS_TOKEN','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','GEMINI_API_KEY','GOOGLE_API_KEY'];
// API keys are removed so analysis can only run on the user's own OAuth login.
export function oauthEnv(extraRemove=[]) {
  const env={...process.env};
  for(const k of [...SECRET_ENV,...extraRemove])delete env[k];
  return env;
}
export function firstExecutable(candidates) {
  return candidates.filter(Boolean).find(file=>{try{accessSync(file,constants.X_OK);return true;}catch{return false;}});
}
export function pathCandidates(name) {return (process.env.PATH||'').split(path.delimiter).map(dir=>path.join(dir,name));}
export function runCli(bin,args,{cwd,env,input='',signal,timeout=600000,label,missing}={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(bin,args,{cwd,env,stdio:['pipe','pipe','pipe']});let out='',err='',settled=false;
    function finish(error) {if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve({out,err});}
    function abort() {child.kill('SIGTERM');const t=setTimeout(()=>child.kill('SIGKILL'),2500);t.unref();finish(new Error(signal?.aborted?'작업이 취소되었습니다.':`${label} 분석 시간이 초과되었습니다.`));}
    const timer=setTimeout(abort,timeout);
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    child.stdout.on('data',data=>{out+=data;if(out.length>4e6)abort();});
    child.stderr.on('data',data=>{err=(err+data).slice(-6000);});
    child.stdin.on('error',()=>{});
    child.on('error',()=>finish(new Error(missing)));
    child.on('close',code=>finish(code?new Error(`${label} 분석 실패 (${code}). ${err.slice(-1200)}`):null));
    child.stdin.end(input);
  });
}
