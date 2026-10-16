import { Client } from "pg";
import { provisionDigitalRuntime } from "@/lib/digital/runtime-privileges";
// Run with the migration owner in pre-deploy, never with the web runtime role.
const url=process.env.MIGRATION_DATABASE_URL,role=process.env.DCN_RUNTIME_ROLE;
if(!url||!role)throw Error("Migration URL and explicit DCN runtime role required.");
const client=new Client({connectionString:url});await client.connect();try{await provisionDigitalRuntime(client,role);console.log("Digital domain privileges verified; historical shared-table grants preserved.");}finally{await client.end();}
