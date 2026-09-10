const clone = (value) => structuredClone(value);
export class MemoryTransport { constructor() { this.kind="memory"; } async send() { return {status:"sent",transport:"memory"}; } }
export class LocalTransport extends MemoryTransport { constructor(){super();this.kind="local";} }
export function extractLinks({html="",text=""}={}) { return [...new Set(`${html} ${text}`.match(/https?:\/\/[^\s"'<>]+|\/(?:[A-Za-z0-9._~!$&'()*+,;=:@%-]+\/?)+/g)||[])]; }
export function createTestInbox() {
  const messages=[];
  const matches=(message,filters)=>Object.entries(filters).every(([key,value])=>key==="to"?message.to?.includes(value):key==="testRunId"?message.metadata?.testRunId===value:message[key]===value);
  return { deliver(message){const item={...clone(message),links:message.links||extractLinks(message),sent_at:message.sent_at||new Date().toISOString()};messages.push(item);return clone(item);},
    list(filters={}){return messages.filter((item)=>matches(item,filters)).map(clone);},get(id){const item=messages.find((value)=>value.message_id===id);return item?clone(item):null;},
    clear(filters){for(let index=messages.length-1;index>=0;index-=1)if(!filters||matches(messages[index],filters))messages.splice(index,1);},
    async waitFor({timeoutMs=5000,intervalMs=25,...filters}={}){const start=Date.now();while(Date.now()-start<timeoutMs){const item=messages.find((value)=>matches(value,filters));if(item)return clone(item);await new Promise((resolve)=>setTimeout(resolve,intervalMs));}return null;} };
}
