# Premium V3 — worker, audio, jukebox

## Scope

Base: `655f41ee9df5e58229dbdc9f340a69f58c462c2d`. Preserve the existing Web memory fix.
Audio commits `10cd13904238c0f03c65ad39dcdba25b1f2b686d` and
`5a7d3e139e885add17de0fea2d1d38caf24c91d0` are retained unchanged.
No schema, financial rules, R2 policy, donations or Analytics changes.

## Dedicated worker build

The worker executes TypeScript source using `tsx` with the `react-server`
condition; its runtime does not consume `.next` output. The previous generic
Railpack build unnecessarily invoked Next static page generation. Its last log
was `Collecting page data using 31 workers`; the provider did not return a
termination diagnosis. Do not infer OOM from that log.

Set the build override **only on the two media worker services** to
`npm ci --include=dev && npm run creations:media-worker:build`.
Railway now rejects selecting a new legacy TOML config file; do not migrate
global infrastructure configuration just for this fix. `railway.media-worker.toml`
is a versioned recipe/reference, NOT an active config path on either service.
The supported service build override runs `npm ci --include=dev` (locked dependencies, no reused node_modules),
then `creations:media-worker:build`: Prisma generation, a no-emit typecheck rooted
in the worker, and a real import/FFmpeg encoder preflight. It does not poll jobs,
connect to DB/R2, generate Next pages or run migrations.
Keep `tsx` available at runtime; it is already a development dependency used by
the existing service. Do not enable dependency pruning. Source files, tsconfig,
generated Prisma and installed dependencies must remain in the runtime image.
The start command remains `npm run creations:media-worker` and pre-deploy is empty.
Web config/start/memory, replicas, service limits and other workers are unchanged.
Railpack reference: https://railpack.com/languages/node/

The gate is a clean Preview build plus an actual synthetic R2 job processed by
the deployed worker through FFmpeg to READY, not the import preflight alone.

## Jukebox ordering

The public scene remains exhaustive: all publicly visible published and
in-development projects, including projects without an audio preview. Drafts
and archives remain excluded. No existing projects are silently removed merely
because their legacy jukebox placement is null.

The page now propagates `jukeboxPosition` and orders its initial collection using
the same function as the client. Explicit positions sort first, ascending;
null/undefined positions follow, retaining `catalogPosition` order. Collisions
use `catalogPosition`, then French slug comparison. No truthiness fallback:
zero is not mistaken for null (the current Admin input contract accepts 1–999).
Date sorts retain their date priority and use this editorial policy for ties.
No production positions are rewritten. A representative `vie-de-chien` fixture
with jukebox position 1 and catalogue position 26 must lead the editorial scene.
Selection remains separate from playback; sorting never starts audio.

## Release gates

Re-run final canonical/security/media tests and clean builds. Deploy Web and
worker Preview at the exact same candidate SHA. Validate real audio upload above
the former photo proxy cap, a synthetic video job, and public jukebox order.
Create a new encrypted Production backup and restore it in isolated PostgreSQL.
Require the old memory patch to have no changes. Only then fast-forward main and
deploy both Web and worker at the same SHA. No new migration is expected.
Provider build termination cause must remain explicitly unconfirmed unless new
evidence identifies it; a successful dedicated build proves removal of the
unnecessary Next build dependency, not a retrospective OOM diagnosis.
