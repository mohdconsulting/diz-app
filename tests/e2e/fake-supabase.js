// In-memory stand-in for supabase-js (CDN global `supabase`) used by tests/e2e/smoke.py. Seeds one admin: phone "admin1", password "secret1".
(function(){
  const now=Date.now();
  let saved=null; try{ saved=JSON.parse(sessionStorage.getItem('dbs')); }catch(e){}
  const db=saved?saved.db:{users:[{id:'u-admin',phone:'admin1',name:'Chefen',role:'admin',profiles:[],created_at:now}],jobs:[],admin_notes:[],payments:[],provider_locations:[],messages:[],call_signals:[],job_dismissals:[],app_settings:[{key:'payments_mode',value:'mock'}]};
  db.payments=db.payments||[]; db.provider_locations=db.provider_locations||[]; db.messages=db.messages||[]; db.call_signals=db.call_signals||[]; db.job_dismissals=db.job_dismissals||[]; db.app_settings=db.app_settings||[{key:'payments_mode',value:'mock'}];
  const auth=saved?saved.auth:[{id:'u-admin',email:'diz.admin1@gmail.com',pw:'secret1'}];
  const persist=()=>sessionStorage.setItem('dbs',JSON.stringify({db,auth}));
  let session=null; try{ session=JSON.parse(sessionStorage.getItem('sess')); }catch(e){}
  const nowMs=()=>Date.now();
  // emulates the jobs_payment_sync trigger from diz_payments.sql
  function syncPayments(job){
    db.payments.filter(p=>p.job_id===job.id).forEach(p=>{
      if(job.payment_released && p.status==='held'){ p.status='released'; p.released_at=nowMs(); }
      else if(!job.payment_released && job.status==='cancelled' && p.status==='held') p.status='refund_due';
    });
  }
  function Q(table){
    const st={f:[],op:'select',payload:null,single:false,maybe:false,sel:null};
    const q={
      select(c){ if(st.op==='select') st.sel=c; st.ret=true; return q; },
      eq(c,v){ st.f.push(r=>r[c]===v); return q; }, neq(c,v){ st.f.push(r=>r[c]!==v); return q; },
      limit(){return q;}, maybeSingle(){st.maybe=true;return q;}, single(){st.single=true;return q;},
      insert(p){st.op='insert';st.payload=p;return q;}, update(p){st.op='update';st.payload=p;return q;},
      upsert(p){st.op='upsert';st.payload=p;return q;}, delete(){st.op='delete';return q;},
      then(res,rej){ try{const r=run(); persist(); res(r);}catch(e){rej&&rej(e);} }
    };
    function run(){
      const T=db[table]; let m=T.filter(r=>st.f.every(f=>f(r)));
      if(table==='call_signals'&&st.op==='select'){ const u=session&&db.users.find(x=>x.id===session.user.id); m=m.filter(r=>u&&r.to_phone===u.phone&&r.created_at>Date.now()-90000); }
      if(table==='job_dismissals'&&st.op==='select'){ const u=session&&db.users.find(x=>x.id===session.user.id); m=m.filter(r=>u&&r.provider_phone===u.phone); }
      if(table==='messages'&&st.op==='select'){ const u=session&&db.users.find(x=>x.id===session.user.id); m=m.filter(r=>u&&(u.role==='admin'||r.sender_phone===u.phone||r.recipient_phone===u.phone)); }
      if(st.op==='select'){ if(st.maybe) return {data:m[0]||null,error:null}; return {data:m,error:null}; }
      if(st.op==='insert'){ const r={id:'n'+Math.random().toString(16).slice(2),...st.payload}; T.push(r); return {data:st.single?r:[r],error:null}; }
      if(st.op==='upsert'){ const k=table==='admin_notes'?'job_id':'id'; const i=T.findIndex(r=>r[k]===st.payload[k]); if(i>=0) Object.assign(T[i],st.payload); else T.push(st.payload); return {error:null}; }
      if(st.op==='update'){ m.forEach(r=>{ Object.assign(r,st.payload); if(table==='jobs'){ syncPayments(r); if(r.arrived) db.provider_locations=db.provider_locations.filter(x=>x.job_id!==r.id); } }); return {data:st.ret?m.map(r=>({id:r.id})):null,error:null}; }
      if(st.op==='delete'){ m.forEach(r=>T.splice(T.indexOf(r),1)); return {error:null}; }
    }
    return q;
  }
  window.__db=db;
  const sbObj={
    from:Q,
    channel(){const c={on(){return c;},subscribe(){return c;}};return c;}, removeChannel(){},
    rpc:async(fn,args)=>{
      const me=session&&db.users.find(u=>u.id===session.user.id);
      if(fn==='share_location'){
        const j=db.jobs.find(x=>x.id===args.p_job_id); if(!j||!me||j.accepted_by_phone!==me.phone||j.status!=='accepted'||j.arrived) return {error:{message:'forbidden'}};
        db.provider_locations=db.provider_locations.filter(x=>x.job_id!==j.id);
        db.provider_locations.push({job_id:j.id,provider_phone:j.accepted_by_phone,customer_phone:j.owner_phone,lat:args.p_lat,lng:args.p_lng,accuracy:args.p_accuracy,updated_at:Date.now()});
        persist(); return {error:null};
      }
      if(fn==='send_message'){
        const j=db.jobs.find(x=>x.id===args.p_job_id); const b=String(args.p_body||'').trim();
        if(!j||!me||(j.owner_phone!==me.phone&&j.accepted_by_phone!==me.phone)||j.status!=='accepted'||!b||b.length>1000) return {error:{message:'forbidden'}};
        db.messages.push({id:db.messages.length+1,job_id:j.id,sender_phone:me.phone,recipient_phone:me.phone===j.owner_phone?j.accepted_by_phone:j.owner_phone,body:b,created_at:Date.now(),read_at:null});
        persist(); return {data:db.messages.length,error:null};
      }
      if(fn==='send_call_signal'){
        if(args.p_kind==='offer') await new Promise(r=>setTimeout(r,300));   // slow network: unordered sends would let candidates overtake the offer
        const j=db.jobs.find(x=>x.id===args.p_job_id); if(!j||!me||(j.owner_phone!==me.phone&&j.accepted_by_phone!==me.phone)||(args.p_kind!=='end'&&j.status!=='accepted')) return {error:{message:'forbidden'}};
        db.call_signals.push({id:db.call_signals.length+1,job_id:j.id,from_phone:me.phone,to_phone:me.phone===j.owner_phone?j.accepted_by_phone:j.owner_phone,call_id:args.p_call_id,kind:args.p_kind,payload:args.p_payload,created_at:Date.now()});
        persist(); return {error:null};
      }
      if(fn==='dismiss_job'){ const j=db.jobs.find(x=>x.id===args.p_job_id); if(!j||!me||j.status!=='open'||j.owner_phone===me.phone||(j.applicants||[]).some(a=>a.phone===me.phone)) return {error:{message:'job cannot be ignored'}}; if(!db.job_dismissals.some(d=>d.job_id===j.id&&d.provider_phone===me.phone)) db.job_dismissals.push({provider_phone:me.phone,job_id:j.id,created_at:Date.now()}); persist(); return {error:null}; }
      if(fn==='restore_job'){ db.job_dismissals=db.job_dismissals.filter(d=>!(d.job_id===args.p_job_id&&me&&d.provider_phone===me.phone)); persist(); return {error:null}; }
      if(fn==='mark_messages_read'){ db.messages.forEach(m=>{ if(m.job_id===args.p_job_id&&me&&m.recipient_phone===me.phone&&m.read_at==null) m.read_at=Date.now(); }); persist(); return {error:null}; }
      if(fn==='stop_sharing'){ db.provider_locations=db.provider_locations.filter(x=>x.job_id!==args.p_job_id); persist(); return {error:null}; }
      if(fn==='create_payment'){
        const j=db.jobs.find(x=>x.id===args.p_job_id); if(!j||!me||j.owner_phone!==me.phone) return {error:{message:'forbidden'}};
        let prov,amt;
        if(j.status==='accepted'){ prov=j.accepted_by_phone; amt=j.price; }
        else if(j.status==='open'&&args.p_provider_phone){ const ap=(j.applicants||[]).find(x=>x.phone===args.p_provider_phone); if(!ap) return {error:{message:'provider has not applied'}}; prov=ap.phone; amt=ap.price; }
        else return {error:{message:'job is not payable'}};
        let p=db.payments.find(x=>x.job_id===j.id&&['pending','held','released','paid_out'].includes(x.status));
        if(p&&(p.status!=='pending'||(p.provider_phone===prov&&p.amount===amt))) return {data:p,error:null};
        if(p) p.status='failed';
        p={id:'p'+Math.random().toString(16).slice(2),job_id:j.id,customer_phone:j.owner_phone,provider_phone:prov,amount:amt,commission:0,payout_amount:amt,currency:'IQD',psp:'mock',psp_ref:null,checkout_url:null,status:'pending',created_at:nowMs()}; db.payments.push(p);
        persist(); return {data:p,error:null};
      }
      if(fn==='mock_pay'){
        const p=db.payments.find(x=>x.id===args.p_payment_id); if(!p||!me||p.customer_phone!==me.phone) return {error:{message:'forbidden'}};
        if(p.status==='pending'){ p.status=args.p_success?'held':'failed'; if(args.p_success){ p.paid_at=nowMs();
          const j=db.jobs.find(x=>x.id===p.job_id); if(j&&j.status==='open'){ j.status='accepted'; j.accepted_by_phone=p.provider_phone; j.price=p.amount; } } }
        persist(); return {data:p,error:null};
      }
      if(fn==='admin_settle_payment'){
        const p=db.payments.find(x=>x.id===args.p_payment_id); if(!p||!me||me.role!=='admin') return {error:{message:'forbidden'}};
        if(args.p_action==='payout'&&p.status==='released') p.status='paid_out'; else if(args.p_action==='refund'&&p.status==='refund_due') p.status='refunded'; else return {error:{message:'bad state'}};
        persist(); return {data:p,error:null};
      } if(fn==='admin_delete_user'){ const i=db.users.findIndex(u=>u.id===args.uid); if(i>=0) db.users.splice(i,1); return {error:null}; } return {error:{message:'x'}}; },
    auth:{
      async signUp({email,password,options}){
        if(auth.find(a=>a.email===email)) return {data:{},error:{message:'User already registered'}};
        const id='u'+Math.random().toString(16).slice(2); auth.push({id,email,pw:password});
        const m=options.data; db.users.push({id,phone:m.phone,name:m.name,role:m.role==='driver'?'driver':'customer',profiles:m.profiles||[],created_at:Date.now()});
        persist(); session={user:{id}}; sessionStorage.setItem('sess',JSON.stringify(session));
        return {data:{user:{id},session},error:null};
      },
      async signInWithPassword({email,password}){
        const a=auth.find(x=>x.email===email&&x.pw===password); if(!a) return {data:{},error:{message:'Invalid login credentials'}};
        session={user:{id:a.id}}; sessionStorage.setItem('sess',JSON.stringify(session)); return {data:{user:{id:a.id},session},error:null};
      },
      async getSession(){ return {data:{session}}; },
      async signOut(){ session=null; sessionStorage.removeItem('sess'); return {error:null}; }
    }
  };
  window.supabase={createClient(){return sbObj;}};
})();
