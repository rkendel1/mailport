import type { MailMessage, DeliveryResult, MailTransport } from "@mailerport/core";
export interface SmtpOptions { host:string;port?:number;secure?:boolean;requireTLS?:boolean;username?:string;password?:string;helo?:string }
export class SmtpTransport implements MailTransport { readonly kind:"smtp"; constructor(options:SmtpOptions); send(message:MailMessage):Promise<DeliveryResult> }
export function createSmtpTransport(options:SmtpOptions):SmtpTransport;
