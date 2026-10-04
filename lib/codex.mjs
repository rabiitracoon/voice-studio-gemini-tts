import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {validateAnnotations} from './core.mjs';
import {annotationSchema,annotationPrompt} from './annotation.mjs';
import {oauthEnv,firstExecutable,pathCandidates,runCli} from './cli.mjs';

export function findCodex() {
  const candidates=[process.env.CODEX_BIN,...pathCandidates('codex')];
  for(const app of ['ChatGPT','Codex'])candidates.push(`/Applications/${app}.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex`,`/Applications/${app}.app/Contents/Resources/codex`);
  return firstExecutable(candidates)||'codex';
}
export function runCodex(args,{cwd,input='',signal,timeout=600000}={}) {
  return runCli(findCodex(),args,{cwd,env:oauthEnv(),input,signal,timeout,label:'GPT',missing:'Codex 실행 파일을 찾을 수 없습니다. ChatGPT/Codex 앱을 설치해 주세요.'});
}
export async function authStatus() {
  try {const {out,err}=await runCodex(['login','status'],{timeout:15000});return {ready:/Logged in using ChatGPT/i.test(out+err),message:/ChatGPT/i.test(out+err)?'ChatGPT OAuth 연결됨':'ChatGPT 계정으로 로그인해 주세요.'};}
  catch {return {ready:false,message:'ChatGPT/Codex 앱에서 로그인하거나 OAuth 로그인 버튼을 눌러 주세요.'};}
}
export async function annotate({project,template,cwd,signal}) {
  if(!(await authStatus()).ready)throw new Error('ChatGPT OAuth 로그인이 필요합니다. 설정에서 로그인해 주세요.');
  await mkdir(cwd,{recursive:true,mode:0o700});
  const schemaFile=path.join(cwd,'schema.json'),resultFile=path.join(cwd,'result.json');
  await writeFile(schemaFile,JSON.stringify(annotationSchema()),{mode:0o600});
  const prompt=annotationPrompt(project,template);
  await runCodex(['exec','--ignore-user-config','--ephemeral','--skip-git-repo-check','-C',cwd,'-s','read-only','--disable','shell_tool','--disable','multi_agent','-c','web_search="disabled"','-c','model_reasoning_effort="high"','-m',project.profile.gptModel,'--color','never','--output-schema',schemaFile,'-o',resultFile,'-'],{cwd,input:prompt,signal});
  const result=JSON.parse(await readFile(resultFile,'utf8'));
  return validateAnnotations(project.segments,result.annotations);
}
export async function login(signal) {await runCodex(['login'],{signal,timeout:300000});return authStatus();}
