import type { MailMessage } from "@mailerport/core";
export function createMimeMessage(message:MailMessage&{dkim?:{domain:string;selector:string;privateKey:string}|null}):string;
