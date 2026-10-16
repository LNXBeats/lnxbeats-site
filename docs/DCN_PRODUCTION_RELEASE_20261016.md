# DCN Production release - 2026-10-16

## Scope and preserved history

This release extends the existing catalog and commerce domains. It does not
replace Production with a QA database. Physical Shop, Commander, Creations,
Rights, Support, DistroKid, accounts, purchases and invoices remain independent.
The previous Production reference is
`7e7b8861d6b114a02e06ea69a9a7baf39693d83a`; the prepared DCN source reference is
`e925e9037deae6a146a619fe56c3db1558c5f18d`.

The operator must record the exact compiled/deployed commit and deployment IDs
in the private release report. This runbook is not proof that deployment happened.
Recovery R1-R4, the original dirty worktree and the CM2C scope evidence are kept.
Private inventories, media, owner evidence, credentials and database copies are
never committed to this repository.

## Owner decisions and commercial eligibility

The explicit owner declaration of 2026-10-16 applies only to the twelve current
VIE DE CHIEN masters: full author/master ownership, no outstanding third-party
approval declared, twelve existing personally approved excerpts, EUR 1.29 per
track and EUR 9.90 for the album. It does not clear any other recording.

The release records the original evidence reference/hash, its exact scope, the
existing twelve human excerpt decisions and the verified Production Admin in
append-only audit events. Normal rights/excerpt/offer workflows are exercised on
a restored Production copy before exporting the additive, atomic release plan.
Recording a prior owner decision is not represented as a new listening session.
The thirteen offers still require actual object-backed media and current
master-bound reviews at checkout. Twenty-one unresolved track versions remain
blocked. Other catalog offers without complete rights or a price stay inactive.

The owner approved the proposed digital CGV and separate consents. Approval is
bound to the exact version, full text, document and consent hashes; old acquired
versions remain immutable. Oral URSSAF/SIE feasibility discussions are recorded
as oral, not written approval or a new fiscal ruling. CM2C scope evidence is not
represented as a legal endorsement of the CGV.

## LIVE boundary and customer access

- Explicit coherent LIVE runtime, Production provider credentials and canonical
  origin `https://www.lnxbeats.fr` are required. TEST/QA capabilities fail closed
  in Production. No real financial test transaction is authorized by this release.
- Existing authenticated Stripe/PayPal webhook endpoints durably route DCN
  events after signature verification, without claiming unrelated payment sources.
- Accounts must be verified. Initial territorial opening is B2C France
  metropolitan/Corse, using the existing address declaration and private Admin
  residence review. Residence alone never authorizes a payment.
- Tax/legal snapshots are immutable per commitment. The documented existing
  franchise exemption is a reviewed FR-MET rule, not an invented zero VAT rate.
  It expires on 2027-01-01; review earlier if merchant status changes. Other
  territories stay closed until their own approved rules exist.
- CGV acceptance and the two distinct immediate-supply/withdrawal consents are
  not prechecked. A durable contract receipt is required before first supply.
  Invoices and credit notes use the existing shared sequence without resetting it.
- Full WAV/MP3 and album archives stay private. Downloads require server-side
  ownership and a bounded ticket; public previews never expose full masters.

## Operations and future Admin additions

Use the existing Creations media worker, with `DCN_WORKER_ENABLED=true`, for the
bounded sequential DCN cycle: durable inbox, payment/refund status reads,
documents, transaction emails, audio ingestion and separate WAV/MP3 ZIPs.
Heavy child processes do not receive PSP or mail credentials. Requested refunds
are not automatically posted by reconciliation; authorized Admin operations
retain amount, provenance and idempotence checks.

New albums/singles and tracks use the existing Catalogue and Musique Admin.
Current excerpts can be listened to and explicitly approved for LIVE without
opening the R4/local candidate-generation path. The excerpt start is selected
at master ingestion. Changing the segment requires preparing a new master
edition, then reviewing that edition; the local candidate queue is not silently
presented as a LIVE publishing service. Upload alone never approves rights,
artistic selection or commercial activation.

## Suspension and recovery

The Musique Admin includes an append-only new-sales control, protected by fresh
Admin authorization, same-origin mutation checks, rate limits and optimistic
revision checks. A transaction lock orders suspension against new commitments.
Suspension blocks new checkout orders/free commitments, not acquired downloads,
provider evidence, documents or legitimate refunds. Payments already engaged
are reconciled, not blindly canceled or replayed.

`DCN_NEW_PAYMENTS_ENABLED=false` is the additional operational fallback. Keep it
false during migration/catalog preparation, then true after health and critical
checks for the approved opening. `DCN_ENABLED=false` is not the preferred sales
switch because it also closes acquired access.

Before deployment, refresh the encrypted Production backup if business data
changed. Restore it privately, verify historic row fingerprints and all applied
migration names/checksums, apply 48-to-57 through Prisma, and verify unchanged
historic commerce. Pre-deploy uses the migration owner and provisions the
separate runtime grants. The shared pre-existing withdrawal table retains its
historical grants; new DCN tables receive only scoped column updates and no
DELETE/TRUNCATE/DDL privileges. Country approvals and audit events are not
rewritable by the runtime.

The reviewed catalog plan is additive, checks the pre-release canaries, and is
atomic/idempotent. It never inserts users, sessions, orders or acquisitions.
Stop on an unexplained baseline difference. If the connection result is
uncertain, read the durable release marker before any further mutation.

Application rollback keeps the additive schema and disables new DCN sales. Once
real DCN purchases exist, returning to an old application would hide their UI:
preserve fulfillment access or forward-fix instead. Do not run down migrations
or restore an old database over new purchases. A database rollback requires
separate reconciliation of every intervening write and explicit operational
control. Keep the encrypted backup identity separately from its archive.

## Validation attribution

Reuse the recorded Stripe TEST and PayPal SANDBOX paid/webhook/refund/download
campaigns only for unchanged paths. Fresh release checks cover strict LIVE mode,
authentic shared-webhook handoff, immutable contracts, scoped grants, excerpt
approval, sales suspension, object checksums, private restoration, migration,
catalog-plan rollback/idempotence, dependency audit and Web/worker builds.
These are not a claimed real LIVE purchase. Record actual counts, failures and
final outcomes in the private deployment report; never convert a failed attempt
into an unqualified PASS.
