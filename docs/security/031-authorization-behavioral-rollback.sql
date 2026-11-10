-- AUTHORED ONLY: requires separate approval after applying 031 to verified staging.
-- Synthetic fixtures are transaction-local. Never run against production.
\set ON_ERROR_STOP on
SELECT current_database() AS informational_database_only;
-- The external launcher MUST independently verify the staging project before execution.
-- Do not treat current_database() as project identity.

BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';
CREATE TEMP TABLE qa_results(label text, passed boolean, detail text);
CREATE FUNCTION pg_temp.qid(v text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT md5('QA-031-ROLLBACK-'||v)::uuid $$;
CREATE FUNCTION pg_temp.qcheck(label text,ok boolean,detail text default '') RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$BEGIN INSERT INTO qa_results VALUES(label,coalesce(ok,false),detail); END$$;
CREATE FUNCTION pg_temp.qdeny(label text,stmt text,pattern text) RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE msg text; good boolean:=false;
BEGIN
 BEGIN EXECUTE stmt; RAISE EXCEPTION USING ERRCODE='ZQ001',MESSAGE='unexpected authorization success';
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT; good:=SQLSTATE<>'ZQ001' AND msg ~ pattern; END;
 INSERT INTO qa_results VALUES(label,good,msg);
END$$;
CREATE FUNCTION pg_temp.qallow(label text,stmt text) RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE msg text:='allowed'; good boolean:=true; n bigint;
BEGIN
 BEGIN EXECUTE stmt; GET DIAGNOSTICS n=ROW_COUNT; good:=n>0;
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;good:=false; END;
 INSERT INTO qa_results VALUES(label,good,msg);
END$$;
CREATE FUNCTION pg_temp.qzero(label text,stmt text) RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE n bigint;msg text:='no rows affected';good boolean;
BEGIN BEGIN EXECUTE stmt;GET DIAGNOSTICS n=ROW_COUNT;good:=n=0;
EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;good:=false;END;
INSERT INTO qa_results VALUES(label,good,msg);END$$;
-- These two denials are verified by SQLSTATE, not a single database error string.
CREATE FUNCTION pg_temp.qdeny_state(label text,stmt text,expected_state text,pattern text default null)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE msg text; actual_state text; good boolean:=false;
BEGIN
 BEGIN EXECUTE stmt; RAISE EXCEPTION USING ERRCODE='ZQ001',MESSAGE='unexpected authorization success';
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT,actual_state=RETURNED_SQLSTATE;
  good:=actual_state=expected_state AND (pattern IS NULL OR msg ~ pattern);
 END;
 INSERT INTO qa_results VALUES(label,good,msg);
END$$;
-- Hash state without exposing row contents; snapshots use the same trusted role.
CREATE FUNCTION pg_temp.q_denial_state() RETURNS jsonb LANGUAGE sql SECURITY INVOKER AS $$
 SELECT jsonb_build_object(
  'staged',(SELECT md5(coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id)::text,'[]')) FROM public.sps_staged_orders s),
  'orders',(SELECT md5(coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.id)::text,'[]')) FROM public.orders o),
  'lines',(SELECT md5(coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.id)::text,'[]')) FROM public.order_lines l),
  'audits',(SELECT md5(coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id)::text,'[]')) FROM public.audit_events a));
$$;
DO $$BEGIN EXECUTE format('GRANT USAGE ON SCHEMA %I TO authenticated', (SELECT nspname FROM pg_namespace WHERE oid=pg_my_temp_schema())); END$$;
GRANT ALL ON qa_results TO authenticated;
INSERT INTO organizations(id,name,slug) VALUES(pg_temp.qid('orga'),'QA 031 Org A','qa-031-rollback-a'),(pg_temp.qid('orgb'),'QA 031 Org B','qa-031-rollback-b');

