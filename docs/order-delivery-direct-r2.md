# Private Admin delivery multipart upload

## Scope and architecture

The previous browser posted the entire file to the Next delivery route. Its
10,551,296-byte proxy limit truncated a 68,993,674-byte upload before Busboy.
The new Admin panel sends small JSON control requests (16 KiB maximum) and
uploads file parts directly to private R2. It does not increase that proxy limit.

Existing Creations multipart/storage primitives are reused. Parts are 8 MiB,
browser concurrency is two, each part has up to three attempts, and signed URLs
expire after at most five minutes. The product ceiling remains **200 MiB
(209,715,200 bytes)** per file and eight attached/reserved deliveries per order.
The existing UI convention calls this ceiling “200 Mo”.

Sessions expire after one hour and are bound to the initiating Admin, order,
filename, size and canonical MIME. Only an opaque token is retained for browser
resume. Bucket, object key and provider upload ID cannot be supplied by a client.
Authoritative R2 parts/HEAD metadata are verified before completion. An upload
is not an attached delivery until full validation succeeds in the existing
media worker: bounded streaming to private temporary disk, complete audio
validation, image dimension checks or document magic checks. The Web does not
download the source during completion. Existing private downloads are unchanged.

The additive session table records reservations, completion recovery and worker
leases. A provider reply lost after completion is recovered using HEAD before
another completion attempt. Worker attachment and READY commit atomically;
replays produce one asset. Cancellation/expiry/rejection clean only their own
private objects. READY objects are never targeted by this cleanup. Publication
remains a separate existing Admin action. No email or status transition is made.

## Runtime and migration

New migration: `20261007010000_order_delivery_direct_upload`, one isolated table,
two indexes, restrictive foreign keys/checks; no historical data updates.
The versioned provisioner grants only SELECT/INSERT/UPDATE on that table to a
stable NOLOGIN group inherited by the configured non-owner runtime role. No
DELETE, TRUNCATE, DDL, ownership or global public-table grant. Existing grants
are preserved. Production requires fresh encrypted backup, isolated real restore,
upgrade/canaries and effective ACL checks before deployment.

## Reproducible local evidence (not a real R2/Safari recipe)

`scripts/test-delivery-direct-runtime.ts` requires an isolated loopback PostgreSQL
database named `lnx_delivery_direct_test`, `NODE_ENV=test`, and no Railway context.
Use a UTC PostgreSQL session/database, as required by this repository's Prisma
adapter date normalization. It uses a real non-owner role and simulated S3,
generates sparse PCM WAVs on temporary disk and deletes those files afterward.

Covered: 1 MiB, 68,993,468 bytes and exact 200 MiB complete WAV validation; eight
concurrent reservations/ninth rejection; replay/concurrency without duplicate
attachment; cross-order/Admin denial; expiry; limit+1 before R2 creation; lost
completion response recovery; invalid WAV; missing object, size mismatch, revoked
Admin; cancellation and terminal cleanup. Unit tests cover exact incident size,
boundaries, allowed metadata formats, part retry/resume and small control bodies.

The provided WAV validates with duration 239,560 ms. Its local size is 68,993,468
bytes (different by 206 bytes from the incident log). Do not alter/convert it.

## Outstanding gates

No Production deployment or main push has occurred. Real private R2 Preview,
download, Safari macOS/iPhone, interruption/resume and Railway memory evidence
remain required. Local provider doubles must not be reported as those passes.
The current Production dependency audit has one HIGH advisory in sharp 0.35.4
(GHSA-wq5f-xc86-pv6w); the narrowly scoped 0.35.5 security patch requires approval
before changing dependencies. No dependency or memory configuration was changed.
