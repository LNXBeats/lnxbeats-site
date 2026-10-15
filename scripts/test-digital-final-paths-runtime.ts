/** Real non-owner PostgreSQL exercise on the NEW disposable QA copy only.
 * Provider payments, emails and residence evidence here are never real. */
import assert from "node:assert/strict";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {randomUUID,createHash} from "node:crypto";
import {Client} from "pg";
import {assertSafeDigitalLocalPostgresUrl as assertSafeLocalPostgresUrl} from "@/lib/digital/local-review-database";
const cfg=JSON.parse(await readFile(".private/dcn-final-paths-config.json","utf8"));
const url=assertSafeLocalPostgresUrl(cfg.DATABASE_URL);assert.equal(url.pathname,"/lnx_dcn_final_paths_test_20261015");assert.equal(url.port,"55473");assert.equal(url.username,"dcn_runtime_a");
assert.equal(url.searchParams.get("options"),"-c timezone=UTC");
assert.equal(cfg.DCN_NEW_PAYMENTS_ENABLED,"false");assert.equal(cfg.EMAIL_PROVIDER,"capture");
for(const key of Object.keys(cfg))assert.ok(!/STRIPE|PAYPAL|R2|RESEND|RAILWAY/i.test(key));
for(const key of Object.keys(process.env))if(/STRIPE|PAYPAL|RESEND|RAILWAY|R2|AWS|DATABASE_URL/.test(key))delete process.env[key];
Object.assign(process.env,cfg,{DCN_ENABLED:"true",DCN_LOCAL_REVIEW_AUTHORIZED:"true",DCN_EXTERNAL_TEST_AUTHORIZED:"false",ADS_ENABLED:"false"});
const ownerCfg=JSON.parse(await readFile(".private/dcn-consolidation-owner-config.json","utf8")),ownerUrl=assertSafeLocalPostgresUrl(ownerCfg.DATABASE_URL);
assert.equal(ownerUrl.pathname,"/lnx_dcn_consolidation_test");assert.equal(ownerUrl.port,"55473");ownerUrl.pathname=url.pathname;
ownerUrl.searchParams.set("options","-c timezone=UTC");
const owner=new Client({connectionString:ownerUrl.toString()});await owner.connect();
assert.equal((await owner.query("SHOW TimeZone")).rows[0].TimeZone,"UTC");
const memberId=randomUUID(),adminId=randomUUID(),orderId=randomUUID(),suffix=randomUUID().slice(0,8),email=`final-paths-${suffix}@example.invalid`;
await owner.query('INSERT INTO users(id,email,"displayName",role,status,"emailVerified","updatedAt") VALUES ($1,$2,$3,\'MEMBER\',\'ACTIVE\',true,now()),($4,$5,$6,\'ADMIN\',\'ACTIVE\',true,now())',
  [memberId,email,"QA final paths",adminId,`final-paths-admin-${suffix}@example.invalid`,"QA final paths reviewer"]);
const {prisma}=await import("@/lib/prisma"),{saveDigitalFranceResidenceDeclarationV2,recordDigitalFranceResidenceReviewV2,assessDigitalFranceResidenceV2,revalidateDigitalFranceResidenceV2}=await import("@/lib/digital/france-residence-v2-service"),
  {reserveDigitalJurisdiction,checkDigitalAcquiredJurisdiction,checkDigitalResidenceRetry}=await import("@/lib/digital/checkout-jurisdiction"),
  {submitWithdrawalRequest,parseWithdrawalSubmission,getWithdrawalReceipt}=await import("@/lib/legal/withdrawal"),
  {withdrawalReceiptText}=await import("@/lib/legal/withdrawal-policy"),{reviewDigitalConsumerRequest}=await import("@/lib/legal/withdrawal-admin"),
  {processDigitalNotifications}=await import("@/lib/digital/notifications"),{DIGITAL_TERMS_VERSION}=await import("@/lib/digital/domain");
