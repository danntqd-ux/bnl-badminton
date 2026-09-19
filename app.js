(() => {
  const D = window.BNL_DATA;
  const SUPABASE_URL = 'https://idydqeysvkaihzeiuzzn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_4TN0QUiLezLnxxO_-DQ9-A_AqVBEDWd';
  const SCORE_ENDPOINT = `${SUPABASE_URL}/functions/v1/bnl-score`;

  const tabs = [
    ['overview','Tổng quan'],
    ['schedule','Lịch đấu'],
    ['standings','BXH'],
    ['map','Phân tích'],
    ['players','Vận động viên'],
    ['rules','Điều lệ']
  ];

  const nameMap = Object.fromEntries(D.players.map(p => [p.id,p.short]));
  const fullNameMap = Object.fromEntries(D.players.map(p => [p.id,p.name]));
  const idByName = Object.fromEntries(D.players.map(p => [p.short,p.id]));

  let tab='overview', season='S02', session=0, backendReady=false, simPlayer='dan', simWins=1;
  let activePin = sessionStorage.getItem('bnl-score-pin') || '';
  let pinValidated = sessionStorage.getItem('bnl-score-pin-ok') === '1';
  let remoteMatches=[], rallyEvents=[];
  const optimisticScores = new Map();
  const optimisticEvents = new Map();
  const queues = new Map();
  const syncState = new Map();

  const schedule = D.scheduleRows.flatMap(([order,...cells]) =>
    cells.flatMap((text,idx)=>{
      if(!text) return [];
      const [a,b]=text.split(' vs ');
      const parse=s=>s.split('–').map(x=>idByName[x]);
      return [{
        id:`S02-B${idx+1}-M${String(order).padStart(2,'0')}`,
        session:idx+1,
        order,
        teamA:parse(a),
        teamB:parse(b)
      }];
    })
  ).sort((a,b)=>a.session-b.session||a.order-b.order);

  async function fetchRemote(renderAfter=true){
    try{
      const headers={apikey:SUPABASE_KEY};
      const [mRes,eRes]=await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/bnl_matches?select=id,session_no,match_no,score_a,score_b,status,updated_at&season=eq.S02&order=session_no.asc,match_no.asc`,{headers,cache:'no-store'}),
        fetch(`${SUPABASE_URL}/rest/v1/bnl_rally_events?select=id,match_id,sequence_no,winner_side,event_type,credited_player,created_at,undone_at&order=match_id.asc,sequence_no.asc`,{headers,cache:'no-store'})
      ]);
      if(!mRes.ok||!eRes.ok) throw new Error('backend');
      remoteMatches=await mRes.json();
      rallyEvents=await eRes.json();
      backendReady=true;
      reconcileOptimistic();
    }catch(e){
      console.error(e);
      backendReady=false;
    }
    if(renderAfter) render();
  }

  function reconcileOptimistic(){
    for(const m of remoteMatches){
      const local = optimisticScores.get(m.id);
      if(!local) continue;
      if((m.score_a??0)===local.a && (m.score_b??0)===local.b){
        optimisticScores.delete(m.id);
      }
    }
    for(const [matchId, events] of optimisticEvents){
      if(!events.length) continue;
      const remoteCount = rallyEvents.filter(e=>e.match_id===matchId && !e.undone_at).length;
      const base = events[0]?.baseCount ?? 0;
      if(remoteCount >= base + events.length) optimisticEvents.delete(matchId);
    }
  }

  function validEvents(matchId){
    const remote = rallyEvents.filter(e=>e.match_id===matchId&&!e.undone_at);
    const opt = optimisticEvents.get(matchId) || [];
    return [...remote, ...opt];
  }

  function currentScore(matchId){
    const local = optimisticScores.get(matchId);
    if(local) return local;
    const m=remoteMatches.find(x=>x.id===matchId);
    return m&&m.score_a!=null?{a:m.score_a,b:m.score_b,status:m.status}:null;
  }

  function calcStatus(a,b){
    if(((a>=21||b>=21)&&Math.abs(a-b)>=2) || Math.max(a,b)===30) return 'completed';
    if(a+b>0) return 'live';
    return 'scheduled';
  }

  function optimisticRally(matchId,side,type,player){
    const current=currentScore(matchId)||{a:0,b:0,status:'scheduled'};
    const next={
      a:current.a+(side==='A'?1:0),
      b:current.b+(side==='B'?1:0)
    };
    next.status=calcStatus(next.a,next.b);
    optimisticScores.set(matchId,next);

    const existing=optimisticEvents.get(matchId)||[];
    const baseCount=rallyEvents.filter(e=>e.match_id===matchId&&!e.undone_at).length;
    existing.push({
      id:`opt-${Date.now()}-${Math.random()}`,
      match_id:matchId,
      winner_side:side,
      event_type:type,
      credited_player:player,
      baseCount,
      created_at:new Date().toISOString()
    });
    optimisticEvents.set(matchId,existing);
    syncState.set(matchId,'syncing');
    refreshLiveBits(matchId);
  }

  function optimisticUndo(matchId){
    const opt=optimisticEvents.get(matchId)||[];
    if(opt.length){
      const ev=opt.pop();
      optimisticEvents.set(matchId,opt);
      const s=currentScore(matchId)||{a:0,b:0,status:'scheduled'};
      const next={a:Math.max(0,s.a-(ev.winner_side==='A'?1:0)),b:Math.max(0,s.b-(ev.winner_side==='B'?1:0))};
      next.status=calcStatus(next.a,next.b);
      optimisticScores.set(matchId,next);
      refreshLiveBits(matchId);
      return {localOnly:true,event:ev};
    }
    return {localOnly:false};
  }

  function enqueue(matchId, task){
    const prev=queues.get(matchId)||Promise.resolve();
    const next=prev.then(task,task).finally(()=>{
      if(queues.get(matchId)===next) queues.delete(matchId);
    });
    queues.set(matchId,next);
    return next;
  }

  async function validatePin(pin){
    const res=await fetch(SCORE_ENDPOINT,{
      method:'POST',
      headers:{'Content-Type':'application/json',apikey:SUPABASE_KEY},
      body:JSON.stringify({action:'validate_pin',pin})
    });
    let body={}; try{body=await res.json()}catch{}
    if(!res.ok) throw new Error(body.error||'Mã chưa đúng.');
    activePin=pin;
    pinValidated=true;
    sessionStorage.setItem('bnl-score-pin',pin);
    sessionStorage.setItem('bnl-score-pin-ok','1');
    return true;
  }

  async function ensurePin(){
    if(activePin&&pinValidated) return activePin;
    const pin=prompt('Nhập mã chấm điểm:');
    if(!pin) throw new Error('Đã hủy thao tác.');
    await validatePin(pin);
    return pin;
  }

  async function postAction(payload){
    const pin=await ensurePin();
    const res=await fetch(SCORE_ENDPOINT,{
      method:'POST',
      headers:{'Content-Type':'application/json',apikey:SUPABASE_KEY},
      body:JSON.stringify({...payload,pin})
    });
    let body={}; try{body=await res.json()}catch{}
    if(!res.ok){
      if(res.status===401){
        activePin=''; pinValidated=false;
        sessionStorage.removeItem('bnl-score-pin');
        sessionStorage.removeItem('bnl-score-pin-ok');
      }
      throw new Error(body.error||'Không thể cập nhật.');
    }
    return body;
  }

  function standings(){
    const rows=Object.fromEntries(D.players.map(p=>[p.id,{
      player:p.id,played:0,won:0,lost:0,league:0,diff:0,pf:0,pa:0,elo:1000
    }]));
    const completed=schedule.map(m=>({m,s:currentScore(m.id)})).filter(x=>x.s&&x.s.status==='completed');

    completed.forEach(({m,s})=>{
      const aWin=s.a>s.b;
      const matchDiff=Math.min(7,Math.abs(s.a-s.b));
      m.teamA.forEach(id=>{
        const r=rows[id]; r.played++; r.won+=aWin?1:0; r.lost+=aWin?0:1; r.league+=aWin?3:0;
        r.diff+=aWin?matchDiff:-matchDiff; r.pf+=s.a; r.pa+=s.b;
      });
      m.teamB.forEach(id=>{
        const r=rows[id]; r.played++; r.won+=aWin?0:1; r.lost+=aWin?1:0; r.league+=aWin?0:3;
        r.diff+=aWin?-matchDiff:matchDiff; r.pf+=s.b; r.pa+=s.a;
      });

      const avgA=(rows[m.teamA[0]].elo+rows[m.teamA[1]].elo)/2;
      const avgB=(rows[m.teamB[0]].elo+rows[m.teamB[1]].elo)/2;
      const expA=1/(1+Math.pow(10,(avgB-avgA)/400));
      const actualA=aWin?1:0;
      const margin=Math.min(1,Math.abs(s.a-s.b)*0.05);
      const delta=20*(actualA-expA)*(1+margin);
      m.teamA.forEach(id=>rows[id].elo+=delta/2);
      m.teamB.forEach(id=>rows[id].elo-=delta/2);
    });

    return Object.values(rows).sort((a,b)=>
      b.league-a.league||b.diff-a.diff||b.pf-a.pf||b.elo-a.elo||
      fullNameMap[a.player].localeCompare(fullNameMap[b.player])
    );
  }

  function playerStats(){
    const stats=Object.fromEntries(D.players.map(p=>[p.id,{
      player:p.id,direct:0,opponentError:0,unclearTeam:0
    }]));
    schedule.forEach(m=>{
      validEvents(m.id).forEach(e=>{
        const teamIds=e.winner_side==='A'?m.teamA:m.teamB;
        if(e.event_type==='player_point'&&e.credited_player) stats[e.credited_player].direct++;
        if(e.event_type==='opponent_error') teamIds.forEach(id=>stats[id].opponentError++);
        if(e.event_type==='unclear') teamIds.forEach(id=>stats[id].unclearTeam++);
      });
    });
    return Object.values(stats).sort((a,b)=>b.direct-a.direct||fullNameMap[a.player].localeCompare(fullNameMap[b.player]));
  }

  function renderTabs(){
    const el=document.getElementById('tabs');
    el.innerHTML=tabs.map(([id,label])=>`<button data-tab="${id}" class="${tab===id?'active':''}">${label}</button>`).join('');
    el.querySelectorAll('button').forEach(b=>b.onclick=()=>{tab=b.dataset.tab;render();});
  }

  function stat(n,l,i){return `<div class="stat"><div>${i}</div><strong>${n}</strong><span>${l}</span></div>`;}

  function overview(){
    const done=remoteMatches.filter(r=>r.status==='completed').length;
    const live=remoteMatches.filter(r=>r.status==='live').length;
    const progress=Math.round(done/35*100);
    const sessionProgress=[1,2,3].map(s=>{
      const total=s===1?11:12;
      const completed=remoteMatches.filter(r=>r.session_no===s&&r.status==='completed').length;
      return {s,total,completed,pct:Math.round(completed/total*100)};
    });
    const visualPlayers=D.players.filter(p=>p.image).slice(0,6);
    const nextMatch=schedule.find(m=>{
      const state=remoteMatches.find(r=>r.id===m.id)?.status;
      return state!=='completed';
    });

    return `<section class="hero heroTeam">
      <div class="heroCopy heroTeamCopy">
        <div class="eyebrow">BNL / SEASON 02 · RISE TOGETHER</div>
        <h1>Cùng lên sân.<br><span>Cùng tạo mùa giải.</span></h1>
        <p class="heroLead">Một mùa giải được tạo nên bởi cả đội — thi đấu, ghi điểm, cạnh tranh và cùng kéo nhau tiến lên qua từng trận.</p>

        <div class="heroMeta">
          <span><b>35</b> trận</span>
          <span><b>3</b> buổi</span>
          <span><b>7</b> VĐV</span>
          <span><b>20</b> lượt/người</span>
        </div>

        <div class="heroActions">
          <button class="primary primaryV2" data-go="schedule"><span>Vào chấm điểm</span><b>→</b></button>
          <button class="secondary secondaryV2" data-go="standings">Xem BXH</button>
        </div>
      </div>

      <div class="teamStage" aria-label="Đội hình BNL Mùa 02">
        <div class="teamAura"></div>
        <div class="seasonStamp"><i></i><span>ONE COURT · ONE TEAM</span></div>
        <div class="teamMontage">
          ${visualPlayers.map((p,i)=>`<figure class="teamMember tm${i+1}"><img src="${p.image}" alt="${p.name}"><figcaption>${p.short}</figcaption></figure>`).join('')}
        </div>
        <div class="teamWordmark">
          <small>BADMINTON NATIONS LEAGUE</small>
          <strong>RISE<br>TOGETHER</strong>
        </div>
      </div>
    </section>

    <section class="overviewStrip">
      <article><small>TIẾN ĐỘ</small><strong>${done}/35</strong><span>trận hoàn tất</span><div class="miniProgress"><i style="width:${progress}%"></i></div></article>
      <article><small>ĐANG DIỄN RA</small><strong>${live}</strong><span>trận live</span></article>
      <article><small>LƯỢT / NGƯỜI</small><strong>20</strong><span>lịch đã cân bằng</span></article>
      <article class="systemCard"><small>HỆ THỐNG</small><strong class="${backendReady?'online':'offline'}">${backendReady?'Online':'Đang nối'}</strong><span>Live scoring sẵn sàng</span></article>
    </section>

    <section class="overviewGrid">
      <article class="dashboardCard quickCard">
        <div class="cardHead"><div><small>ĐIỀU HÀNH GIẢI</small><h3>Vào việc trong một chạm</h3></div><span class="statusDot">${backendReady?'SYNC':'...'}</span></div>
        <div class="quickActions">
          <button data-go="schedule"><span><b>01</b><em>Chấm điểm trận đấu</em></span><i>→</i></button>
          <button data-go="standings"><span><b>02</b><em>Xem BXH & giải thưởng</em></span><i>→</i></button>
          <button data-go="map"><span><b>03</b><em>Phân tích mùa giải</em></span><i>→</i></button>
        </div>
      </article>

      <article class="dashboardCard progressCard">
        <div class="cardHead"><div><small>TIẾN ĐỘ THEO BUỔI</small><h3>Toàn mùa trong một màn hình</h3></div><span>${progress}%</span></div>
        <div class="sessionProgress">
          ${sessionProgress.map(x=>`<div><div class="sessionRow"><span>Buổi ${x.s}</span><b>${x.completed}/${x.total}</b></div><div class="progressTrack"><i style="width:${x.pct}%"></i></div></div>`).join('')}
        </div>
        <div class="nextMatch">
          <small>TRẬN TIẾP THEO</small>
          <strong>${nextMatch?`${nameMap[nextMatch.teamA[0]]}–${nameMap[nextMatch.teamA[1]]} <span>vs</span> ${nameMap[nextMatch.teamB[0]]}–${nameMap[nextMatch.teamB[1]]}`:'Mùa giải đã hoàn tất'}</strong>
          ${nextMatch?`<em>Buổi ${nextMatch.session} · Trận ${String(nextMatch.order).padStart(2,'0')}</em>`:''}
        </div>
      </article>
    </section>`;
  }

  function scheduleView(){
    const filtered=schedule.filter(m=>session===0||m.session===session);
    const grouped=session===0?[1,2,3].map(s=>({s,items:filtered.filter(m=>m.session===s)})):[{s:session,items:filtered}];
    return `<div class="sectionHead"><div><div class="eyebrow">LIVE SCORING</div><h2>Lịch đấu Mùa 02</h2><p>Chạm vào trận để mở bàn điều khiển. Điểm hiển thị tức thì, đồng bộ nền sau đó.</p></div><div class="segmented">${[0,1,2,3].map(v=>`<button data-session="${v}" class="${session===v?'active':''}">${v===0?'Tất cả':`Buổi ${v}`}</button>`).join('')}</div></div>
      ${grouped.map(g=>`<section class="sessionGroup"><div class="sessionTitle"><span>BUỔI ${g.s}</span><b>${g.items.length} trận</b></div><div class="matchList">${g.items.map(matchCard).join('')}</div></section>`).join('')}`;
  }

  function matchCard(m){
    const s=currentScore(m.id);
    const aw=s&&s.a>s.b,bw=s&&s.b>s.a;
    const label=s?.status==='completed'?'Xem / sửa':s?.status==='live'?'Tiếp tục':'Chấm điểm';
    return `<article class="matchCard">
      <div class="matchMeta"><span>#${String(m.order).padStart(2,'0')}</span><b>BUỔI ${m.session}</b></div>
      <div class="matchTeams">
        <div class="${aw?'winner':''}"><span>${nameMap[m.teamA[0]]}–${nameMap[m.teamA[1]]}</span><strong>${s?s.a:'—'}</strong></div>
        <small>VS</small>
        <div class="${bw?'winner':''}"><span>${nameMap[m.teamB[0]]}–${nameMap[m.teamB[1]]}</span><strong>${s?s.b:'—'}</strong></div>
      </div>
      <div class="matchActions"><button data-live="${m.id}">${label}</button></div>
    </article>`;
  }

  function standingsView(){
    const rows=standings(), ps=playerStats(), top=ps[0];
    const eloTop=[...rows].sort((a,b)=>b.elo-a.elo)[0];
    return `<div class="sectionHead"><div><div class="eyebrow">LEAGUE TABLE</div><h2>BXH & giải thưởng</h2><p>BXH chính dùng điểm giải; Elo chỉ là chỉ số phụ.</p></div></div>
      <div class="awardGrid">
        <div class="awardCard"><span>👑</span><div><small>VUA GHI ĐIỂM</small><strong>${top?fullNameMap[top.player]:'—'}</strong><p>${top?top.direct:0} điểm trực tiếp</p></div></div>
        <div class="awardCard"><span>◈</span><div><small>ELO CAO NHẤT</small><strong>${eloTop?fullNameMap[eloTop.player]:'—'}</strong><p>${eloTop?Math.round(eloTop.elo):1000}</p></div></div>
      </div>
      <div class="tableWrap"><table><thead><tr><th>#</th><th>VĐV</th><th>Trận</th><th>Thắng</th><th>Thua</th><th>Điểm giải</th><th>HS ±7</th><th>Elo</th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td><span class="rank ${i<3?`rank${i+1}`:''}">${i+1}</span></td><td><b>${fullNameMap[r.player]}</b></td><td>${r.played}</td><td>${r.won}</td><td>${r.lost}</td><td><b>${r.league}</b></td><td class="${r.diff>0?'positive':r.diff<0?'negative':''}">${r.diff>0?'+':''}${r.diff}</td><td>${Math.round(r.elo)}</td></tr>`).join('')}</tbody></table></div>
      <div class="sectionHead sub"><div><div class="eyebrow">INDIVIDUAL SCORING</div><h2>Thống kê ghi điểm cá nhân</h2><p>Chỉ +1 VĐV mới tính là điểm trực tiếp.</p></div></div>
      <div class="tableWrap"><table><thead><tr><th>#</th><th>VĐV</th><th>Điểm trực tiếp</th><th>Đối thủ lỗi*</th><th>Chưa rõ*</th></tr></thead><tbody>${ps.map((r,i)=>`<tr><td>${i+1}</td><td><b>${fullNameMap[r.player]}</b></td><td><b>${r.direct}</b></td><td>${r.opponentError}</td><td>${r.unclearTeam}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function playersView(){return `<div class="sectionHead"><div><div class="eyebrow">ROSTER</div><h2>7 vận động viên</h2></div></div><div class="playerGrid">${D.players.map((p,i)=>`<article class="playerCard"><div class="playerImage">${p.image?`<img src="${p.image}" alt="${p.name}">`:`<div class="initial">KH</div>`}<span>P${String(i+1).padStart(2,'0')}</span></div><div><h3>${p.name}</h3><p>20 lượt · Mùa 02</p></div></article>`).join('')}</div>`;}

  function analyticsData(){
    const chemistry=new Map();
    const rivalry=new Map();

    const ensureChem=(a,b)=>{
      const key=[a,b].sort().join('|');
      if(!chemistry.has(key)) chemistry.set(key,{key,a:[a,b].sort()[0],b:[a,b].sort()[1],scheduled:0,played:0,wins:0,diff:0});
      return chemistry.get(key);
    };
    const ensureRival=(a,b)=>{
      const key=[a,b].sort().join('|');
      if(!rivalry.has(key)) rivalry.set(key,{key,a:[a,b].sort()[0],b:[a,b].sort()[1],scheduled:0,played:0,wins:{},diff:{}}); 
      const r=rivalry.get(key);
      if(r.wins[a]==null) r.wins[a]=0;
      if(r.wins[b]==null) r.wins[b]=0;
      if(r.diff[a]==null) r.diff[a]=0;
      if(r.diff[b]==null) r.diff[b]=0;
      return r;
    };

    schedule.forEach(m=>{
      [m.teamA,m.teamB].forEach(teamIds=>{
        const c=ensureChem(teamIds[0],teamIds[1]);
        c.scheduled++;
      });

      m.teamA.forEach(a=>m.teamB.forEach(b=>{
        ensureRival(a,b).scheduled++;
      }));

      const s=currentScore(m.id);
      if(!s||s.status!=='completed') return;

      const aWin=s.a>s.b;
      const diff=Math.min(7,Math.abs(s.a-s.b));

      [m.teamA,m.teamB].forEach((teamIds,idx)=>{
        const c=ensureChem(teamIds[0],teamIds[1]);
        c.played++;
        const win=idx===0?aWin:!aWin;
        if(win) c.wins++;
        c.diff+=win?diff:-diff;
      });

      m.teamA.forEach(a=>m.teamB.forEach(b=>{
        const r=ensureRival(a,b);
        r.played++;
        r.wins[a]+=aWin?1:0;
        r.wins[b]+=aWin?0:1;
        r.diff[a]+=aWin?diff:-diff;
        r.diff[b]+=aWin?-diff:diff;
      }));
    });

    const chemistryRows=[...chemistry.values()].map(c=>({
      ...c,
      winRate:c.played?Math.round(c.wins/c.played*100):null
    })).sort((a,b)=>b.scheduled-a.scheduled||b.winRate-a.winRate);

    const rivalryRows=[...rivalry.values()].sort((a,b)=>b.scheduled-a.scheduled||b.played-a.played);

    const balance=D.players.map(p=>{
      const playerMatches=schedule.filter(m=>m.teamA.includes(p.id)||m.teamB.includes(p.id));
      const partners=[];
      const opponents=[];
      const sessions={1:0,2:0,3:0};
      playerMatches.forEach(m=>{
        sessions[m.session]++;
        const own=m.teamA.includes(p.id)?m.teamA:m.teamB;
        const opp=m.teamA.includes(p.id)?m.teamB:m.teamA;
        partners.push(own.find(x=>x!==p.id));
        opponents.push(...opp);
      });
      const counts={};
      partners.forEach(x=>counts[x]=(counts[x]||0)+1);
      const maxPartner=Math.max(...Object.values(counts));
      const maxPartnerId=Object.keys(counts).find(k=>counts[k]===maxPartner);
      return {
        player:p.id,
        matches:playerMatches.length,
        sessions,
        uniquePartners:new Set(partners).size,
        uniqueOpponents:new Set(opponents).size,
        maxPartner,
        maxPartnerId
      };
    });

    return {chemistryRows,rivalryRows,balance};
  }

  function simulatorRows(){
    const base=standings().map(x=>({...x}));
    const target=base.find(x=>x.player===simPlayer);
    if(target){
      target.league+=simWins*3;
      target.won+=simWins;
      target.played+=simWins;
    }
    return base.sort((a,b)=>b.league-a.league||b.diff-a.diff||b.pf-a.pf||b.elo-a.elo||fullNameMap[a.player].localeCompare(fullNameMap[b.player]));
  }

  function mapView(){
    const {chemistryRows,rivalryRows,balance}=analyticsData();
    const topChem=chemistryRows.slice(0,6);
    const topRival=rivalryRows.slice(0,6);
    const simRows=simulatorRows();
    const simRank=Math.max(1,simRows.findIndex(x=>x.player===simPlayer)+1);
    const currentRows=standings();
    const currentRank=Math.max(1,currentRows.findIndex(x=>x.player===simPlayer)+1);
    const currentPts=currentRows.find(x=>x.player===simPlayer)?.league||0;
    const projectedPts=currentPts+simWins*3;

    return `<div class="analysisHero">
      <div><div class="eyebrow">BNL PERFORMANCE LAB</div><h2>Phân tích mùa giải</h2><p>Từ lịch đấu đến dữ liệu thi đấu: nhìn ra cặp phối hợp, đối đầu, độ cân bằng và kịch bản BXH.</p></div>
      <div class="analysisSummary">
        <span><b>${chemistryRows.length}</b><small>cặp đồng đội</small></span>
        <span><b>${rivalryRows.length}</b><small>cặp đối đầu</small></span>
        <span><b>35</b><small>trận được mô hình</small></span>
      </div>
    </div>

    <section class="analysisGrid">
      <article class="analysisCard chemistryCard">
        <div class="analysisHead"><div><small>CHEMISTRY</small><h3>Độ ăn ý đồng đội</h3></div><span>TEAMWORK</span></div>
        <p class="analysisDesc">Tần suất đứng cùng đội + hiệu quả thực tế khi đã có kết quả.</p>
        <div class="chemList">
          ${topChem.map((c,i)=>`<div class="chemRow">
            <div class="chemNames"><b>${nameMap[c.a]}–${nameMap[c.b]}</b><small>${c.scheduled} trận cùng đội</small></div>
            <div class="chemBar"><i style="width:${Math.min(100,c.scheduled/8*100)}%"></i></div>
            <div class="chemMetric"><strong>${c.played?c.winRate+'%':'—'}</strong><small>win rate</small></div>
          </div>`).join('')}
        </div>
      </article>

      <article class="analysisCard rivalryCard">
        <div class="analysisHead"><div><small>RIVALRY</small><h3>Đối đầu đáng chú ý</h3></div><span>HEAD TO HEAD</span></div>
        <p class="analysisDesc">Ai gặp nhau nhiều nhất và cán cân thắng thua đang nghiêng về đâu.</p>
        <div class="rivalList">
          ${topRival.map(r=>{
            const aWin=r.wins[r.a]||0,bWin=r.wins[r.b]||0;
            return `<div class="rivalRow">
              <div class="rivalPair"><b>${nameMap[r.a]}</b><span>vs</span><b>${nameMap[r.b]}</b></div>
              <div class="rivalScore">${r.played?`${aWin}–${bWin}`:'—'}</div>
              <small>${r.scheduled} lần gặp trong lịch</small>
            </div>`;
          }).join('')}
        </div>
      </article>

      <article class="analysisCard balanceCard">
        <div class="analysisHead"><div><small>SCHEDULE BALANCE</small><h3>Cân bằng lịch thi đấu</h3></div><span>35 MATCHES</span></div>
        <p class="analysisDesc">Theo dõi độ đa dạng đồng đội, đối thủ và phân bổ 3 buổi.</p>
        <div class="balanceTable">
          <div class="balanceHeader"><span>VĐV</span><span>Buổi 1/2/3</span><span>Partner</span><span>Opponent</span><span>Cặp lặp nhiều</span></div>
          ${balance.map(b=>`<div class="balanceRow">
            <b>${nameMap[b.player]}</b>
            <span>${b.sessions[1]}/${b.sessions[2]}/${b.sessions[3]}</span>
            <span>${b.uniquePartners}</span>
            <span>${b.uniqueOpponents}</span>
            <span class="${b.maxPartner>=7?'warn':''}">${nameMap[b.maxPartnerId]} · ${b.maxPartner}</span>
          </div>`).join('')}
        </div>
      </article>

      <article class="analysisCard simulatorCard">
        <div class="analysisHead"><div><small>STANDINGS SIMULATOR</small><h3>Nếu thắng các trận tới?</h3></div><span>SCENARIO</span></div>
        <p class="analysisDesc">Mô phỏng nhanh điểm giải và vị trí nếu một VĐV thắng 1–3 trận tiếp theo. Không thay đổi dữ liệu thật.</p>
        <div class="simControls">
          <label>VĐV<select id="simPlayer">${D.players.map(p=>`<option value="${p.id}" ${p.id===simPlayer?'selected':''}>${p.name}</option>`).join('')}</select></label>
          <label>Số trận thắng<select id="simWins">${[1,2,3].map(n=>`<option value="${n}" ${n===simWins?'selected':''}>${n} trận</option>`).join('')}</select></label>
        </div>
        <div class="simResult">
          <div><small>HIỆN TẠI</small><strong>#${currentRank}</strong><span>${currentPts} điểm</span></div>
          <i>→</i>
          <div class="projected"><small>KỊCH BẢN</small><strong>#${simRank}</strong><span>${projectedPts} điểm</span></div>
        </div>
        <div class="simTop">
          ${simRows.slice(0,4).map((r,i)=>`<div class="${r.player===simPlayer?'focus':''}"><span>#${i+1} ${nameMap[r.player]}</span><b>${r.league}đ</b></div>`).join('')}
        </div>
      </article>
    </section>`;
  }

  function rulesView(){return `<div class="sectionHead"><div><div class="eyebrow">RULEBOOK</div><h2>Điều lệ vận hành</h2></div></div><div class="rules">
    <div><span>01</span><p>Thắng 3 điểm, thua 0 điểm.</p></div>
    <div><span>02</span><p>Phá hòa bằng hiệu số tối đa ±7 mỗi trận, sau đó điểm ghi.</p></div>
    <div><span>03</span><p>Elo khởi tạo 1000, chỉ là chỉ số phụ.</p></div>
    <div><span>04</span><p>+1 VĐV = điểm trực tiếp; đối thủ lỗi/chưa rõ chỉ cộng điểm đội.</p></div>
    <div><span>05</span><p>Có thể hoàn tác pha gần nhất; hệ thống lưu audit.</p></div>
  </div>`;}

  function seasonOne(){
    if(tab==='standings') return `<div class="sectionHead"><div><div class="eyebrow">HISTORICAL TABLE</div><h2>BXH Mùa 01</h2></div></div><div class="tableWrap"><table><thead><tr><th>#</th><th>VĐV</th><th>Trận</th><th>Thắng</th><th>Thua</th><th>Elo</th><th>Hiệu số</th></tr></thead><tbody>${D.season1Standings.map((r,i)=>`<tr><td>${i+1}</td><td><b>${fullNameMap[r.player]}</b></td><td>${r.played}</td><td>${r.won}</td><td>${r.lost}</td><td>${r.elo.toFixed(2)}</td><td>${r.diff>0?'+':''}${r.diff}</td></tr>`).join('')}</tbody></table></div>`;
    return `<div class="hero compact"><div class="heroCopy"><div class="eyebrow">SEASON 01 / ARCHIVE</div><h1>Mùa khai màn.</h1></div></div>`;
  }

  function liveModal(id){
    const m=schedule.find(x=>x.id===id); if(!m)return;
    const s=currentScore(id)||{a:0,b:0,status:'scheduled'};
    const events=validEvents(id);
    const last=events[events.length-1];
    const state=syncState.get(id)||'synced';

    document.getElementById('modalRoot').innerHTML=`<div class="modalBack"><div class="modal liveModal scoreArena">
      <div class="arenaTop">
        <div><div class="eyebrow">BUỔI ${m.session} · TRẬN ${String(m.order).padStart(2,'0')}</div><div class="syncPill ${state}" id="syncPill">${state==='syncing'?'Đang đồng bộ':'Đã đồng bộ'}</div></div>
        <button class="close" id="closeModal">×</button>
      </div>

      <div class="scoreBoard">
        <div class="teamScore left">
          <small>ĐỘI A</small>
          <span>${nameMap[m.teamA[0]]} · ${nameMap[m.teamA[1]]}</span>
          <strong id="scoreA">${s.a}</strong>
        </div>
        <div class="scoreCenter"><span>VS</span><b>${s.status==='completed'?'KẾT THÚC':s.status==='live'?'ĐANG ĐẤU':'SẴN SÀNG'}</b></div>
        <div class="teamScore right">
          <small>ĐỘI B</small>
          <span>${nameMap[m.teamB[0]]} · ${nameMap[m.teamB[1]]}</span>
          <strong id="scoreB">${s.b}</strong>
        </div>
      </div>

      <div class="scoringGrid smart">
        ${scoreSide('A',m.teamA)}
        ${scoreSide('B',m.teamB)}
      </div>

      <div class="arenaBottom">
        <button class="undoBig" id="undoRally" ${events.length?'':'disabled'}>↶ Hoàn tác pha gần nhất</button>
        ${s.status==='completed'?'<button class="dangerBtn" id="resetMatch">Reset trận</button>':''}
      </div>

      <div class="lastEvent" id="lastEvent">${last?`Pha gần nhất · ${eventLabel(last)}`:'Chưa có pha nào'}</div>
    </div></div>`;

    document.getElementById('closeModal').onclick=closeModal;
    document.querySelector('.modalBack').onclick=e=>{if(e.target.classList.contains('modalBack'))closeModal()};
    document.querySelectorAll('[data-rally]').forEach(b=>b.onclick=()=>handleRally(id,b.dataset.side,b.dataset.type,b.dataset.player||null,b));
    document.getElementById('undoRally').onclick=()=>handleUndo(id);
    const reset=document.getElementById('resetMatch');
    if(reset) reset.onclick=()=>{if(confirm('Reset toàn bộ điểm của trận này?'))handleReset(id)};
  }

  function scoreSide(side,ids){
    return `<section class="scoreSidePanel smartSide">
      <div class="sideHead"><span>ĐỘI ${side}</span><small>Chạm để +1</small></div>
      <button data-rally data-side="${side}" data-type="player_point" data-player="${ids[0]}" class="playerPoint smartPoint"><span>${fullNameMap[ids[0]]}</span><b>+1</b></button>
      <button data-rally data-side="${side}" data-type="player_point" data-player="${ids[1]}" class="playerPoint smartPoint"><span>${fullNameMap[ids[1]]}</span><b>+1</b></button>
      <div class="secondaryActions">
        <button data-rally data-side="${side}" data-type="opponent_error" class="eventBtn">Đối thủ lỗi</button>
        <button data-rally data-side="${side}" data-type="unclear" class="eventBtn">Chưa rõ</button>
      </div>
    </section>`;
  }

  function eventLabel(e){
    if(e.event_type==='player_point') return `${fullNameMap[e.credited_player]} ghi điểm`;
    if(e.event_type==='opponent_error') return 'Đối thủ lỗi';
    return 'Chưa rõ người ghi điểm';
  }

  function refreshLiveBits(matchId){
    const m=schedule.find(x=>x.id===matchId);
    const s=currentScore(matchId)||{a:0,b:0};
    const a=document.getElementById('scoreA'), b=document.getElementById('scoreB');
    if(a) a.textContent=s.a;
    if(b) b.textContent=s.b;
    const pill=document.getElementById('syncPill');
    if(pill){
      const state=syncState.get(matchId)||'synced';
      pill.className=`syncPill ${state}`;
      pill.textContent=state==='syncing'?'Đang đồng bộ':state==='error'?'Lỗi đồng bộ':'Đã đồng bộ';
    }
    const last=validEvents(matchId).slice(-1)[0];
    const le=document.getElementById('lastEvent');
    if(le) le.textContent=last?`Pha gần nhất · ${eventLabel(last)}`:'Chưa có pha nào';
    const undo=document.getElementById('undoRally');
    if(undo) undo.disabled=validEvents(matchId).length===0;
    if(m) renderMatchCardScore(m);
  }

  function renderMatchCardScore(m){
    const card=[...document.querySelectorAll('[data-live]')].find(b=>b.dataset.live===m.id)?.closest('.matchCard');
    if(!card)return;
    const s=currentScore(m.id);
    const scoresEls=card.querySelectorAll('.matchTeams strong');
    if(scoresEls[0]) scoresEls[0].textContent=s?s.a:'—';
    if(scoresEls[1]) scoresEls[1].textContent=s?s.b:'—';
  }

  async function handleRally(matchId,side,type,player,button){
    try{
      await ensurePin();
      if(button){
        button.classList.add('tapFlash');
        setTimeout(()=>button.classList.remove('tapFlash'),180);
      }
      optimisticRally(matchId,side,type,player);
      enqueue(matchId,async()=>{
        try{
          await postAction({action:'rally',matchId,winnerSide:side,eventType:type,creditedPlayer:player});
          syncState.set(matchId,'synced');
          await fetchRemote(false);
          refreshLiveBits(matchId);
        }catch(e){
          syncState.set(matchId,'error');
          await fetchRemote(false);
          refreshLiveBits(matchId);
          alert(e.message);
        }
      });
    }catch(e){alert(e.message);}
  }

  async function handleUndo(matchId){
    try{
      await ensurePin();
      const local=optimisticUndo(matchId);
      if(local.localOnly){
        refreshLiveBits(matchId);
        return;
      }
      syncState.set(matchId,'syncing');
      refreshLiveBits(matchId);
      enqueue(matchId,async()=>{
        try{
          await postAction({action:'undo_rally',matchId});
          syncState.set(matchId,'synced');
          await fetchRemote(false);
          refreshLiveBits(matchId);
        }catch(e){
          syncState.set(matchId,'error');
          await fetchRemote(false);
          refreshLiveBits(matchId);
          alert(e.message);
        }
      });
    }catch(e){alert(e.message);}
  }

  async function handleReset(matchId){
    try{
      await ensurePin();
      syncState.set(matchId,'syncing');
      await enqueue(matchId,()=>postAction({action:'reset_match',matchId}));
      optimisticScores.delete(matchId);
      optimisticEvents.delete(matchId);
      syncState.set(matchId,'synced');
      await fetchRemote(false);
      liveModal(matchId);
    }catch(e){alert(e.message);}
  }

  function closeModal(){document.getElementById('modalRoot').innerHTML='';}

  function bind(){
    document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>{tab=b.dataset.go;render()});
    document.querySelectorAll('[data-session]').forEach(b=>b.onclick=()=>{session=Number(b.dataset.session);render()});
    document.querySelectorAll('[data-live]').forEach(b=>b.onclick=()=>liveModal(b.dataset.live));
    const simPlayerEl=document.getElementById('simPlayer');
    const simWinsEl=document.getElementById('simWins');
    if(simPlayerEl) simPlayerEl.onchange=()=>{simPlayer=simPlayerEl.value;render();};
    if(simWinsEl) simWinsEl.onchange=()=>{simWins=Number(simWinsEl.value);render();};
  }

  function render(){
    renderTabs();
    document.getElementById('seasonLabel').textContent=season==='S02'?'Mùa 02 · Rise Together':'Mùa 01 · Founding Season';
    document.getElementById('crumbSeason').textContent=season==='S02'?'MÙA 02':'MÙA 01';
    const v=document.getElementById('view');
    if(season==='S01'){v.innerHTML=seasonOne();bind();return;}
    v.innerHTML=tab==='overview'?overview():tab==='schedule'?scheduleView():tab==='standings'?standingsView():tab==='players'?playersView():tab==='map'?mapView():rulesView();
    bind();
  }

  document.getElementById('seasonPicker').onclick=()=>{season=season==='S02'?'S01':'S02';tab='overview';render()};
  document.getElementById('brandHome').onclick=()=>{tab='overview';render()};

  render();
  fetchRemote();
  setInterval(()=>fetchRemote(false),5000);
})();