INSERT INTO auth.users(id,email) VALUES(pg_temp.qid('office'),'qa-031-office@example.invalid');
INSERT INTO profiles(id,organization_id,display_name,role) VALUES(pg_temp.qid('office'),pg_temp.qid('orga'),'QA 031 office','office');
INSERT INTO auth.users(id,email) VALUES(pg_temp.qid('leadership'),'qa-031-leadership@example.invalid');
INSERT INTO profiles(id,organization_id,display_name,role) VALUES(pg_temp.qid('leadership'),pg_temp.qid('orga'),'QA 031 leadership','leadership');
INSERT INTO auth.users(id,email) VALUES(pg_temp.qid('lucid_admin'),'qa-031-lucid_admin@example.invalid');
INSERT INTO profiles(id,organization_id,display_name,role) VALUES(pg_temp.qid('lucid_admin'),pg_temp.qid('orga'),'QA 031 lucid_admin','lucid_admin');
INSERT INTO auth.users(id,email) VALUES(pg_temp.qid('production'),'qa-031-production@example.invalid');
INSERT INTO profiles(id,organization_id,display_name,role) VALUES(pg_temp.qid('production'),pg_temp.qid('orga'),'QA 031 production','production');
INSERT INTO auth.users(id,email) VALUES(pg_temp.qid('officeb'),'qa-031-officeb@example.invalid'); INSERT INTO profiles(id,organization_id,display_name,role) VALUES(pg_temp.qid('officeb'),pg_temp.qid('orgb'),'QA 031 Office B','office');
SELECT set_config('request.jwt.claim.sub',pg_temp.qid('office')::text,true);
SELECT pg_temp.qcheck('office actor helper resolves actual subject',public.lucid_request_actor_id()=pg_temp.qid('office'));
INSERT INTO customers(id,organization_id,customer_code,name,source_system,source_record_id) VALUES(pg_temp.qid('customera'),pg_temp.qid('orga'),'QA-031-CUSTOMER-a','QA 031 Customer a','lucid_qa','QA-031-CUSTOMER-a');
INSERT INTO customer_ship_tos(id,organization_id,customer_id,location_code,name,source_system,source_record_id) VALUES(pg_temp.qid('shipa'),pg_temp.qid('orga'),pg_temp.qid('customera'),'QA-031-SHIP-a','QA 031 Ship a','lucid_qa','QA-031-SHIP-a');
INSERT INTO items(id,organization_id,item_code,description,stock_uom,sell_uom,bill_uom,source_system,source_record_id) VALUES(pg_temp.qid('itema'),pg_temp.qid('orga'),'QA-031-item-a','QA 031 Item','CS','CS','LB','lucid_qa','QA-031-item-a');
INSERT INTO items(id,organization_id,item_code,description,stock_uom,sell_uom,bill_uom,source_system,source_record_id) VALUES(pg_temp.qid('item2a'),pg_temp.qid('orga'),'QA-031-item2-a','QA 031 Item','CS','CS','LB','lucid_qa','QA-031-item2-a');
INSERT INTO integration_customer_mappings(id,organization_id,source_trading_partner_id,customer_id,food_connex_customer_name) VALUES(pg_temp.qid('cma'),pg_temp.qid('orga'),'QA-031-PARTNER-a',pg_temp.qid('customera'),'QA Customer');
INSERT INTO integration_ship_to_mappings(id,organization_id,source_trading_partner_id,source_location_code,ship_to_id) VALUES(pg_temp.qid('sma'),pg_temp.qid('orga'),'QA-031-PARTNER-a','QA-031-LOC-a',pg_temp.qid('shipa'));
INSERT INTO integration_item_mappings(id,organization_id,source_trading_partner_id,buyer_part_number,item_id,food_connex_item_number,sps_uom,food_connex_uom) VALUES(pg_temp.qid('ima'),pg_temp.qid('orga'),'QA-031-PARTNER-a','QA-031-BUYER-a',pg_temp.qid('itema'),'QA-031-item-a','CS','CS');
INSERT INTO sps_staged_orders(id,organization_id,external_po,trading_partner_id,document_type,source_document_key,payload_hash) VALUES(pg_temp.qid('basea'),pg_temp.qid('orga'),'QA-031-BASE-a','QA-031-PARTNER-a','850','QA-031-BASE-a','QA-031-HASH-ORIGINAL');
INSERT INTO sps_staged_order_lines(id,organization_id,staged_order_id,line_number,quantity,sps_uom) VALUES(pg_temp.qid('linea'),pg_temp.qid('orga'),pg_temp.qid('basea'),'1',2,'CS');
INSERT INTO sps_order_exceptions(id,organization_id,staged_order_id,exception_code,severity,message) VALUES(pg_temp.qid('exa'),pg_temp.qid('orga'),pg_temp.qid('basea'),'QA-031-INITIAL','info','QA synthetic check');
SELECT set_config('request.jwt.claim.sub',pg_temp.qid('officeb')::text,true);
INSERT INTO customers(id,organization_id,customer_code,name,source_system,source_record_id) VALUES(pg_temp.qid('customerb'),pg_temp.qid('orgb'),'QA-031-CUSTOMER-b','QA 031 Customer b','lucid_qa','QA-031-CUSTOMER-b');
INSERT INTO customer_ship_tos(id,organization_id,customer_id,location_code,name,source_system,source_record_id) VALUES(pg_temp.qid('shipb'),pg_temp.qid('orgb'),pg_temp.qid('customerb'),'QA-031-SHIP-b','QA 031 Ship b','lucid_qa','QA-031-SHIP-b');
INSERT INTO items(id,organization_id,item_code,description,stock_uom,sell_uom,bill_uom,source_system,source_record_id) VALUES(pg_temp.qid('itemb'),pg_temp.qid('orgb'),'QA-031-item-b','QA 031 Item','CS','CS','LB','lucid_qa','QA-031-item-b');
INSERT INTO items(id,organization_id,item_code,description,stock_uom,sell_uom,bill_uom,source_system,source_record_id) VALUES(pg_temp.qid('item2b'),pg_temp.qid('orgb'),'QA-031-item2-b','QA 031 Item','CS','CS','LB','lucid_qa','QA-031-item2-b');
INSERT INTO integration_customer_mappings(id,organization_id,source_trading_partner_id,customer_id,food_connex_customer_name) VALUES(pg_temp.qid('cmb'),pg_temp.qid('orgb'),'QA-031-PARTNER-b',pg_temp.qid('customerb'),'QA Customer');
INSERT INTO integration_ship_to_mappings(id,organization_id,source_trading_partner_id,source_location_code,ship_to_id) VALUES(pg_temp.qid('smb'),pg_temp.qid('orgb'),'QA-031-PARTNER-b','QA-031-LOC-b',pg_temp.qid('shipb'));
INSERT INTO integration_item_mappings(id,organization_id,source_trading_partner_id,buyer_part_number,item_id,food_connex_item_number,sps_uom,food_connex_uom) VALUES(pg_temp.qid('imb'),pg_temp.qid('orgb'),'QA-031-PARTNER-b','QA-031-BUYER-b',pg_temp.qid('itemb'),'QA-031-item-b','CS','CS');
INSERT INTO sps_staged_orders(id,organization_id,external_po,trading_partner_id,document_type,source_document_key,payload_hash) VALUES(pg_temp.qid('baseb'),pg_temp.qid('orgb'),'QA-031-BASE-b','QA-031-PARTNER-b','850','QA-031-BASE-b','QA-031-HASH-ORIGINAL');
INSERT INTO sps_staged_order_lines(id,organization_id,staged_order_id,line_number,quantity,sps_uom) VALUES(pg_temp.qid('lineb'),pg_temp.qid('orgb'),pg_temp.qid('baseb'),'1',2,'CS');
INSERT INTO sps_order_exceptions(id,organization_id,staged_order_id,exception_code,severity,message) VALUES(pg_temp.qid('exb'),pg_temp.qid('orgb'),pg_temp.qid('baseb'),'QA-031-INITIAL','info','QA synthetic check');
SELECT set_config('request.jwt.claim.sub',pg_temp.qid('office')::text,true);
CREATE FUNCTION pg_temp.make_order(tag text,doctype text default '850',qty numeric default 2,uom_state text default 'match',item_state text default 'mapped') RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE sid uuid:=pg_temp.qid(tag);
BEGIN
 INSERT INTO public.sps_staged_orders(id,organization_id,external_po,trading_partner_id,document_type,source_document_key,payload_hash,business_po_number,customer_mapping_id,ship_to_mapping_id,review_status,mapping_status,normalized_payload)
 VALUES(sid,pg_temp.qid('orga'),'QA-031-'||tag,'QA-031-PARTNER-a',doctype,'QA-031-SOURCE-'||tag,'QA-031-HASH-'||tag,'QA-031-'||tag,pg_temp.qid('cma'),pg_temp.qid('sma'),'ready','mapped','{"qa":true}'::jsonb);
 INSERT INTO public.sps_staged_order_lines(id,organization_id,staged_order_id,line_number,description,quantity,sps_uom,item_mapping_id,item_mapping_status,uom_status,buyer_part_number)
 VALUES(pg_temp.qid(tag||'-line'),pg_temp.qid('orga'),sid,'1','QA 031 Item',qty,case when uom_state='mismatch' then 'EA' else 'CS' end,pg_temp.qid('ima'),item_state,uom_state,'QA-031-BUYER-a');
 RETURN sid;
