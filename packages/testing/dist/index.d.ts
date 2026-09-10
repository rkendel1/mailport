import type { MailMessage, MailTransport, DeliveryResult } from "@mailerport/core";
export class MemoryTransport implements MailTransport { kind:string; send(message:MailMessage):Promise<DeliveryResult> }
export class LocalTransport extends MemoryTransport {}
export function extractLinks(message:{html?:string;text?:string}):string[];
export interface TestInbox { deliver(message:MailMessage):MailMessage;list(filters?:Record<string,unknown>):MailMessage[];get(id:string):MailMessage|null;clear(filters?:Record<string,unknown>):void;waitFor(filters?:Record<string,unknown>&{timeoutMs?:number;intervalMs?:number}):Promise<MailMessage|null> }
export function createTestInbox():TestInbox;
