import fs from "node:fs";
import { createMailPort, parseMailDsl, generateMailContractSnapshot } from "mailerport";
const flow=fs.readFileSync(new URL("../app.flow",import.meta.url),"utf8");
const contract=parseMailDsl(flow);
const snapshot=generateMailContractSnapshot(contract);
if(snapshot.identities[0]!=="auth")throw new Error("Capability snapshot failed");
const mail=createMailPort({transport:"local",identities:contract.identities,testEndpointsEnabled:true});
const message=await mail.send({identity:"auth",to:"user@example.com",subject:"Verify",text:"Visit /verify/token"});
if(message.status!=="sent"||message.links[0]!=="/verify/token")throw new Error("MailPort send failed");
