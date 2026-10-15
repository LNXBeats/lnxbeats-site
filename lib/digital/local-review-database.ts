import {assertSafeLocalPostgresUrl} from "@/lib/database/local-postgres-url";
/** Exact UTC-only exception for explicitly isolated DCN QA copies. The generic local URL
 * validator remains strict; arbitrary libpq options and every other target
 * keep their prior refusal. This does not authorise any network or DB access.
 */
export function assertSafeDigitalLocalPostgresUrl(value:string){
  const raw=new URL(value),options=raw.searchParams.getAll("options");
  if(options.length){
    if(options.length!==1||options[0]!=="-c timezone=UTC"||!["/lnx_dcn_final_paths_test_20261015","/lnx_dcn_france_commercial_test_20261015"].includes(raw.pathname))throw Error("Unsupported DCN QA connection option.");
    raw.searchParams.delete("options");
  }
  const checked=assertSafeLocalPostgresUrl(raw.toString());
  if(options.length)checked.searchParams.set("options",options[0]);
  return checked;
}
