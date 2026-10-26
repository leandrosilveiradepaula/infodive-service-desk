-- F6: deny direct access to internal ticket counters and untrusted
-- invocation of privileged helpers. Initially verified on isolated staging.
-- Run after migrations 20261015000100 through 20261015000600.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '45s';

ALTER TABLE public.ticket_protocol_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.ticket_protocol_counters FROM PUBLIC, anon, authenticated;

DO $f6$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f.signature);
  END LOOP;
END;
$f6$;

ALTER FUNCTION public.prevent_audit_log_mutation()
  SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.prevent_ticket_history_mutation()
  SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.prevent_contract_history_mutation()
  SET search_path = pg_catalog, public, pg_temp;

DO $post$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'RLS disabled on a public base table';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prosecdef
      AND has_function_privilege('anon',p.oid,'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'Anonymous SECURITY DEFINER EXECUTE survived';
  END IF;
  IF has_table_privilege('authenticated','public.ticket_protocol_counters','UPDATE')
     OR has_table_privilege('anon','public.ticket_protocol_counters','SELECT') THEN
    RAISE EXCEPTION 'Ticket counter direct grants survived';
  END IF;
END;
$post$;
COMMIT;
