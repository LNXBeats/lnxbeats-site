import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";
import { digitalEnabled } from "./domain";
export const LOCAL_REVIEW_MERCHANT = "dcn12-local-simulation";
export const LOCAL_REVIEW_BUYER = "dcn12-review-member@example.invalid";
export const CONSOLIDATION_REVIEW_BUYER = "dcn-consolidation-review-member@example.invalid";
/** Explicit launcher capability + exact isolated DB/transport. NODE_ENV or browser fields alone never authorize it. */
export function localDigitalReviewAvailable(env:Record<string,string|undefined> = process.env) {
  try {
    const db=assertSafeLocalPostgresUrl(env.DATABASE_URL??"");
    const origin=new URL(env.AUTH_URL??"");
    return digitalEnabled(env) && env.DCN_LOCAL_REVIEW_AUTHORIZED==="true"
      && env.DCN_EXTERNAL_TEST_AUTHORIZED!=="true" && env.DCN_NEW_PAYMENTS_ENABLED==="false"
      && db.hostname==="127.0.0.1" && db.port==="55473" && ["/lnx_dcn_runtime_test","/lnx_dcn_consolidation_test"].includes(db.pathname)
      && db.username==="dcn_runtime_a" && env.MEDIA_STORAGE_DRIVER==="local" && env.EMAIL_PROVIDER==="capture"
      && origin.origin==="http://127.0.0.1:3140" && origin.pathname==="/" && !origin.username && !origin.password && !origin.search && !origin.hash
      && !Object.entries(env).some(([k,v])=>!!v&&/(?:^|_)(?:STRIPE|PAYPAL|RESEND)(?:_|$)/.test(k));
  } catch { return false; }
}
export function localDigitalReviewCheckoutAllowed(email:string,merchant:string,requested:boolean,env:Record<string,string|undefined>=process.env) {
  return requested===true && [LOCAL_REVIEW_BUYER,CONSOLIDATION_REVIEW_BUYER].includes(email) && merchant===LOCAL_REVIEW_MERCHANT && localDigitalReviewAvailable(env);
}
type LocalAttempt={id:string;operation:string;provider:string;status:string;providerReference:string|null;paymentReference:string|null;checkoutUrl:string|null};
export function localDigitalReviewAttemptAllowed(order:{userId:string;mode:string;status:string;attempts:LocalAttempt[]},userId:string){
 const a=order.attempts[0];
 return order.userId===userId&&order.mode==="TEST"&&order.attempts.length===1&&!!a&&a.operation==="CHECKOUT"&&a.provider==="STRIPE"
   &&a.providerReference===`dcn12-local-session-${a.id}`&&a.checkoutUrl==="https://checkout.stripe.com/c/local_simulated_only"
   &&((order.status==="PENDING"&&a.status==="OPEN")||(order.status==="PAID"&&a.status==="PAID"&&a.paymentReference===`dcn12-local-payment-${a.id}`));
}