const member={id:memberId,email,name:"QA final paths",role:"MEMBER" as const,status:"ACTIVE" as const,emailVerified:true as const},admin={...member,id:adminId,role:"ADMIN" as const};
const checks:Array<{name:string;status:"PASS"}>=[];const pass=(name:string)=>checks.push({name,status:"PASS"});
const {assertDigitalDatabaseUtc}=await import("@/lib/digital/database-time-policy");
await prisma.$transaction(tx=>assertDigitalDatabaseUtc(tx));
await assert.rejects(()=>prisma.$transaction(async tx=>{await tx.$queryRaw`SELECT set_config('TimeZone','Europe/Paris',true)`;await assertDigitalDatabaseUtc(tx);}),{code:"DIGITAL_DATABASE_TIMEZONE_UNSAFE",status:503});
pass("unsafe_non_utc_transaction_refused_without_configuration_bypass");
const before=(await owner.query('SELECT (SELECT count(*) FROM digital_refunds)::int refunds,(SELECT count(*) FROM digital_documents)::int documents,(SELECT count(*) FROM digital_entitlements)::int entitlements')).rows[0];
const input={address:{line1:"1 voie de démonstration QA",city:"Ajaccio",postalCode:"20000",countryCode:"FR"},billingPostalCode:"20000",residenceConfirmed:true,expectedDeclarationId:null,idempotencyKey:randomUUID()};
const declared=await saveDigitalFranceResidenceDeclarationV2(member,input);assert.ok(declared.declaration);
const binding={residenceDeclarationId:declared.declaration!.id,addressHash:declared.declaration!.addressHash,billingPostalCode:"20000"};
assert.equal((await assessDigitalFranceResidenceV2(binding,member.id,prisma)).residenceVerified,false);pass("declaration_without_review_cannot_pay");
const reviewInput={subjectUserId:member.id,declarationId:declared.declaration!.id,expectedReviewId:null,status:"VERIFIED",reviewSource:"CUSTOMER_CONTACT_AND_CONTEXT",reason:"Revue synthétique locale exclusivement, aucune personne réelle ni preuve fiscale.",attested:true,conflictResolved:false,privateReference:null,validDays:1,idempotencyKey:randomUUID()};
await recordDigitalFranceResidenceReviewV2(admin,reviewInput);
const assessment=await assessDigitalFranceResidenceV2(binding,member.id,prisma);assert.ok(assessment.snapshot);assert.equal(assessment.paymentAllowed,false);pass("fresh_non_owner_admin_review_is_bound_but_live_stays_closed");
const territory={countryCode:"FR",residenceCountryCode:"FR",billingCountryCode:"FR",customerType:"B2C",residencePostalCode:"20000",residenceConfirmed:true,...binding};
const snapshot=await prisma.$transaction(tx=>reserveDigitalJurisdiction(territory,tx,true,member.id));assert.ok(snapshot.franceResidenceV2);assert.equal(snapshot.approvalScope,"LOCAL_QA");
await prisma.$transaction(tx=>checkDigitalAcquiredJurisdiction(snapshot,tx,"dcn12-local-simulation",member.id));
await assert.rejects(()=>prisma.$transaction(tx=>checkDigitalResidenceRetry({...territory,countryCode:"DE"},snapshot,tx,"dcn12-local-simulation",member.id)),{code:"FRANCE_RESIDENCE_PROOF_CHANGED_REQUIRES_REVIEW"});
assert.equal(JSON.stringify(snapshot).includes(input.address.line1),false);pass("address_country_frozen_and_retry_cannot_switch_country");
await saveDigitalFranceResidenceDeclarationV2(member,{...input,address:{...input.address,line1:"2 voie de démonstration QA"},expectedDeclarationId:declared.declaration!.id,idempotencyKey:randomUUID()});
await assert.rejects(()=>revalidateDigitalFranceResidenceV2(assessment.snapshot!,member.id,prisma));pass("new_declaration_invalidates_previous_review_and_snapshot");
await owner.query('INSERT INTO digital_orders(id,"userId","idempotencyKey","cartRevision",mode,status,"totalCents",currency,"termsVersion","termsHash","updatedAt") VALUES($1,$2,$3,1,\'TEST\',\'PAID\',990,\'EUR\',$4,$5,now())',[orderId,member.id,randomUUID(),DIGITAL_TERMS_VERSION,"a".repeat(64)]);
const submission=parseWithdrawalSubmission({contractType:"DIGITAL_ORDER",orderNumber:orderId,firstName:"Client",lastName:"QA",email,productDescription:"Album synthétique QA, aucune transaction prestataire",quantity:null,reason:null,declarationAccepted:true,requestKind:"WITHDRAWAL"});
const first=await submitWithdrawalRequest(submission,"127.0.0.1"),retry=await submitWithdrawalRequest(submission,"127.0.0.1");assert.equal(first.requestNumber,retry.requestNumber);
const request=await prisma.consumerWithdrawalRequest.findUniqueOrThrow({where:{requestNumber:first.requestNumber}});assert.equal(request.digitalOrderId,orderId);assert.equal(request.eligibilityReview,"PENDING_REVIEW");
const received=(await owner.query('SELECT extract(epoch FROM "receivedAt")::numeric*1000 AS milliseconds,"acknowledgementSnapshot"->>\'receivedAt\' AS "snapshotTime" FROM consumer_withdrawal_requests WHERE id=$1',[request.id])).rows[0];
assert.equal(Number(received.milliseconds),Date.parse(received.snapshotTime));assert.equal(request.receivedAt.getTime(),Date.parse(received.snapshotTime));pass("native_sql_receipt_epoch_matches_snapshot_and_prisma_utc");
assert.equal(await prisma.consumerWithdrawalRequest.count({where:{digitalOrderId:orderId}}),1);pass("matched_request_and_duplicate_are_recorded_once_without_decision");
const receipt=await getWithdrawalReceipt(retry.receiptToken);assert.ok(receipt);const text=withdrawalReceiptText(receipt!.acknowledgementSnapshot,receipt!.acknowledgementHashSha256);assert.ok(text.includes(request.receivedAt.toISOString()));pass("durable_receipt_roundtrips_real_jsonb_with_content_date_time_and_hash");
const mail=await processDigitalNotifications(1,undefined,undefined,request.id);assert.equal(mail.captured,1);assert.equal(mail.sent,0);
const notice=await prisma.digitalNotification.findUniqueOrThrow({where:{businessKey:`withdraw:${request.id}:ack`}});assert.equal(notice.status,"CAPTURED_QA");assert.equal(notice.sentAt,null);pass("acknowledgement_queue_captured_locally_never_sent");
const decision={requestId:request.id,idempotencyKey:randomUUID(),expectedUpdatedAt:request.updatedAt.toISOString(),decision:"ACCEPTED",basis:"HUMAN_REVIEW",reason:"Examen synthétique local, décision administrative sans remboursement ni révocation automatique."};
await reviewDigitalConsumerRequest(admin,decision);assert.equal((await reviewDigitalConsumerRequest(admin,decision)).duplicate,true);pass("human_review_idempotence_survives_jsonb_no_finance_called");
for(const requestKind of["NON_CONFORMITY","GOODWILL"] as const)await submitWithdrawalRequest({...submission,requestKind},"127.0.0.1");
assert.equal(await prisma.consumerWithdrawalRequest.count({where:{digitalOrderId:orderId}}),3);pass("withdrawal_conformity_and_goodwill_are_distinct_requests");
assert.deepEqual((await owner.query('SELECT (SELECT count(*) FROM digital_refunds)::int refunds,(SELECT count(*) FROM digital_documents)::int documents,(SELECT count(*) FROM digital_entitlements)::int entitlements')).rows[0],before);
assert.equal((await prisma.digitalOrder.findUniqueOrThrow({where:{id:orderId}})).status,"PAID");pass("requests_do_not_refund_revoke_access_or_rewrite_billing");
await mkdir("output/dcn-final-paths",{recursive:true});await writeFile("output/dcn-final-paths/functional-runtime.json",JSON.stringify({environment:"REAL_LOCAL_POSTGRESQL_COPY_NON_OWNER_ROLE",database:url.pathname.slice(1),role:"dcn_runtime_a",checks,
  residenceProof:"SYNTHETIC_ADMIN_REVIEW_NOT_REAL_CUSTOMER_OR_FISCAL_APPROVAL",providerCalls:0,realPayments:0,emailsSent:0,createdFixtures:{users:2,orders:1,consumerRequests:3},receiptBytes:Buffer.byteLength(text),receiptDownloadSha256:createHash("sha256").update(text).digest("hex"),historicalFinancialRowsUnchanged:true},null,2));
console.log(JSON.stringify({runtime:"PASS",checks:checks.length,providerCalls:0,emailsSent:0,financialMutations:0}));await prisma.$disconnect();await owner.end();
