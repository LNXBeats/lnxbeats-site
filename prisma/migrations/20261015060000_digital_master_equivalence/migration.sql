-- Same canonical track only. No historical credit, acquisition or master changes.
-- Existing equal-master proofs and uniqueness remain exactly as before.
CREATE OR REPLACE FUNCTION digital_verify_completion_credit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND (NEW.id,NEW."userId",NEW."trackId",NEW."sourceLineId",NEW."targetLineId",NEW."amountCents",NEW."sourceNetCents",NEW."createdAt")
    IS DISTINCT FROM (OLD.id,OLD."userId",OLD."trackId",OLD."sourceLineId",OLD."targetLineId",OLD."amountCents",OLD."sourceNetCents",OLD."createdAt") THEN
    RAISE EXCEPTION 'immutable completion credit proof' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND (OLD.status='CONSUMED' AND NEW.status<>'CONSUMED' OR OLD.status='RELEASED' AND NEW.status<>'RELEASED') THEN
    RAISE EXCEPTION 'terminal completion credit' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM digital_order_lines s JOIN digital_orders so ON so.id=s."orderId"
    JOIN digital_order_lines t ON t.id=NEW."targetLineId" JOIN digital_orders o ON o.id=t."orderId"
    WHERE s.id=NEW."sourceLineId" AND s.scope='TRACK' AND t.scope='ALBUM'
    AND so."userId"=NEW."userId" AND o."userId"=NEW."userId"
    AND so.currency='EUR' AND o.currency='EUR' AND so.mode=o.mode
    AND jsonb_array_length(s."trackSnapshot")=1
    AND s."trackSnapshot"->0->>'trackId'=NEW."trackId"::text
    AND EXISTS(SELECT 1 FROM jsonb_array_elements(t."trackSnapshot") a WHERE a->>'trackId'=NEW."trackId"::text AND (
      a->>'masterId'=s."trackSnapshot"->0->>'masterId'
      OR EXISTS(
        SELECT 1 FROM jsonb_array_elements(t."completionSnapshot"->'sources') proof
        JOIN digital_events e ON e.id::text=proof->'equivalence'->>'reviewId'
        JOIN users u ON u.id=e."actorId"
        JOIN digital_masters sm ON sm.id::text=s."trackSnapshot"->0->>'masterId'
        JOIN digital_masters tm ON tm.id::text=a->>'masterId'
        WHERE proof->>'sourceLineId'=s.id::text AND proof->>'trackId'=NEW."trackId"::text AND proof->>'masterId'=tm.id::text
          AND sm."trackId"=NEW."trackId" AND tm."trackId"=NEW."trackId" AND sm.id<>tm.id
          AND proof->'equivalence'->>'sourceMasterId'=sm.id::text AND proof->'equivalence'->>'targetMasterId'=tm.id::text
          AND e.kind='DIGITAL_MASTER_EQUIVALENCE' AND e.details->>'policy'='DCN_DIRECTIONAL_COMPLETION_EQUIVALENCE_V1'
          AND e.details->>'status'='APPROVED' AND e.details->>'pairKey'=sm.id::text||':'||tm.id::text
          AND e.details->>'trackId'=NEW."trackId"::text AND e.details->>'sourceMasterId'=sm.id::text AND e.details->>'targetMasterId'=tm.id::text
          AND e.details->>'recordHash'=proof->'equivalence'->>'recordHash'
          AND u.role='ADMIN' AND u.status='ACTIVE' AND u."emailVerified"=true
      )
    ))
  ) THEN RAISE EXCEPTION 'completion credit owner/content mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
