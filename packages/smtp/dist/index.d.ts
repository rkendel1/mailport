import type { MailMessage, DeliveryResult, MailTransport } from "@mailerport/core";
export interface SmtpOptions { host:string;port?:number;secure?:boolean;requireTLS?:boolean;username?:string;password?:string;helo?:string }
export class SmtpTransport implements MailTransport { readonly kind:"smtp"; constructor(options:SmtpOptions); send(message:MailMessage):Promise<DeliveryResult> }
export function createSmtpTransport(options:SmtpOptions):SmtpTransport;
export interface DirectMxOptions { hostname:string;envelopeFrom?:string;port?:number;requireTLS?:boolean;timeoutMs?:number;resolver?:{resolveMx(domain:string):Promise<Array<{priority:number;exchange:string}>>} }
export class DirectMxTransport implements MailTransport { readonly kind:"direct-mx";constructor(options:DirectMxOptions);send(message:MailMessage):Promise<DeliveryResult> }
export function createDirectMxTransport(options:DirectMxOptions):DirectMxTransport;
