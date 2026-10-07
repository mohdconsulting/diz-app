// In-memory stand-in for supabase-js (CDN global `supabase`) used by tests/e2e/smoke.py. Seeds one admin: phone "admin1", password "secret1".
(function(){
  const now=Date.now();
  let saved=null; try{ saved=JSON.parse(sessionStorage.getItem('dbs')); }catch(e){}
  const db=saved?saved.db:{users:[{id:'u-admin',phone:'admin1',name:'Chefen',role:'admin',profiles:[],created_at:now}],jobs:[],admin_notes:[]};
  const auth=saved?saved.auth:[{id:'u-admin',email:'diz.admin1@gmail.com',pw:'secret1'}];
  const persist=()=>sessionStorage.setItem('dbs',JSON.stringify({db,auth}));
  let session=null; try{ session=JSON.parse(sessionStorage.getItem('sess')); }catch(e){}
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
      const T=db[table]; const m=T.filter(r=>st.f.every(f=>f(r)));
      if(st.op==='select'){ if(st.maybe) return {data:m[0]||null,error:null}; return {data:m,error:null}; }
      if(st.op==='insert'){ const r={id:'n'+Math.random().toString(16).slice(2),...st.payload}; T.push(r); return {data:st.single?r:[r],error:null}; }
      if(st.op==='upsert'){ const k=table==='admin_notes'?'job_id':'id'; const i=T.findIndex(r=>r[k]===st.payload[k]); if(i>=0) Object.assign(T[i],st.payload); else T.push(st.payload); return {error:null}; }
      if(st.op==='update'){ m.forEach(r=>Object.assign(r,st.payload)); return {data:st.ret?m.map(r=>({id:r.id})):null,error:null}; }
      if(st.op==='delete'){ m.forEach(r=>T.splice(T.indexOf(r),1)); return {error:null}; }
    }
    return q;
  }
  window.__db=db;
  const sbObj={
    from:Q,
    channel(){const c={on(){return c;},subscribe(){return c;}};return c;}, removeChannel(){},
    rpc:async(fn,args)=>{ if(fn==='admin_delete_user'){ const i=db.users.findIndex(u=>u.id===args.uid); if(i>=0) db.users.splice(i,1); return {error:null}; } return {error:{message:'x'}}; },
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