END$$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',pg_temp.qid('production')::text,true);
SELECT pg_temp.qcheck('production actor helper resolves actual subject',public.lucid_request_actor_id()=pg_temp.qid('production'));
SELECT pg_temp.qdeny('Production INSERT sps_staged_orders',$q$INSERT INTO sps_staged_orders(organization_id,external_po) VALUES(pg_temp.qid('orga'),'QA-031-PROD-DENIED')$q$,'Your role cannot change incoming SPS orders or mappings|row-level security');
SELECT pg_temp.qdeny('Production UPDATE sps_staged_orders',$q$UPDATE sps_staged_orders SET source_customer_name='QA changed' WHERE id=pg_temp.qid('basea')$q$,'Your role cannot change incoming SPS orders or mappings|row-level security');
SELECT pg_temp.qdeny('Production DELETE sps_staged_orders',$q$DELETE FROM sps_staged_orders WHERE id=pg_temp.qid('basea')$q$,'Your role cannot change incoming SPS orders or mappings|row-level security');
SELECT pg_temp.qdeny('Production INSERT sps_staged_order_lines',$q$INSERT INTO sps_staged_order_lines(organization_id,staged_order_id,quantity) VALUES(pg_temp.qid('orga'),pg_temp.qid('basea'),2)$q$,'Your role cannot change incoming SPS orders or mappings|row-level security');
SELECT pg_temp.qdeny('Production UPDATE sps_staged_order_lines',$q$UPDATE sps_staged_order_lines SET description='QA changed' WHERE id=pg_temp.qid('linea')$q$,'Your role cannot change incoming SPS orders or mappings|row-level security');
SELECT pg_temp.qdeny('Production DELETE sps_staged_order_lines',$q$DELETE FROM sps_staged_order_lines WHERE id=pg_temp.qid('linea')$q$,'Your role cannot change incoming SPS orders or mappings|row-level security');
SELECT pg_temp.qdeny('Production INSERT sps_order_exceptions',$q$INSERT INTO sps_order_exceptions(organization_id,staged_order_id,exception_code,message) VALUES(pg_temp.qid('orga'),pg_temp.qid('basea'),'QA-PROD','QA denied')$q$,'Your role cannot change incoming SPS orders or mappings|row-level security');
SELECT pg_temp.qdeny('Production UPDATE sps_order_exceptions',$q$UPDATE sps_order_exceptions SET message='QA changed' WHERE id=pg_temp.qid('exa')$q$,'Your role cannot change incoming SPS orders or mappings|row-level security');
SELECT pg_temp.qdeny('Production DELETE sps_order_exceptions',$q$DELETE FROM sps_order_exceptions WHERE id=pg_temp.qid('exa')$q$,'Your role cannot change incoming SPS orders or mappings|row-level security');
SELECT pg_temp.qdeny('Production INSERT integration_customer_mappings',$q$INSERT INTO integration_customer_mappings(organization_id,source_trading_partner_id) VALUES(pg_temp.qid('orga'),'QA-031-PROD-DENIED')$q$,'Your role cannot change incoming SPS orders or mappings|row-level security');
SELECT pg_temp.qdeny('Production UPDATE integration_customer_mappings',$q$UPDATE integration_customer_mappings SET source_customer_name='QA changed' WHERE id=pg_temp.qid('cma')$q$,'Your role cannot change incoming SPS orders or mappings|row-level security');
SELECT pg_temp.qdeny('Production DELETE integration_customer_mappings',$q$DELETE FROM integration_customer_mappings WHERE id=pg_temp.qid('cma')$q$,'Your role cannot change incoming SPS orders or mappings|row-level security');
SELECT pg_temp.qdeny('Production INSERT integration_ship_to_mappings',$q$INSERT INTO integration_ship_to_mappings(organization_id,source_location_code) VALUES(pg_temp.qid('orga'),'QA-031-PROD-DENIED')$q$,'Your role cannot change incoming SPS orders or mappings|row-level security');
SELECT pg_temp.qdeny('Production UPDATE integration_ship_to_mappings',$q$UPDATE integration_ship_to_mappings SET source_ship_to_name='QA changed' WHERE id=pg_temp.qid('sma')$q$,'Your role cannot change incoming SPS orders or mappings|row-level security');
SELECT pg_temp.qdeny('Production DELETE integration_ship_to_mappings',$q$DELETE FROM integration_ship_to_mappings WHERE id=pg_temp.qid('sma')$q$,'Your role cannot change incoming SPS orders or mappings|row-level security');
SELECT pg_temp.qdeny('Production INSERT integration_item_mappings',$q$INSERT INTO integration_item_mappings(organization_id,buyer_part_number,food_connex_item_number) VALUES(pg_temp.qid('orga'),'QA-031-PROD-DENIED','QA-031-PROD-DENIED')$q$,'Your role cannot change incoming SPS orders or mappings|row-level security');
SELECT pg_temp.qdeny('Production UPDATE integration_item_mappings',$q$UPDATE integration_item_mappings SET food_connex_item_number='QA changed' WHERE id=pg_temp.qid('ima')$q$,'Your role cannot change incoming SPS orders or mappings|row-level security');
SELECT pg_temp.qdeny('Production DELETE integration_item_mappings',$q$DELETE FROM integration_item_mappings WHERE id=pg_temp.qid('ima')$q$,'Your role cannot change incoming SPS orders or mappings|row-level security');
SELECT pg_temp.qdeny('Production promotion denied', $q$SELECT * FROM promote_sps_staged_order(pg_temp.qid('basea'))$q$, 'Your role cannot send incoming orders to production');
SELECT set_config('request.jwt.claim.sub',pg_temp.qid('office')::text,true);
SELECT pg_temp.qallow('office UPDATE sps_staged_orders',$q$UPDATE sps_staged_orders SET source_customer_name='QA changed' WHERE id=pg_temp.qid('basea')$q$);
SELECT pg_temp.qallow('office UPDATE sps_staged_order_lines',$q$UPDATE sps_staged_order_lines SET description='QA changed' WHERE id=pg_temp.qid('linea')$q$);
SELECT pg_temp.qallow('office UPDATE sps_order_exceptions',$q$UPDATE sps_order_exceptions SET message='QA changed' WHERE id=pg_temp.qid('exa')$q$);
SELECT pg_temp.qallow('office UPDATE integration_customer_mappings',$q$UPDATE integration_customer_mappings SET source_customer_name='QA changed' WHERE id=pg_temp.qid('cma')$q$);
SELECT pg_temp.qallow('office UPDATE integration_ship_to_mappings',$q$UPDATE integration_ship_to_mappings SET source_ship_to_name='QA changed' WHERE id=pg_temp.qid('sma')$q$);
SELECT pg_temp.qallow('office UPDATE integration_item_mappings',$q$UPDATE integration_item_mappings SET food_connex_item_number='QA changed' WHERE id=pg_temp.qid('ima')$q$);
SELECT pg_temp.make_order('office-850'); SELECT pg_temp.qallow('office 850 promotion',$q$SELECT * FROM promote_sps_staged_order(pg_temp.qid('office-850'))$q$);
SELECT set_config('request.jwt.claim.sub',pg_temp.qid('leadership')::text,true);
SELECT pg_temp.qcheck('leadership actor helper resolves actual subject',public.lucid_request_actor_id()=pg_temp.qid('leadership'));
SELECT pg_temp.qallow('leadership UPDATE sps_staged_orders',$q$UPDATE sps_staged_orders SET source_customer_name='QA changed' WHERE id=pg_temp.qid('basea')$q$);
SELECT pg_temp.qallow('leadership UPDATE sps_staged_order_lines',$q$UPDATE sps_staged_order_lines SET description='QA changed' WHERE id=pg_temp.qid('linea')$q$);
SELECT pg_temp.qallow('leadership UPDATE sps_order_exceptions',$q$UPDATE sps_order_exceptions SET message='QA changed' WHERE id=pg_temp.qid('exa')$q$);
SELECT pg_temp.qallow('leadership UPDATE integration_customer_mappings',$q$UPDATE integration_customer_mappings SET source_customer_name='QA changed' WHERE id=pg_temp.qid('cma')$q$);
SELECT pg_temp.qallow('leadership UPDATE integration_ship_to_mappings',$q$UPDATE integration_ship_to_mappings SET source_ship_to_name='QA changed' WHERE id=pg_temp.qid('sma')$q$);
SELECT pg_temp.qallow('leadership UPDATE integration_item_mappings',$q$UPDATE integration_item_mappings SET food_connex_item_number='QA changed' WHERE id=pg_temp.qid('ima')$q$);
SELECT pg_temp.make_order('leadership-850'); SELECT pg_temp.qallow('leadership 850 promotion',$q$SELECT * FROM promote_sps_staged_order(pg_temp.qid('leadership-850'))$q$);
SELECT set_config('request.jwt.claim.sub',pg_temp.qid('lucid_admin')::text,true);
SELECT pg_temp.qcheck('lucid_admin actor helper resolves actual subject',public.lucid_request_actor_id()=pg_temp.qid('lucid_admin'));
SELECT pg_temp.qallow('lucid_admin UPDATE sps_staged_orders',$q$UPDATE sps_staged_orders SET source_customer_name='QA changed' WHERE id=pg_temp.qid('basea')$q$);
SELECT pg_temp.qallow('lucid_admin UPDATE sps_staged_order_lines',$q$UPDATE sps_staged_order_lines SET description='QA changed' WHERE id=pg_temp.qid('linea')$q$);
SELECT pg_temp.qallow('lucid_admin UPDATE sps_order_exceptions',$q$UPDATE sps_order_exceptions SET message='QA changed' WHERE id=pg_temp.qid('exa')$q$);
SELECT pg_temp.qallow('lucid_admin UPDATE integration_customer_mappings',$q$UPDATE integration_customer_mappings SET source_customer_name='QA changed' WHERE id=pg_temp.qid('cma')$q$);
SELECT pg_temp.qallow('lucid_admin UPDATE integration_ship_to_mappings',$q$UPDATE integration_ship_to_mappings SET source_ship_to_name='QA changed' WHERE id=pg_temp.qid('sma')$q$);
SELECT pg_temp.qallow('lucid_admin UPDATE integration_item_mappings',$q$UPDATE integration_item_mappings SET food_connex_item_number='QA changed' WHERE id=pg_temp.qid('ima')$q$);
SELECT pg_temp.make_order('lucid_admin-850'); SELECT pg_temp.qallow('lucid_admin 850 promotion',$q$SELECT * FROM promote_sps_staged_order(pg_temp.qid('lucid_admin-850'))$q$);
SELECT set_config('request.jwt.claim.sub',pg_temp.qid('office')::text,true);
SELECT pg_temp.make_order('valid850');
INSERT INTO sps_order_exceptions(id,organization_id,staged_order_id,exception_code,severity,message,status)
 VALUES(pg_temp.qid('valid-ex'),pg_temp.qid('orga'),pg_temp.qid('valid850'),'QA-031-RESOLVE','info','QA synthetic audit','open');
