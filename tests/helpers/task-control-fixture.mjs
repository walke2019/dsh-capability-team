import {createTaskControl} from '../../member-task-control.js';
export function fixture(options={}) {
 let clock=1000,starts=0,fail=false;const logs=[],policy={disabledRoutes:[]},handlers={};
 const lead={id:'l',status:'idle',session:{header:{id:'l'}},ctx:{}},worker={id:'w',status:'idle',session:{header:{id:'w'}},ctx:{}};
 const agents=new Map([['l',lead],['w',worker]]),role={provider:'p',model:'mid',tier:'medium',fallbacks:[{provider:'p',model:'low'}]};
 const effective={roles:{dev:{capability:'frontend'}},capabilities:{frontend:role},tiers:{low:['low'],medium:['mid'],upper:['upper'],high:['high']}};
 const ctx={effect:fn=>fn(),on:(key,fn)=>handlers[key]=fn,tools:{register:()=>()=>{}},agents:{get:id=>agents.get(id)},agentTeams:{tryMembership:a=>a===lead?{role:'lead',name:'lead',root:lead}:a===worker?{role:'teammate',name:'dev',root:lead}:undefined,listMembers:()=>[{id:'l',role:'lead',name:'lead'},{id:'w',role:'teammate',name:'dev'}],listTasks:()=>[]},get:()=>({stateOf:()=>({view:{stepsStarted:starts}})}),llm:{listProviders:()=>[{id:'p'}],listModels:async()=>['low','mid','upper'].map(id=>({id}))}};
 const control=createTaskControl(ctx,{load:async()=>({effective,policy})},{now:()=>clock,onChanged:options.onChanged,audit:{append:async(_id,r)=>{await options.auditHook?.(r);if(fail)throw Error('disk');logs.push(r);}}});
 control.setWorkflow({state:()=>({plan:{mode:'delegate',assignments:[{role:'dev'}]}})});
 return {control,lead,worker,role,logs,policy,ctx,handlers,setClock:n=>clock=n,setStarts:n=>starts=n,setFail:x=>fail=x};
}
