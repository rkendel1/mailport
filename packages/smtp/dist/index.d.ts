import type { MailMessage, DeliveryResult, MailTransport } from "@mailerport/core";
export interface SmtpOptions { host:string;port?:number;secure?:boolean;requireTLS?:boolean;username?:string;password?:string;helo?:string }
export class SmtpTransport implements MailTransport { readonly kind:"smtp"; constructor(options:SmtpOptions); send(message:MailMessage):Promise<DeliveryResult> }
export function createSmtpTransport(options:SmtpOptions):SmtpTransport;
export interface DirectMxOptions { hostname:string;envelopeFrom?:string;port?:number;requireTLS?:boolean;timeoutMs?:number;resolver?:{resolveMx(domain:string):Promise<Array<{priority:number;exchange:string}>>} }
export class DirectMxTransport implements MailTransport { readonly kind:"direct-mx";constructor(options:DirectMxOptions);send(message:MailMessage):Promise<DeliveryResult> }
export function createDirectMxTransport(options:DirectMxOptions):DirectMxTransport;
export interface CloudflareOptions { accountId:string;apiToken?:string;baseUrl?:string;client?:{send(request:Record<string,unknown>):Promise<Record<string,unknown>>};fetcher?:typeof fetch }
export class CloudflareTransport implements MailTransport { readonly kind:"cloudflare";constructor(options:CloudflareOptions);send(message:MailMessage):Promise<DeliveryResult> }
export class CloudflareEmailHttpClient { constructor(options:CloudflareOptions);send(request:Record<string,unknown>):Promise<Record<string,unknown>> }
export class FakeCloudflareEmailClient { readonly requests:Record<string,unknown>[];constructor(options?:{response?:Record<string,unknown>;error?:Error});send(request:Record<string,unknown>):Promise<Record<string,unknown>> }
export function createCloudflareTransport(options:CloudflareOptions):CloudflareTransport;
