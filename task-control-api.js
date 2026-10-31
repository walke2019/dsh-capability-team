import { crossSiteRequest } from './http-guard.js';
import { taskControlBinding, taskError } from './member-task-control.js';
export const TASK_CONTROL_PATH='/api/capability-team.task-control';
export const CANDIDATES_PATH='/api/capability-team.override-candidates';
function leadOf(ctx,id){if(invalidId(id))throw taskError('BAD_REQUEST','Invalid sessionId',400);const a=ctx.get('agents')?.get(id);if(!a||ctx.get('agentTeams')?.tryMembership(a)?.role!=='lead'||ctx.agentPresets.composedPreset(a.ctx)!=='capability-team')throw taskError('NOT_FOUND','Lead unavailable',404);const control=taskControlBinding(a);if(!control)throw taskError('UNAVAILABLE','Task control unavailable',503);return {a,control};}
const requests=new Map();
const canonical = value => JSON.stringify(value, Object.keys(value).sort());
const invalidId = id => typeof id !== 'string' || !/^[\w.:-]{1,256}$/.test(id);
export async function handleTaskControl(ctx,request,candidate=false){
  try{
    const url=new URL(request.url);
    if(request.method==='GET'){
      if([...url.searchParams.keys()].some(k=>!['sessionId',...(candidate?['role']:[])].includes(k)))throw taskError('BAD_REQUEST','Unknown query',400);
      const {a,control}=leadOf(ctx,url.searchParams.get('sessionId'));await control.update(a);
      return Response.json(candidate?await control.candidates(a,url.searchParams.get('role')):control.snapshot(a),{headers:{'cache-control':'no-store'}});
    }
    if(candidate||request.method!=='POST')throw taskError('BAD_REQUEST','Method not allowed',400);
    // Auth is supplied by Connection's owner-only route fence. Mutations also
    // refuse another site's Origin; the desktop app strips Origin when forwarding, so absence is allowed.
    if(crossSiteRequest(request))throw taskError('FORBIDDEN','Same-origin required',403);
    if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')??''))throw taskError('BAD_REQUEST','JSON required',400);
    if(Number(request.headers.get('content-length')??0)>16384)throw taskError('BAD_REQUEST','Body too large',400);
    const reader=request.body?.getReader();let bytes=0,text='';const decoder=new TextDecoder();
    if(reader){try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>16384){await reader.cancel();throw taskError('BAD_REQUEST','Body too large',400);}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}}
    let body;try{body=JSON.parse(text);}catch{throw taskError('BAD_REQUEST','Invalid JSON',400);}
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['sessionId','action','requestId','role','lease_id','expected_revision','provider','model','catalog_version','reason','task_id','assignment_id','complexity','timeout_seconds'].includes(k)))throw taskError('BAD_REQUEST','Unknown fields',400);
    if(typeof body.requestId!=='string'||!/^[\w:-]{1,128}$/.test(body.requestId))throw taskError('BAD_REQUEST','requestId required',400);
    const {a,control}=leadOf(ctx,body.sessionId);const key=`${a.id}:${body.requestId}`,fingerprint=canonical(body),prior=requests.get(key);
    if(prior){if(prior.fingerprint!==fingerprint)throw taskError('CONFLICT','Idempotency conflict',409);return Response.json(await prior.promise);}
    const {sessionId,requestId,action,...args}=body;
    const map={'set-override':['override','set'],'clear-override':['override','clear'],'start-budget':['budget','start'],'finish-lease':['budget','finish']};if(!map[action])throw taskError('BAD_REQUEST','Invalid action',400);
    const [method,verb]=map[action];const promise=control[method](a,{...args,action:verb},{kind:'owner',id:a.id});requests.set(key,{fingerprint,promise});if(requests.size>256)requests.delete(requests.keys().next().value);
    return Response.json(await promise,{headers:{'cache-control':'no-store'}});
  }catch(error){return Response.json({code:error.code??'UNAVAILABLE',message:error.code?error.message:'Task control unavailable'},{status:error.status??503});}
}
export function applyTaskControlApi(ctx){ctx.inject?.(['connection','agents','agentTeams','agentPresets'],scoped=>{for(const [path,candidate] of [[TASK_CONTROL_PATH,false],[CANDIDATES_PATH,true]])scoped.connection.fetch.register({path,methods:candidate?['GET']:['GET','POST'],requestBody:'buffered',fetch:req=>handleTaskControl(scoped,req,candidate)});});}
