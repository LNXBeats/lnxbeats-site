-- DCN consolidation: additive jurisdiction registry, with every initial country under review.
-- No rates, fiscal exemptions, registrations, LIVE approvals or historic order rewrites are inferred.
ALTER TABLE digital_orders ADD COLUMN "jurisdictionSnapshot" JSONB;
CREATE TABLE digital_country_tax_rules (
  id UUID PRIMARY KEY,
  "countryCode" VARCHAR(2) NOT NULL CHECK ("countryCode" ~ '^[A-Z]{2}$'),
  "subdivisionCode" VARCHAR(10) NOT NULL DEFAULT '' CHECK ("subdivisionCode"='' OR "subdivisionCode" ~ '^[A-Z]{2}-[A-Z0-9]{1,3}$'),
  version INTEGER NOT NULL CHECK (version > 0),
  "customerType" VARCHAR(3) NOT NULL DEFAULT 'B2C' CHECK ("customerType"='B2C'),
  decision VARCHAR(10) NOT NULL DEFAULT 'REVIEW' CHECK (decision IN ('ALLOW','REVIEW','BLOCK')),
  status VARCHAR(20) NOT NULL DEFAULT 'REVIEW_REQUIRED' CHECK (status IN ('DRAFT','REVIEW_REQUIRED','APPROVED','EXPIRED')),
  "approvalScope" VARCHAR(10) NOT NULL DEFAULT 'NONE' CHECK ("approvalScope" IN ('NONE','LOCAL_QA','LIVE')),
  "termsVersion" VARCHAR(100), "languageCode" VARCHAR(10),
  "fiscalApproved" BOOLEAN NOT NULL DEFAULT false, "legalApproved" BOOLEAN NOT NULL DEFAULT false, "paymentApproved" BOOLEAN NOT NULL DEFAULT false,
  "reviewedBy" VARCHAR(255), "reviewedAt" TIMESTAMPTZ(3), "validFrom" TIMESTAMPTZ(3), "expiresAt" TIMESTAMPTZ(3),
  "evidenceReference" VARCHAR(255), "evidenceHash" CHAR(64), "taxRule" JSONB,
  notes VARCHAR(2000), "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT digital_country_tax_rules_key UNIQUE ("countryCode","subdivisionCode","customerType",version),
  CONSTRAINT digital_territory_subdivision_country CHECK ("subdivisionCode"='' OR left("subdivisionCode",2)="countryCode"),
  CONSTRAINT digital_territory_tax_object CHECK ("taxRule" IS NULL OR jsonb_typeof("taxRule")='object'),
  CONSTRAINT digital_territory_allow_requires_evidence CHECK (decision<>'ALLOW' OR (
    status='APPROVED' AND "approvalScope" IN ('LOCAL_QA','LIVE') AND "fiscalApproved" AND "legalApproved" AND "paymentApproved"
    AND "termsVersion" IS NOT NULL AND length(trim("termsVersion"))>0 AND "languageCode" IS NOT NULL
    AND "reviewedBy" IS NOT NULL AND length(trim("reviewedBy"))>0 AND "reviewedAt" IS NOT NULL
    AND "validFrom" IS NOT NULL AND "expiresAt" IS NOT NULL AND "expiresAt">"validFrom"
    AND "evidenceReference" IS NOT NULL AND length(trim("evidenceReference"))>0 AND "evidenceHash" IS NOT NULL AND "evidenceHash" ~ '^[a-f0-9]{64}$'
    AND "taxRule" IS NOT NULL
  ))
);
CREATE INDEX digital_country_tax_rules_country_status_idx ON digital_country_tax_rules("countryCode","subdivisionCode",status);

INSERT INTO digital_country_tax_rules(id,"countryCode",version,notes)
SELECT md5('DCN-TERRITORY-REVIEW-1:' || code)::uuid, code, 1,
  CASE WHEN code='FR' THEN 'Franchise française historique connue. Nouvelle vente DCN B2C : qualification, fiscalité et CGV numériques non approuvées.'
    WHEN code='US' THEN 'État requis avant achat ; fiscalité et droits locaux non approuvés.'
    WHEN code='CA' THEN 'Province requise avant achat ; fiscalité et droits locaux non approuvés.'
    ELSE 'Aucune approbation DCN B2C, aucun taux, exemption ou immatriculation fiscale présumé.' END
FROM unnest(string_to_array('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW',' ')) AS code;

-- Approval history is append-only; a new version is required to change a decision.
CREATE FUNCTION digital_country_policy_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only digital jurisdiction policy' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER digital_country_policy_immutable BEFORE UPDATE OR DELETE ON digital_country_tax_rules
FOR EACH ROW EXECUTE FUNCTION digital_country_policy_append_only();

CREATE FUNCTION digital_preserve_jurisdiction_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."jurisdictionSnapshot" IS DISTINCT FROM OLD."jurisdictionSnapshot" THEN
    RAISE EXCEPTION 'immutable digital jurisdiction snapshot' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER digital_order_jurisdiction_immutable BEFORE UPDATE ON digital_orders
FOR EACH ROW EXECUTE FUNCTION digital_preserve_jurisdiction_snapshot();

REVOKE ALL ON digital_country_tax_rules FROM PUBLIC;
-- Runtime is SELECT-only through the versioned provisioner; no approval endpoint is supplied in this release.