UPDATE sps_order_exceptions SET status='resolved',resolution_action='QA validation',resolved_by=pg_temp.qid('office'),resolved_at=now() WHERE id=pg_temp.qid('valid-ex');
CREATE TEMP TABLE qa_first AS SELECT * FROM promote_sps_staged_order(pg_temp.qid('valid850'));
SELECT pg_temp.qcheck('850 promotion once',(SELECT count(*)=1 FROM orders WHERE sps_staged_order_id=pg_temp.qid('valid850')));
SELECT pg_temp.qcheck('850 one operational line',(SELECT count(*)=1 FROM order_lines WHERE order_id=(SELECT operational_order_id FROM qa_first)));
SELECT pg_temp.qcheck('850 exact UOM and positive quantity',(SELECT quantity_cases=2 AND uom='CS' FROM order_lines WHERE order_id=(SELECT operational_order_id FROM qa_first)));
CREATE TEMP TABLE qa_repeat AS SELECT * FROM promote_sps_staged_order(pg_temp.qid('valid850'));
SELECT pg_temp.qcheck('Idempotent same order',(SELECT a.operational_order_id=b.operational_order_id AND b.already_promoted FROM qa_first a CROSS JOIN qa_repeat b));
SELECT pg_temp.qcheck('Idempotent no duplicate order or line',(SELECT count(*)=1 FROM orders WHERE sps_staged_order_id=pg_temp.qid('valid850')) AND (SELECT count(*)=1 FROM order_lines WHERE order_id=(SELECT operational_order_id FROM qa_first)));
SELECT pg_temp.qdeny('Promoted header rewrite',$q$UPDATE sps_staged_orders SET payload_hash='QA-ALTERED' WHERE id=pg_temp.qid('valid850')$q$,'Promoted SPS source documents are immutable');
SELECT pg_temp.qdeny('Promoted line delete',$q$DELETE FROM sps_staged_order_lines WHERE staged_order_id=pg_temp.qid('valid850')$q$,'Promoted SPS source documents are immutable');
SELECT pg_temp.qdeny('Promoted line rewrite',$q$UPDATE sps_staged_order_lines SET quantity=999 WHERE staged_order_id=pg_temp.qid('valid850')$q$,'Promoted SPS source documents are immutable');
SELECT pg_temp.qdeny('Promoted exception delete',$q$DELETE FROM sps_order_exceptions WHERE staged_order_id=pg_temp.qid('valid850')$q$,'Promoted SPS source documents are immutable');
SELECT pg_temp.qdeny('Promoted line reparent denied',$q$UPDATE sps_staged_order_lines SET staged_order_id=pg_temp.qid('basea') WHERE staged_order_id=pg_temp.qid('valid850')$q$,'Promoted SPS source documents are immutable');
SELECT pg_temp.qdeny('Promoted exception reparent denied',$q$UPDATE sps_order_exceptions SET staged_order_id=pg_temp.qid('basea') WHERE id=pg_temp.qid('valid-ex')$q$,'Promoted SPS source documents are immutable');
SELECT pg_temp.qdeny('Promoted reset denied',$q$UPDATE sps_staged_orders SET promoted_order_id=NULL,review_status='ready' WHERE id=pg_temp.qid('valid850')$q$,'Promoted SPS source documents are immutable');
SELECT pg_temp.qcheck('Promoted source preserved',(SELECT payload_hash='QA-031-HASH-valid850' AND review_status='promoted' AND promoted_order_id=(SELECT operational_order_id FROM qa_first) FROM sps_staged_orders WHERE id=pg_temp.qid('valid850')));
SELECT pg_temp.make_order('change860','860');
UPDATE sps_staged_orders SET external_po='QA-031-valid850',business_po_number='QA-031-valid850',parent_staged_order_id=pg_temp.qid('valid850') WHERE id=pg_temp.qid('change860');
SELECT pg_temp.qcheck('Same PO separate 850 and 860',(SELECT count(*)=2 FROM sps_staged_orders WHERE external_po='QA-031-valid850'));
SELECT pg_temp.qdeny('860 promotion denied',$q$SELECT * FROM promote_sps_staged_order(pg_temp.qid('change860'))$q$,'Purchase Order Change requires review');
SELECT pg_temp.qcheck('860 no operational order',(SELECT count(*)=0 FROM orders WHERE sps_staged_order_id=pg_temp.qid('change860')));
SELECT pg_temp.qcheck('860 original order intact',(SELECT count(*)=1 FROM orders WHERE sps_staged_order_id=pg_temp.qid('valid850')) AND (SELECT quantity_cases=2 FROM order_lines WHERE order_id=(SELECT operational_order_id FROM qa_first)));
SELECT pg_temp.qcheck('Same org parent allowed',(SELECT parent_staged_order_id=pg_temp.qid('valid850') FROM sps_staged_orders WHERE id=pg_temp.qid('change860')));
SELECT pg_temp.qdeny('Cross org parent denied',$q$UPDATE sps_staged_orders SET parent_staged_order_id=pg_temp.qid('baseb') WHERE id=pg_temp.qid('change860')$q$,'parent must belong to the same organization');

