import type { MailPort } from "@mailerport/sdk";
export interface MailServiceOptions { host?:string;port?:number;apiKey?:string;adminKey?:string;applicationId?:string;production?:boolean;transport?:string|Record<string,unknown>;outbox?:{filePath?:string};worker?:{enabled?:boolean;concurrency?:number;pollIntervalMs?:number;leaseMs?:number;maxAttempts?:number};identities?:Record<string,string>;templates?:Record<string,unknown>;testEndpointsEnabled?:boolean;environment?:Record<string,string|undefined> }
export interface MailService { mail:MailPort;operations:unknown;start():Promise<void>;stop():Promise<void> }
export function createMailService(options?:MailServiceOptions):MailService;
export function createMailPortService(mail:MailPort,options?:Record<string,unknown>):Pick<MailService,"start"|"stop">;
export class FileOperationsStore { constructor(options?:Record<string,unknown>); }
export function createDeliveryEventSource(options:Record<string,unknown>):{consume(event:Record<string,unknown>):Promise<unknown>};
export function validateProductionConfig(options?:Record<string,unknown>,environment?:Record<string,string|undefined>):{production:boolean};
