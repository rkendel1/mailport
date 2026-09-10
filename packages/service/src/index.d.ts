import type { MailMessage } from "@mailerport/core";
interface MailPort { send(options:Record<string,unknown>):Promise<MailMessage>; get(id:string):MailMessage|null|Promise<MailMessage|null>; list(filters?:Record<string,unknown>):MailMessage[]|Promise<MailMessage[]>; close():void|Promise<void> }
export interface MailServiceOptions { host?:string;port?:number;apiKey?:string;adminKey?:string;applicationId?:string;production?:boolean;transport?:string|Record<string,unknown>;outbox?:{filePath?:string};worker?:{enabled?:boolean;concurrency?:number;pollIntervalMs?:number;leaseMs?:number;maxAttempts?:number};identities?:Record<string,string>;templates?:Record<string,unknown>;testEndpointsEnabled?:boolean;environment?:Record<string,string|undefined> }
export interface MailService { mail:MailPort;operations:unknown;start():Promise<void>;stop():Promise<void> }
export function createMailService(options?:MailServiceOptions):MailService;
export function createMailPortService(mail:MailPort,options?:Record<string,unknown>):Pick<MailService,"start"|"stop">;
export class FileOperationsStore { constructor(options?:Record<string,unknown>); }
export function createDeliveryEventSource(options:Record<string,unknown>):{consume(event:Record<string,unknown>):Promise<unknown>};
export function validateProductionConfig(options?:Record<string,unknown>,environment?:Record<string,string|undefined>):{production:boolean};
export class FileSigningKeyStore { constructor(options:{filePath?:string;encryptionKey?:string});get(domain:string):string|null;set(domain:string,key:string):void;delete(domain:string):void;has(domain:string):boolean }
export function validateMtaIdentity(options:{hostname:string;egressIp:string;resolver?:unknown}):Promise<{hostname:string;egressIp:string;ptr:true;forward:true;fcrdns:true}>;
export function probeEgressIp(url:string,fetcher?:typeof fetch):Promise<string|null>;
export function validateMtaEgress(options:{expectedIp:string;probeUrl?:string;fetcher?:typeof fetch}):Promise<{checked:boolean;expectedIp:string;observedIp?:string}>;
