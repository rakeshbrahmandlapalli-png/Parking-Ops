-- Live check of setup 104 on the real Ops database, run in the SQL editor or the
-- Supabase MCP. Everything happens inside one DO block that ends by raising an
-- error, so the test company, users, bookings, lanes and moves are all rolled
-- back and nothing is kept. The error text is the result line. 22 Oct 2026:
-- every check gave the expected answer and nothing was left behind.
do $t$
declare r text := ''; c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid();
 u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid(); u3 uuid := gen_random_uuid(); u4 uuid := gen_random_uuid();
 sd uuid := gen_random_uuid(); sp uuid := gen_random_uuid(); sd2 uuid := gen_random_uuid();
 p1 uuid := gen_random_uuid(); d1 uuid := gen_random_uuid(); d2 uuid := gen_random_uuid(); d3 uuid := gen_random_uuid(); p4 uuid := gen_random_uuid(); x1 uuid := gen_random_uuid();
 la jsonb; ho jsonb; g jsonb; n int;
begin
 insert into companies(id,name,slug,yards) values (c1,'Lane test (rolled back)','lane-test-'||left(c1::text,8),array['Y','S','T']),(c2,'Lane test 2','lane-test2-'||left(c2::text,8),array['Y','T']);
 insert into auth.users(id) values (u1),(u2),(u3),(u4);
 insert into staff(company_id,user_id,name,role,active) values (c1,u1,'TEST OWNER','owner',true),(c1,u2,'TEST DRIVER','bongo',true),(c1,u3,'TEST VIEW','view',true),(c2,u4,'OTHER OWNER','owner',true);
 insert into sheets(id,company_id,kind,day) values (sd,c1,'drops',current_date),(sp,c1,'picks',current_date),(sd2,c2,'drops',current_date);
 insert into bookings(id,company_id,sheet_id,kind,ref,reg,drop_at,return_at,yard,intake) values
  (p1,c1,sp,'picks','LT1','AA11AAA',now()-interval '2 days',now()+interval '2 days','','Collected'),
  (d1,c1,sd,'drops','LT1','AA11AAA',now()-interval '2 days',now()+interval '2 days','Y',''),
  (d2,c1,sd,'drops','LT2','BB22BBB',now()-interval '2 days',now()+interval '3 days','Y',''),
  (d3,c1,sd,'drops','LT3','CC33CCC',now()-interval '2 days',now()+interval '1 days','Y',''),
  (p4,c1,sp,'picks','LT4','AA11AAA',now()-interval '1 days',now()+interval '5 days','','Collected'),
  (x1,c2,sd2,'drops','OT1','ZZ99ZZZ',now()-interval '2 days',now()+interval '2 days','Y','');
 set local role authenticated;
 perform set_config('request.jwt.claims',json_build_object('sub',u1,'role','authenticated')::text,true);
 g := public.lane_get();
 r := r||' empty='||(jsonb_array_length(g->'lanes')=0 and jsonb_array_length(g->'positions')=0)::text;
 select count(*) into n from jsonb_array_elements(g->'cars') e where e->>'ref'='LT1'; r := r||' pair_one_stay='||(n=1)::text;
 select count(*) into n from jsonb_array_elements(g->'cars') e where e->>'reg'='AA11AAA'; r := r||' repeat_visit_separate='||(n=2)::text;
 r := r||' owner_manage='||(g->>'can_manage');
 la := public.lane_save('Y','Lane A',3,'front','lane'); ho := public.lane_save('Y','Holding',2,'open','holding');
 g := public.lane_move(d2,(la->>'id')::uuid,3,0,0); r := r||' place_d2_pos3=ok';
 g := public.lane_move(d3,(la->>'id')::uuid,2,0,1); r := r||' place_d3_pos2=ok';
 begin perform public.lane_move(p1,(la->>'id')::uuid,2,0,2); r:=r||' occupied=NOT_REFUSED'; exception when others then r:=r||' occupied='||sqlerrm; end;
 begin perform public.lane_move(p1,(la->>'id')::uuid,1,0,1); r:=r||' stale_lane=NOT_REFUSED'; exception when others then r:=r||' stale_lane='||sqlerrm; end;
 begin perform public.lane_move(d2,(ho->>'id')::uuid,1,1,0); r:=r||' blocked_source=NOT_REFUSED'; exception when others then r:=r||' blocked_source='||sqlerrm; end;
 g := public.lane_move(p1,(la->>'id')::uuid,1,0,2); r := r||' place_p1_pos1=ok';
 begin perform public.lane_move(d1,(ho->>'id')::uuid,1,0,0); r:=r||' pair_dup=NOT_REFUSED'; exception when others then r:=r||' pair_dup='||sqlerrm; end;
 select count(*) into n from jsonb_array_elements(g->'positions') e where e->>'booking_id'=p1::text and e->>'moved_by_name'='TEST OWNER'; r:=r||' staff_recorded='||(n=1)::text;
 perform set_config('request.jwt.claims',json_build_object('sub',u2,'role','authenticated')::text,true);
 begin perform public.lane_save('Y','Driver lane',2,'front','lane'); r:=r||' driver_setup=NOT_REFUSED'; exception when others then r:=r||' driver_setup='||sqlerrm; end;
 begin perform public.lane_move(p1,(ho->>'id')::uuid,1,0,0); r:=r||' stale_car=NOT_REFUSED'; exception when others then r:=r||' stale_car='||sqlerrm; end;
 g := public.lane_move(p1,(ho->>'id')::uuid,1,1,0); r := r||' driver_move=ok';
 select count(*) into n from bookings where id in (p1,d1) and yard='Y'; r:=r||' pair_yards_aligned='||(n=2)::text;
 reset role; update bookings set sent_at=now() where id=d3; set local role authenticated;
 g := public.lane_get();
 select count(*) into n from jsonb_array_elements(g->'positions') e where e->>'booking_id'=d3::text and e->>'lane_id' is not null; r:=r||' sent_keeps_slot='||(n=1)::text;
 g := public.lane_move(d3,null,null,1,null); r:=r||' departure=ok';
 select count(*) into n from jsonb_array_elements(g->'moves') e; r:=r||' moves_logged='||n;
 perform set_config('request.jwt.claims',json_build_object('sub',u3,'role','authenticated')::text,true);
 g := public.lane_get(); r:=r||' view_can_move='||(g->>'can_move');
 begin perform public.lane_move(d2,null,null,1,null); r:=r||' view_move=NOT_REFUSED'; exception when others then r:=r||' view_move='||sqlerrm; end;
 perform set_config('request.jwt.claims',json_build_object('sub',u4,'role','authenticated')::text,true);
 g := public.lane_get(); r:=r||' other_co_sees='||jsonb_array_length(g->'lanes')||'/'||jsonb_array_length(g->'positions');
 select count(*) into n from parking_positions; r:=r||' rls_rows='||n;
 begin perform public.lane_move(x1,(la->>'id')::uuid,1,0,4); r:=r||' cross_lane=NOT_REFUSED'; exception when others then r:=r||' cross_lane='||sqlerrm; end;
 begin perform public.lane_move(d2,null,null,1,null); r:=r||' cross_car=NOT_REFUSED'; exception when others then r:=r||' cross_car='||sqlerrm; end;
 begin update parking_lanes set capacity=99; r:=r||' direct_write=NOT_REFUSED'; exception when others then r:=r||' direct_write='||sqlerrm; end;
 perform set_config('request.jwt.claims','',true);
 begin perform public.lane_get(); r:=r||' anon=NOT_REFUSED'; exception when others then r:=r||' anon='||sqlerrm; end;
 raise exception 'ROLLED BACK. %', r;
end $t$;