SELECT pg_temp.make_order('nullqty','850',NULL,'match','mapped'); SELECT pg_temp.qdeny('nullqty promotion denied',$q$SELECT * FROM promote_sps_staged_order(pg_temp.qid('nullqty'))$q$,'Every incoming line'); SELECT pg_temp.qcheck('nullqty no order',(SELECT count(*)=0 FROM orders WHERE sps_staged_order_id=pg_temp.qid('nullqty')));
SELECT pg_temp.make_order('zeroqty','850',0,'match','mapped'); SELECT pg_temp.qdeny('zeroqty promotion denied',$q$SELECT * FROM promote_sps_staged_order(pg_temp.qid('zeroqty'))$q$,'Every incoming line'); SELECT pg_temp.qcheck('zeroqty no order',(SELECT count(*)=0 FROM orders WHERE sps_staged_order_id=pg_temp.qid('zeroqty')));
SELECT pg_temp.make_order('negativeqty','850',-2,'match','mapped'); SELECT pg_temp.qdeny('negativeqty promotion denied',$q$SELECT * FROM promote_sps_staged_order(pg_temp.qid('negativeqty'))$q$,'Every incoming line'); SELECT pg_temp.qcheck('negativeqty no order',(SELECT count(*)=0 FROM orders WHERE sps_staged_order_id=pg_temp.qid('negativeqty')));
SELECT pg_temp.make_order('uom-mismatch','850',2,'mismatch','mapped'); SELECT pg_temp.qdeny('uom-mismatch promotion denied',$q$SELECT * FROM promote_sps_staged_order(pg_temp.qid('uom-mismatch'))$q$,'Every incoming line'); SELECT pg_temp.qcheck('uom-mismatch no order',(SELECT count(*)=0 FROM orders WHERE sps_staged_order_id=pg_temp.qid('uom-mismatch')));
SELECT pg_temp.make_order('ambiguous','850',2,'match','ambiguous'); SELECT pg_temp.qdeny('ambiguous promotion denied',$q$SELECT * FROM promote_sps_staged_order(pg_temp.qid('ambiguous'))$q$,'Every incoming line'); SELECT pg_temp.qcheck('ambiguous no order',(SELECT count(*)=0 FROM orders WHERE sps_staged_order_id=pg_temp.qid('ambiguous')));
SELECT pg_temp.make_order('inactive-customers'); RESET ROLE; UPDATE customers SET status='inactive' WHERE id=pg_temp.qid('customera'); SET LOCAL ROLE authenticated; SELECT pg_temp.qdeny('inactive-customers denied',$q$SELECT * FROM promote_sps_staged_order(pg_temp.qid('inactive-customers'))$q$,'inactive Lucid master data'); RESET ROLE; UPDATE customers SET status='active' WHERE id=pg_temp.qid('customera'); SET LOCAL ROLE authenticated; SELECT pg_temp.qcheck('inactive-customers no order',(SELECT count(*)=0 FROM orders WHERE sps_staged_order_id=pg_temp.qid('inactive-customers')));
SELECT pg_temp.make_order('inactive-customer_ship_tos'); RESET ROLE; UPDATE customer_ship_tos SET status='inactive' WHERE id=pg_temp.qid('shipa'); SET LOCAL ROLE authenticated; SELECT pg_temp.qdeny('inactive-customer_ship_tos denied',$q$SELECT * FROM promote_sps_staged_order(pg_temp.qid('inactive-customer_ship_tos'))$q$,'inactive Lucid master data'); RESET ROLE; UPDATE customer_ship_tos SET status='active' WHERE id=pg_temp.qid('shipa'); SET LOCAL ROLE authenticated; SELECT pg_temp.qcheck('inactive-customer_ship_tos no order',(SELECT count(*)=0 FROM orders WHERE sps_staged_order_id=pg_temp.qid('inactive-customer_ship_tos')));
SELECT pg_temp.make_order('inactive-items'); RESET ROLE; UPDATE items SET status='inactive' WHERE id=pg_temp.qid('itema'); SET LOCAL ROLE authenticated; CREATE TEMP TABLE qa_inactive_before AS SELECT pg_temp.q_denial_state() AS state; SELECT pg_temp.qcheck('Inactive item fixture remains inactive',(SELECT status='inactive' FROM items WHERE id=pg_temp.qid('itema'))); SELECT pg_temp.qdeny_state('inactive-items denied',$q$SELECT * FROM promote_sps_staged_order(pg_temp.qid('inactive-items'))$q$,'P0001','inactive Lucid master data|Every incoming line needs an active exact item'); SELECT pg_temp.qcheck('Inactive promotion leaves source orders lines and audit unchanged',(SELECT state=pg_temp.q_denial_state() FROM qa_inactive_before)); RESET ROLE; UPDATE items SET status='active' WHERE id=pg_temp.qid('itema'); SET LOCAL ROLE authenticated; SELECT pg_temp.qcheck('inactive-items no order',(SELECT count(*)=0 FROM orders WHERE sps_staged_order_id=pg_temp.qid('inactive-items')));
SELECT pg_temp.make_order('uom-stale-flag');
UPDATE sps_staged_order_lines SET sps_uom='EA' WHERE staged_order_id=pg_temp.qid('uom-stale-flag');
SELECT pg_temp.qdeny('Actual CS EA mismatch with stale match flag denied',$q$SELECT * FROM promote_sps_staged_order(pg_temp.qid('uom-stale-flag'))$q$,'Every incoming line|UOM|matching');
SELECT pg_temp.qcheck('Stale UOM mismatch no order',(SELECT count(*)=0 FROM orders WHERE sps_staged_order_id=pg_temp.qid('uom-stale-flag')));
INSERT INTO integration_item_mappings(id,organization_id,source_trading_partner_id,vendor_item,item_id,food_connex_item_number,sps_uom,food_connex_uom)
VALUES(pg_temp.qid('amb-map'),pg_temp.qid('orga'),'QA-031-PARTNER-a','QA-031-VENDOR-CONFLICT',pg_temp.qid('item2a'),'QA-031-item2-a','CS','CS');
SELECT pg_temp.make_order('real-ambiguity');
UPDATE sps_staged_order_lines SET vendor_item='QA-031-VENDOR-CONFLICT' WHERE staged_order_id=pg_temp.qid('real-ambiguity');
SELECT pg_temp.qdeny('Actual conflicting exact identifiers denied',$q$SELECT * FROM promote_sps_staged_order(pg_temp.qid('real-ambiguity'))$q$,'Ambiguous exact');
SELECT pg_temp.qcheck('Ambiguity created no order',NOT EXISTS(SELECT 1 FROM orders WHERE sps_staged_order_id=pg_temp.qid('real-ambiguity')));
SELECT pg_temp.qcheck('Ambiguity distinct exact targets exist',(SELECT count(distinct item_id)=2 FROM integration_item_mappings WHERE buyer_part_number='QA-031-BUYER-a' OR vendor_item='QA-031-VENDOR-CONFLICT'));
SELECT pg_temp.qdeny('Source identity conflicting insert blocked',$q$INSERT INTO sps_staged_orders(organization_id,external_po,source_document_key,payload_hash,document_type) VALUES(pg_temp.qid('orga'),'QA-031-CONFLICT','QA-031-BASE-a','QA-031-HASH-CONFLICT','850')$q$,'duplicate key value violates unique constraint');
SELECT pg_temp.qcheck('Source conflict original hash and lines intact',(SELECT payload_hash='QA-031-HASH-ORIGINAL' FROM sps_staged_orders WHERE id=pg_temp.qid('basea')) AND (SELECT count(*)=1 FROM sps_staged_order_lines WHERE staged_order_id=pg_temp.qid('basea')));
SELECT pg_temp.qcheck('Source conflict existing exceptions intact',(SELECT count(*)=1 FROM sps_order_exceptions WHERE staged_order_id=pg_temp.qid('basea')));
SELECT pg_temp.qcheck('Cross org staged headers hidden',(SELECT count(*)=0 FROM sps_staged_orders WHERE organization_id=pg_temp.qid('orgb')));
SELECT pg_temp.qcheck('Cross org staged lines hidden',(SELECT count(*)=0 FROM sps_staged_order_lines WHERE organization_id=pg_temp.qid('orgb')));
SELECT pg_temp.qcheck('Cross org exceptions hidden',(SELECT count(*)=0 FROM sps_order_exceptions WHERE organization_id=pg_temp.qid('orgb')));
SELECT pg_temp.qcheck('Cross org mappings hidden',(SELECT count(*)=0 FROM integration_customer_mappings WHERE organization_id=pg_temp.qid('orgb')) AND (SELECT count(*)=0 FROM integration_ship_to_mappings WHERE organization_id=pg_temp.qid('orgb')) AND (SELECT count(*)=0 FROM integration_item_mappings WHERE organization_id=pg_temp.qid('orgb')));
SELECT pg_temp.qzero('Cross org header update affects zero',$q$UPDATE sps_staged_orders SET source_customer_name='QA DENIED' WHERE id=pg_temp.qid('baseb')$q$);
SELECT pg_temp.qzero('Cross org line delete affects zero',$q$DELETE FROM sps_staged_order_lines WHERE id=pg_temp.qid('lineb')$q$);
SELECT pg_temp.qzero('Cross org mapping update affects zero',$q$UPDATE integration_customer_mappings SET source_customer_name='QA DENIED' WHERE id=pg_temp.qid('cmb')$q$);
SELECT pg_temp.qdeny('Cross org insert denied',$q$INSERT INTO sps_staged_orders(organization_id,external_po) VALUES(pg_temp.qid('orgb'),'QA-031-DENIED')$q$,'must belong to your organization|row-level security');
SELECT pg_temp.qdeny('Cross org mapping use denied',$q$UPDATE sps_staged_orders SET customer_mapping_id=pg_temp.qid('cmb') WHERE id=pg_temp.qid('basea')$q$,'foreign key constraint|same organization');
SELECT pg_temp.qdeny('Cross org promotion denied',$q$SELECT * FROM promote_sps_staged_order(pg_temp.qid('baseb'))$q$,'incoming SPS order was not found');
SELECT pg_temp.qdeny('Actor cannot be supplied as helper parameter',$q$SELECT public.lucid_request_actor_id(pg_temp.qid('lucid_admin'))$q$,'does not exist');
SELECT pg_temp.qdeny('Organization cannot be supplied to promotion',$q$SELECT * FROM public.promote_sps_staged_order(pg_temp.qid('basea'),pg_temp.qid('orgb'))$q$,'does not exist');
SELECT pg_temp.qcheck('Promotion audit actor is actual Office',(SELECT actor_id=pg_temp.qid('office') FROM audit_events WHERE action='promoted SPS order to Lucid operational order' AND entity_id=(SELECT operational_order_id::text FROM qa_first)));
SELECT set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{}',true);
SELECT pg_temp.qdeny('No subject actor helper fails closed',$q$SELECT public.lucid_request_actor_id()$q$,'authenticated request actor is required');
SELECT set_config('request.jwt.claim.sub',pg_temp.qid('office')::text,true);
SELECT pg_temp.qcheck('Audit mapping create/change present',(SELECT count(*)>0 FROM audit_events WHERE action='created SPS reconciliation mapping') AND (SELECT count(*)>0 FROM audit_events WHERE action='changed SPS reconciliation mapping'));
SELECT pg_temp.qcheck('Audit exception resolution present',(SELECT count(*)=1 FROM audit_events WHERE action='resolved SPS order exception' AND entity_id=pg_temp.qid('valid-ex')::text));
SELECT pg_temp.qcheck('Audit promotion once',(SELECT count(*)=1 FROM audit_events WHERE action='promoted SPS order to Lucid operational order' AND entity_id=(SELECT operational_order_id::text FROM qa_first)));
SELECT pg_temp.qcheck('Audit excludes payloads/secrets',NOT EXISTS(SELECT 1 FROM audit_events WHERE details::text ~* 'raw_payload|normalized_payload|raw_xml|password|secret|token|QA-031-HASH-ORIGINAL'));

