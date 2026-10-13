import { Client } from "pg";
import { provisionDigitalRuntime } from "@/lib/digital/runtime-privileges";
// Explicit owner/runtime separation. No automatic production pre-deploy wiring in this lot.
const url=process.env.MIGRATION_DATABASE_URL,role=process.env.DCN_RUNTIME_ROLE;
if(!url||!role)throw Error("Migration URL and explicit DCN runtime role required.");
const client=new Client({connectionString:url});await client.connect();try{await provisionDigitalRuntime(client,role);console.log("Digital domain privileges verified; no historical grant modified.");}finally{await client.end();}
