import {readdirSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {validateAnnotations} from './core.mjs';
import {annotationSchema,annotationPrompt} from './annotation.mjs';
import {oauthEnv,firstExecutable,pathCandidates,runCli} from './cli.mjs';

const MISSING='Claude Code 실행 파일을 찾을 수 없습니다. Claude 앱 또는 Claude Code를 설치해 주세요.';
// The Claude desktop app bundles its own CLI under claude-code/<version>/<build>/claude.app.
function bundled() {
  const base=path.join(os.homedir(),'Library','Application Support','Claude','claude-code'),found=[];
  try {
    const versions=readdirSync(base).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));
    for(const version of versions)for(const build of readdirSync(path.join(base,version)))found.push(path.join(base,version,build,'claude.app','Contents','MacOS','claude'));
  }catch{}
  return found;
}
export function findClaude() {
  const home=os.homedir();
  return firstExecutable([process.env.CLAUDE_BIN,...pathCandidates('claude'),path.join(home,'.local','bin','claude'),path.join(home,'.claude','local','claude'),'/opt/homebrew/bin/claude','/usr/local/bin/claude',...bundled()])||'claude';
}
function claudeEnv() {
  const env=oauthEnv();
  // Subscription OAuth only: never fall through to cloud-provider credentials.
  for(const k of ['CLAUDE_CODE_USE_BEDROCK','CLAUDE_CODE_USE_VERTEX','CLAUDE_CODE_USE_FOUNDRY','ANTHROPIC_BASE_URL'])delete env[k];
  return env;
}
export function runClaude(args,{cwd,input='',signal,timeout=600000}={}) {
  return runCli(findClaude(),args,{cwd,env:claudeEnv(),input,signal,timeout,label:'Claude',missing:MISSING});
}
export async function authStatus() {
  try {
    const {out}=await runClaude(['auth','status','--json'],{timeout:15000}),s=JSON.parse(out);
    return s.loggedIn?{ready:true,message:'Claude OAuth 연결됨'}:{ready:false,message:'Claude 계정으로 로그인해 주세요.'};
  }catch(e){return {ready:false,message:e.message===MISSING?MISSING:'Claude 계정으로 로그인해 주세요.'};}
}
// `--output-format json` yields one result object (or an array of messages in some versions).
export function parseClaudeResult(out) {
  let value;
  try {value=JSON.parse(out);}catch{throw new Error('Claude 응답을 읽을 수 없습니다.');}
  const result=Array.isArray(value)?value.findLast(m=>m?.type==='result'):value;
  if(!result)throw new Error('Claude 응답을 읽을 수 없습니다.');
  if(result.is_error)throw new Error(`Claude 분석 실패. ${String(result.result||'').slice(0,600)}`);
  if(result.structured_output&&typeof result.structured_output==='object')return result.structured_output;
  const text=String(result.result||''),start=text.indexOf('{'),end=text.lastIndexOf('}');
  try {return JSON.parse(text.slice(start,end+1));}catch{throw new Error('Claude가 요청한 JSON 형식으로 답하지 않았습니다. 다시 시도해 주세요.');}
}
export async function annotate({project,template,cwd,signal}) {
  if(!(await authStatus()).ready)throw new Error('Claude OAuth 로그인이 필요합니다. 설정에서 로그인해 주세요.');
  await mkdir(cwd,{recursive:true,mode:0o700});
  // No tools, no user/project settings, MCP or skills: the model only sees the prompt (cwd is an empty temp folder).
  const args=['-p','--output-format','json','--json-schema',JSON.stringify(annotationSchema()),'--model',project.profile.claudeModel,'--effort','high','--tools','','--disable-slash-commands','--setting-sources','','--strict-mcp-config','--no-session-persistence','--no-chrome'];
  const {out}=await runClaude(args,{cwd,input:annotationPrompt(project,template),signal});
  return validateAnnotations(project.segments,parseClaudeResult(out).annotations);
}
export async function login(signal) {await runClaude(['auth','login','--claudeai'],{signal,timeout:300000});return authStatus();}