-- NEW parent denial as well as OLD parent escape denial above.
SELECT pg_temp.qdeny('NEW promoted line parent denied',$q$UPDATE sps_staged_order_lines SET staged_order_id=pg_temp.qid('valid850') WHERE id=pg_temp.qid('linea')$q$,'Promoted SPS source documents are immutable');
SELECT pg_temp.qdeny('NEW promoted exception parent denied',$q$UPDATE sps_order_exceptions SET staged_order_id=pg_temp.qid('valid850') WHERE id=pg_temp.qid('exa')$q$,'Promoted SPS source documents are immutable');
SELECT pg_temp.qdeny('Promotion metadata forgery UPDATE denied',$q$UPDATE sps_staged_orders SET review_status='promoted',approved_by=pg_temp.qid('office'),approved_at=now() WHERE id=pg_temp.qid('basea')$q$,'Promotion metadata');
SELECT pg_temp.qdeny('Promotion metadata forgery INSERT denied',$q$INSERT INTO sps_staged_orders(organization_id,external_po,review_status) VALUES(pg_temp.qid('orga'),'QA-031-FORGED','promoted')$q$,'Promotion metadata');
SELECT pg_temp.qdeny('Direct operational order creation denied',$q$INSERT INTO orders(organization_id,external_po,customer) VALUES(pg_temp.qid('orga'),'QA-031-FORGED-ORDER','QA')$q$,'permission denied for table orders');
SELECT pg_temp.qdeny('Direct audit forgery denied',$q$INSERT INTO audit_events(organization_id,actor_id,action,entity_type,entity_id) VALUES(pg_temp.qid('orga'),pg_temp.qid('office'),'QA forged','order','QA-031')$q$,'permission denied for table audit_events');
SELECT pg_temp.make_order('price-review');

