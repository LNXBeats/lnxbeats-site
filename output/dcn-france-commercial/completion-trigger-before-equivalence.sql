CREATE OR REPLACE FUNCTION public.digital_verify_completion_credit()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
    AND EXISTS(SELECT 1 FROM jsonb_array_elements(t."trackSnapshot") a WHERE a->>'trackId'=NEW."trackId"::text AND a->>'masterId'=s."trackSnapshot"->0->>'masterId')
  ) THEN RAISE EXCEPTION 'completion credit owner/content mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $function$
