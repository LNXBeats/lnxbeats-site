\set ON_ERROR_STOP on

-- Préparé pour le prochain checkpoint opérateur. Ne pas exécuter depuis le
-- runtime Web : ce fichier exige une session de migration contrôlée.
--
-- Usage inspectable :
--   psql ... -v maintenance_role='lnx_maintenance_...' -f scripts/sql/rights-maintenance-runtime-grants.sql
\if :{?maintenance_role}
\else
  \echo 'maintenance_role is required'
  \quit false
\endif

BEGIN;

GRANT USAGE ON SCHEMA public TO :"maintenance_role";

GRANT SELECT, UPDATE ON TABLE
  public.rights_licenses,
  public.rights_requests,
  public.contract_documents
TO :"maintenance_role";

GRANT SELECT ON TABLE
  public.rights_withdrawal_requests,
  public.contract_templates,
  public.contract_acceptances
TO :"maintenance_role";

GRANT SELECT, INSERT ON TABLE
  public.rights_request_events
TO :"maintenance_role";

COMMIT;