-- The source price cannot be rewritten by Office; prepare both source prices as Leadership.
SELECT set_config('request.jwt.claim.sub',pg_temp.qid('leadership')::text,true);
UPDATE sps_staged_order_lines SET sps_purchase_price=10,approved_circle_r_price=11 WHERE staged_order_id=pg_temp.qid('price-review');
INSERT INTO sps_order_exceptions(id,organization_id,staged_order_id,staged_order_line_id,exception_code,severity,message)
VALUES(pg_temp.qid('price-ex'),pg_temp.qid('orga'),pg_temp.qid('price-review'),pg_temp.qid('price-review-line'),'PRICE_MISMATCH','blocking','QA price decision');
SELECT set_config('request.jwt.claim.sub',pg_temp.qid('office')::text,true);
SELECT pg_temp.qdeny('Office direct price finalization denied',$q$UPDATE sps_order_exceptions SET status='resolved',resolution_action='use_sps_price',resolved_by=pg_temp.qid('leadership'),resolved_at=now() WHERE id=pg_temp.qid('price-ex')$q$,'Only leadership or Lucid Admin');
SELECT pg_temp.qdeny('Office price exception deletion denied',$q$DELETE FROM sps_order_exceptions WHERE id=pg_temp.qid('price-ex')$q$,'Only leadership or Lucid Admin');
SELECT pg_temp.qdeny('Office mapping price approval denied',$q$UPDATE integration_item_mappings SET approved_price=12 WHERE id=pg_temp.qid('ima')$q$,'Only leadership or Lucid Admin');
SELECT pg_temp.qdeny('Office approved price removal denied',$q$UPDATE sps_staged_order_lines SET approved_circle_r_price=NULL WHERE staged_order_id=pg_temp.qid('price-review')$q$,'cannot remove an approved price');
SELECT pg_temp.qdeny('Office source price rewrite denied',$q$UPDATE sps_staged_order_lines SET sps_purchase_price=11 WHERE staged_order_id=pg_temp.qid('price-review')$q$,'cannot rewrite the source purchase price');
SELECT pg_temp.qallow('Office may request Leadership review',$q$UPDATE sps_order_exceptions SET details=details||jsonb_build_object('leadership_review_requested_by',pg_temp.qid('office')) WHERE id=pg_temp.qid('price-ex')$q$);
SELECT set_config('request.jwt.claim.sub',pg_temp.qid('leadership')::text,true);
SELECT pg_temp.qallow('Leadership price finalization allowed',$q$UPDATE sps_order_exceptions SET status='resolved',resolution_action='use_sps_price' WHERE id=pg_temp.qid('price-ex')$q$);
SELECT pg_temp.qcheck('Price decision actor is server stamped',(SELECT resolved_by=pg_temp.qid('leadership') AND resolved_at IS NOT NULL FROM sps_order_exceptions WHERE id=pg_temp.qid('price-ex')));
SELECT pg_temp.qallow('Resolved-price promotion allowed',$q$SELECT * FROM promote_sps_staged_order(pg_temp.qid('price-review'))$q$);
SELECT pg_temp.qcheck('Explicit SPS price used',(SELECT unit_price=10 AND price_resolution_action='use_sps_price' FROM order_lines WHERE sps_staged_order_line_id=pg_temp.qid('price-review-line')));
SELECT set_config('request.jwt.claim.sub',pg_temp.qid('production')::text,true);
SELECT pg_temp.qdeny('Production arbitrary order update denied',$q$UPDATE orders SET customer='QA forged' WHERE sps_staged_order_id=pg_temp.qid('valid850')$q$,'permission denied for table orders');
SELECT pg_temp.qallow('Production start through private RPC',$q$SELECT * FROM start_lucid_production((SELECT operational_order_id FROM qa_first))$q$);
SELECT pg_temp.qdeny('Production completion preserves quantity validation',$q$SELECT * FROM complete_lucid_production((SELECT operational_order_id FROM qa_first))$q$,'All ordered quantities');
SELECT pg_temp.qdeny('Non-Admin QA order creation denied',$q$SELECT * FROM create_lucid_qa_order('QA-031-ADMIN-ONLY','QA','QA','QA-031-ITEM','QA synthetic',2,'CS')$q$,'Only Lucid Admin');
SELECT set_config('request.jwt.claim.sub',pg_temp.qid('lucid_admin')::text,true);
CREATE TEMP TABLE qa_admin_order AS SELECT * FROM create_lucid_qa_order('QA-031-ADMIN-ONLY','QA','QA','QA-031-ITEM','QA synthetic',2,'CS');
SELECT pg_temp.qcheck('Admin QA order RPC preserved',(SELECT count(*)=1 FROM orders WHERE external_po='QA-031-ADMIN-ONLY' AND source_system='lucid_qa'));
GRANT SELECT ON qa_first TO postgres;
-- Privileged fixture construction is not the authorization action under test.
RESET ROLE;
INSERT INTO production_lots(id,organization_id,order_id,order_line_id,lot_code,created_by)
SELECT pg_temp.qid('production-lot'),pg_temp.qid('orga'),o.operational_order_id,l.id,'QA-031-PROD',pg_temp.qid('production') FROM qa_first o JOIN order_lines l ON l.order_id=o.operational_order_id;
INSERT INTO production_cases(organization_id,order_id,order_line_id,production_lot_id,case_identifier,quantity,net_weight,uom,produced_by)
SELECT pg_temp.qid('orga'),o.operational_order_id,l.id,pg_temp.qid('production-lot'),'QA-031-CASE',2,20,'CS',pg_temp.qid('production') FROM qa_first o JOIN order_lines l ON l.order_id=o.operational_order_id;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',pg_temp.qid('production')::text,true);
SELECT pg_temp.qallow('Production complete through private RPC',$q$SELECT * FROM complete_lucid_production((SELECT operational_order_id FROM qa_first))$q$);
SELECT pg_temp.qcheck('Production completion persisted',(SELECT status='production_complete' FROM orders WHERE id=(SELECT operational_order_id FROM qa_first)));
RESET ROLE;
DO $$BEGIN EXECUTE format('GRANT USAGE ON SCHEMA %I TO anon',(SELECT nspname FROM pg_namespace WHERE oid=pg_my_temp_schema())); END$$;
GRANT INSERT ON qa_results TO anon;
CREATE TEMP TABLE qa_anon_before AS SELECT pg_temp.q_denial_state() AS state;
SET LOCAL ROLE anon;
SELECT pg_temp.qdeny('anon actor helper denied',$q$SELECT public.lucid_request_actor_id()$q$,'permission denied for function');
SELECT pg_temp.qdeny_state('anon SPS mutation denied',$q$UPDATE sps_staged_orders SET source_customer_name='QA denied'$q$,'42501');
SELECT pg_temp.qdeny('anon promotion denied',$q$SELECT * FROM promote_sps_staged_order(pg_temp.qid('basea'))$q$,'permission denied for function');
RESET ROLE;
SELECT pg_temp.qcheck('Anonymous mutation leaves source orders lines and audit unchanged',(SELECT state=pg_temp.q_denial_state() FROM qa_anon_before));
SELECT pg_temp.qcheck('Unsafe browser privileges absent',NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN (VALUES('anon'),('authenticated')) r(name) CROSS JOIN (VALUES('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) p(privilege) WHERE n.nspname='public' AND c.relkind='r' AND has_table_privilege(r.name,c.oid,p.privilege)));
RESET ROLE;
SELECT pg_temp.qcheck('Private owners lack Auth schema USAGE',NOT has_schema_privilege('lucid_sps_promoter','auth','USAGE') AND NOT has_schema_privilege('lucid_order_operator','auth','USAGE'));
SELECT 'QA031_FAILED_CHECKS='||count(*) FROM qa_results WHERE NOT passed;
SELECT 'QA031_RESULTS='||jsonb_agg(jsonb_build_object('label',label,'passed',passed,'detail',detail) ORDER BY label)::text FROM qa_results;
ROLLBACK;
SELECT 'QA031_ROLLBACK='||jsonb_build_object('organizations',(SELECT count(*) FROM organizations),'profiles',(SELECT count(*) FROM profiles),'auth_users',(SELECT count(*) FROM auth.users),'staged_orders',(SELECT count(*) FROM sps_staged_orders),'staged_lines',(SELECT count(*) FROM sps_staged_order_lines),'exceptions',(SELECT count(*) FROM sps_order_exceptions),'customer_mappings',(SELECT count(*) FROM integration_customer_mappings),'ship_mappings',(SELECT count(*) FROM integration_ship_to_mappings),'item_mappings',(SELECT count(*) FROM integration_item_mappings),'orders',(SELECT count(*) FROM orders),'order_lines',(SELECT count(*) FROM order_lines),'audits',(SELECT count(*) FROM audit_events))::text;
