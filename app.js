(() => {
  const D = window.BNL_DATA;
  const SUPABASE_URL = 'https://idydqeysvkaihzeiuzzn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_4TN0QUiLezLnxxO_-DQ9-A_AqVBEDWd';
  const SCORE_ENDPOINT = `${SUPABASE_URL}/functions/v1/bnl-score`;
  const tabs = [
    ['overview','Tổng quan'],
    ['schedule','Lịch đấu'],
    ['standings','BXH & giải thưởng'],
    ['players','Vận động viên'],
    ['map','Bản đồ & mô phỏng'],
    ['rules','Điều lệ']
  ];

  const nameMap = Object.fromEntries(D.players.map(p => [p.id,p.short]));
  const fullNameMap = Object.fromEntries(D.players.map(p => [p.id,p.name]));
  const idByName = Object.fromEntries(D.players.map(p => [p.short,p.id]));
  let tab='overview', season='S02', session=0, backendReady=false, activePin='';
  let remoteMatches=[], rallyEvents=[];

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

  const scores = () => Object.fromEntries(
    remoteMatches
      .filter(r=>r.score_a!=null&&r.score_b!=null)
      .map(r=>[r.id,{a:r.score_a,b:r.score_b,status:r.status,updatedAt:r.updated_at}])
  );

  async function loadRemote(){
    try{
      const headers={apikey:SUPABASE_KEY};
      const [mRes,eRes]=await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/bnl_matches?select=id,session_no,match_no,score_a,score_b,status,updated_at&season=eq.S02&order=session_no.asc,match_no.asc`,{headers}),
        fetch(`${SUPABASE_URL}/rest/v1/bnl_rally_events?select=id,match_id,sequence_no,winner_side,event_type,credited_player,created_at,undone_at&order=match_id.asc,sequence_no.asc`,{headers})
      ]);
      if(!mRes.ok||!eRes.ok) throw new Error('backend');
      remoteMatches=await mRes.json();
      rallyEvents=await eRes.json();
      backendReady=true;
    }catch(e){
      console.error(e);
      backendReady=false;
    }
    render();
  }

  function validEvents(matchId){
    return rallyEvents.filter(e=>e.match_id===matchId&&!e.undone_at);
  }

  function currentScore(matchId){
    const m=remoteMatches.find(x=>x.id===matchId);
    return m&&m.score_a!=null?{a:m.score_a,b:m.score_b,status:m.status}:null;
  }

  function standings(){
    const rows=Object.fromEntries(D.players.map(p=>[p.id,{
      player:p.id,played:0,won:0,lost:0,league:0,diff:0,pf:0,pa:0,elo:1000
    }]));
    const completed=schedule
      .map(m=>({m,s:currentScore(m.id)}))
      .filter(x=>x.s&&x.s.status==='completed');

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
      b.league-a.league ||
      b.diff-a.diff ||
      b.pf-a.pf ||
      b.elo-a.elo ||
      fullNameMap[a.player].localeCompare(fullNameMap[b.player])
    );
  }

  function playerStats(){
    const stats=Object.fromEntries(D.players.map(p=>[p.id,{
      player:p.id,direct:0,opponentError:0,unclearTeam:0,totalTeamPoints:0
    }]));
    rallyEvents.filter(e=>!e.undone_at).forEach(e=>{
      const m=schedule.find(x=>x.id===e.match_id); if(!m) return;
      const teamIds=e.winner_side==='A'?m.teamA:m.teamB;
      teamIds.forEach(id=>stats[id].totalTeamPoints++);
      if(e.event_type==='player_point'&&e.credited_player) stats[e.credited_player].direct++;
      if(e.event_type==='opponent_error') teamIds.forEach(id=>stats[id].opponentError++);
      if(e.event_type==='unclear') teamIds.forEach(id=>stats[id].unclearTeam++);
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
    const portraits=D.players.slice(0,5).map((p,i)=>`<div class="portrait" style="transform:translateX(${i*34}px);z-index:${10-i}">${p.image?`<img src="${p.image}" alt="${p.name}">`:`<span>${p.short}</span>`}</div>`).join('');
    const done=remoteMatches.filter(r=>r.status==='completed').length;
    return `<div class="hero"><div class="heroCopy"><div class="eyebrow">SEASON 02 / RISE TOGETHER</div><h1>Cùng lên sân.</h1><p>35 trận · 3 buổi · 7 vận động viên · 20 lượt/người. Chấm điểm từng pha trực tiếp trên điện thoại và đồng bộ chung cho cả đội.</p><div class="heroActions"><button class="primary" data-go="schedule">▣ Vào chấm điểm</button><button class="secondary" data-go="standings">🏆 Mở BXH</button></div></div><div class="heroVisual"><div class="visualStack">${portraits}</div></div></div>
      <div class="statGrid">${stat('35','Trận mùa 02','▣')}${stat('7','Vận động viên','◉')}${stat('20','Lượt / người','↻')}${stat(`${done}/35`,'Đã hoàn tất','✓')}</div>
      <div class="panel twoCols"><div><div class="eyebrow">HỆ XẾP HẠNG</div><h3>3 điểm thắng · 0 điểm thua</h3><p>BXH chính dùng điểm giải. Khi bằng điểm, ưu tiên hiệu số đã giới hạn tối đa ±7 mỗi trận, sau đó điểm ghi. Elo được giữ như chỉ số phụ để phản ánh sức mạnh tương đối.</p></div><div class="sessionBars"><div><span>Buổi 1</span><b>11 trận</b></div><div><span>Buổi 2</span><b>12 trận</b></div><div><span>Buổi 3</span><b>12 trận</b></div><div><span>Dữ liệu</span><b>${backendReady?'Đã đồng bộ':'Đang kết nối'}</b></div></div></div>`;
  }

  function scheduleView(){
    const filtered=schedule.filter(m=>session===0||m.session===session);
    const grouped=session===0
      ? [1,2,3].map(s=>({s,items:filtered.filter(m=>m.session===s)}))
      : [{s:session,items:filtered}];
    return `<div class="sectionHead"><div><div class="eyebrow">LIVE SCORING</div><h2>Lịch đấu Mùa 02</h2><p>Mở đúng buổi đang thi đấu, chọn một trận và chấm từng pha. Tỷ số kết thúc tự động theo luật cầu lông 21 điểm, cách 2, tối đa 30.</p></div><div class="segmented">${[0,1,2,3].map(v=>`<button data-session="${v}" class="${session===v?'active':''}">${v===0?'Tất cả':`Buổi ${v}`}</button>`).join('')}</div></div>
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
    const rows=standings(), ps=playerStats();
    const top=ps[0];
    return `<div class="sectionHead"><div><div class="eyebrow">LEAGUE TABLE</div><h2>BXH & giải thưởng</h2><p>BXH chính: thắng 3 điểm, thua 0. Hiệu số phá hòa được giới hạn ±7 mỗi trận. Elo chỉ là chỉ số phụ.</p></div></div>
      <div class="awardGrid">
        <div class="awardCard"><span>👑</span><div><small>VUA GHI ĐIỂM</small><strong>${top?fullNameMap[top.player]:'—'}</strong><p>${top?top.direct:0} điểm trực tiếp</p></div></div>
        <div class="awardCard"><span>◈</span><div><small>ELO CAO NHẤT</small><strong>${rows[0]?fullNameMap[[...rows].sort((a,b)=>b.elo-a.elo)[0].player]:'—'}</strong><p>${rows.length?Math.round([...rows].sort((a,b)=>b.elo-a.elo)[0].elo):1000}</p></div></div>
      </div>
      <div class="tableWrap"><table><thead><tr><th>#</th><th>VĐV</th><th>Trận</th><th>Thắng</th><th>Thua</th><th>Điểm giải</th><th>HS ±7</th><th>Elo</th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td><span class="rank ${i<3?`rank${i+1}`:''}">${i+1}</span></td><td><b>${fullNameMap[r.player]}</b></td><td>${r.played}</td><td>${r.won}</td><td>${r.lost}</td><td><b>${r.league}</b></td><td class="${r.diff>0?'positive':r.diff<0?'negative':''}">${r.diff>0?'+':''}${r.diff}</td><td>${Math.round(r.elo)}</td></tr>`).join('')}</tbody></table></div>
      <div class="sectionHead sub"><div><div class="eyebrow">INDIVIDUAL SCORING</div><h2>Thống kê ghi điểm cá nhân</h2><p>Chỉ “+1 VĐV” mới cộng điểm trực tiếp cá nhân. “Đối thủ lỗi” và “Chưa rõ” chỉ làm tăng điểm đội.</p></div></div>
      <div class="tableWrap"><table><thead><tr><th>#</th><th>VĐV</th><th>Điểm trực tiếp</th><th>Điểm do đối thủ lỗi*</th><th>Điểm chưa rõ*</th></tr></thead><tbody>${ps.map((r,i)=>`<tr><td>${i+1}</td><td><b>${fullNameMap[r.player]}</b></td><td><b>${r.direct}</b></td><td>${r.opponentError}</td><td>${r.unclearTeam}</td></tr>`).join('')}</tbody></table></div>
      <p class="footNote">* Hai cột này là số pha đội của VĐV được hưởng điểm, không phải điểm ghi cá nhân.</p>`;
  }

  function playersView(){return `<div class="sectionHead"><div><div class="eyebrow">ROSTER</div><h2>7 vận động viên</h2><p>Đội hình chính thức Mùa 02.</p></div></div><div class="playerGrid">${D.players.map((p,i)=>`<article class="playerCard"><div class="playerImage">${p.image?`<img src="${p.image}" alt="${p.name}">`:`<div class="initial">KH</div>`}<span>P${String(i+1).padStart(2,'0')}</span></div><div><h3>${p.name}</h3><p>20 lượt · Mùa 02</p></div></article>`).join('')}</div>`;}

  function mapView(){
    const pairs=new Map();
    schedule.forEach(m=>[m.teamA,m.teamB].forEach(t=>{const k=[...t].sort().join('-');pairs.set(k,(pairs.get(k)||0)+1)}));
    const top=[...pairs.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8);
    return `<div class="sectionHead"><div><div class="eyebrow">PAIRING MAP</div><h2>Bản đồ & mô phỏng</h2><p>Nhìn nhanh tần suất đứng cùng đội trong lịch đã khóa.</p></div></div><div class="panel"><div class="mapTitle"><span>⌘</span><h3>Cặp đồng đội xuất hiện nhiều nhất</h3></div><div class="pairList">${top.map(([k,c])=>{const[a,b]=k.split('-');return `<div><span>${nameMap[a]}–${nameMap[b]}</span><div class="bar"><i style="width:${Math.min(100,c/8*100)}%"></i></div><b>${c}</b></div>`}).join('')}</div></div>`;
  }

  function rulesView(){return `<div class="sectionHead"><div><div class="eyebrow">RULEBOOK</div><h2>Điều lệ vận hành</h2><p>Bản tóm tắt dùng trực tiếp khi tổ chức trận.</p></div></div><div class="rules">
    <div><span>01</span><p>BXH chính dùng 3 điểm cho trận thắng, 0 điểm cho trận thua.</p></div>
    <div><span>02</span><p>Khi bằng điểm giải, xét hiệu số đã giới hạn tối đa ±7 mỗi trận, sau đó điểm ghi.</p></div>
    <div><span>03</span><p>Elo khởi tạo 1000 điểm và chỉ là chỉ số phụ, không quyết định thứ hạng chính.</p></div>
    <div><span>04</span><p>Chấm từng pha: chọn +1 cho người trực tiếp ghi điểm; “Đối thủ lỗi” và “Chưa rõ” chỉ cộng điểm đội.</p></div>
    <div><span>05</span><p>Có thể hoàn tác pha gần nhất. Mọi thao tác được lưu audit log.</p></div>
  </div>`;}

  function seasonOne(){
    if(tab==='standings') return `<div class="sectionHead"><div><div class="eyebrow">HISTORICAL TABLE</div><h2>BXH Mùa 01</h2><p>Dữ liệu lịch sử từ BNL Google Sheet.</p></div></div><div class="tableWrap"><table><thead><tr><th>#</th><th>VĐV</th><th>Trận</th><th>Thắng</th><th>Thua</th><th>Elo</th><th>Hiệu số</th></tr></thead><tbody>${D.season1Standings.map((r,i)=>`<tr><td>${i+1}</td><td><b>${fullNameMap[r.player]}</b></td><td>${r.played}</td><td>${r.won}</td><td>${r.lost}</td><td>${r.elo.toFixed(2)}</td><td>${r.diff>0?'+':''}${r.diff}</td></tr>`).join('')}</tbody></table></div>`;
    return `<div class="hero compact"><div class="heroCopy"><div class="eyebrow">SEASON 01 / ARCHIVE</div><h1>Mùa khai màn.</h1><p>Dữ liệu lịch sử được giữ riêng, không ghi đè Mùa 02.</p><div class="heroActions"><button class="primary" data-go="standings">🏆 Xem BXH Mùa 01</button></div></div></div>`;
  }

  function liveModal(id){
    const m=schedule.find(x=>x.id===id); if(!m)return;
    const s=currentScore(id)||{a:0,b:0,status:'scheduled'};
    const events=validEvents(id);
    const last=events[events.length-1];
    document.getElementById('modalRoot').innerHTML=`<div class="modalBack"><div class="modal liveModal"><button class="close" id="closeModal">×</button>
      <div class="eyebrow">${m.id} · BUỔI ${m.session}</div>
      <div class="liveScore"><div><span>${nameMap[m.teamA[0]]}–${nameMap[m.teamA[1]]}</span><strong>${s.a}</strong></div><small>VS</small><div><span>${nameMap[m.teamB[0]]}–${nameMap[m.teamB[1]]}</span><strong>${s.b}</strong></div></div>
      <div class="liveStatus">${s.status==='completed'?'ĐÃ KẾT THÚC':s.status==='live'?'ĐANG THI ĐẤU':'CHƯA BẮT ĐẦU'}</div>
      <div class="scoringGrid">
        ${scoreSide('A',m.teamA)}
        ${scoreSide('B',m.teamB)}
      </div>
      <div class="liveFooter">
        <button class="secondary" id="undoRally" ${events.length?'':'disabled'}>↶ Hoàn tác pha gần nhất</button>
        ${s.status==='completed'?'<button class="dangerBtn" id="resetMatch">Reset trận</button>':''}
      </div>
      <p class="localNote">${last?`Pha gần nhất: ${eventLabel(last,m)}`:'Chưa có pha nào được ghi nhận.'}</p>
    </div></div>`;

    document.getElementById('closeModal').onclick=closeModal;
    document.querySelector('.modalBack').onclick=e=>{if(e.target.classList.contains('modalBack'))closeModal()};
    document.querySelectorAll('[data-rally]').forEach(b=>b.onclick=()=>handleRally(id,b.dataset.side,b.dataset.type,b.dataset.player||null));
    document.getElementById('undoRally').onclick=()=>handleAction({action:'undo_rally',matchId:id});
    const reset=document.getElementById('resetMatch'); if(reset) reset.onclick=()=>{if(confirm('Reset toàn bộ điểm của trận này?'))handleAction({action:'reset_match',matchId:id})};
  }

  function scoreSide(side,ids){
    return `<section class="scoreSidePanel"><h3>Đội ${side}</h3>
      <button data-rally data-side="${side}" data-type="player_point" data-player="${ids[0]}" class="playerPoint">+1 ${fullNameMap[ids[0]]}</button>
      <button data-rally data-side="${side}" data-type="player_point" data-player="${ids[1]}" class="playerPoint">+1 ${fullNameMap[ids[1]]}</button>
      <button data-rally data-side="${side}" data-type="opponent_error" class="eventBtn">Đối thủ lỗi</button>
      <button data-rally data-side="${side}" data-type="unclear" class="eventBtn">Chưa rõ</button>
    </section>`;
  }

  function eventLabel(e,m){
    const side=e.winner_side;
    if(e.event_type==='player_point') return `+${side} · ${fullNameMap[e.credited_player]} ghi điểm`;
    if(e.event_type==='opponent_error') return `+${side} · đối thủ lỗi`;
    return `+${side} · chưa rõ người ghi điểm`;
  }

  async function ensurePin(){
    if(activePin) return activePin;
    const pin=prompt('Nhập mã chấm điểm:');
    if(!pin) throw new Error('Đã hủy thao tác.');
    activePin=pin;
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
      if(res.status===401) activePin='';
      throw new Error(body.error||'Không thể cập nhật.');
    }
    await loadRemote();
    return body;
  }

  async function handleRally(matchId,side,type,player){
    try{await postAction({action:'rally',matchId,winnerSide:side,eventType:type,creditedPlayer:player});liveModal(matchId);}
    catch(e){alert(e.message);}
  }

  async function handleAction(payload){
    try{await postAction(payload);liveModal(payload.matchId);}
    catch(e){alert(e.message);}
  }

  function closeModal(){document.getElementById('modalRoot').innerHTML='';}

  function bind(){
    document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>{tab=b.dataset.go;render()});
    document.querySelectorAll('[data-session]').forEach(b=>b.onclick=()=>{session=Number(b.dataset.session);render()});
    document.querySelectorAll('[data-live]').forEach(b=>b.onclick=()=>liveModal(b.dataset.live));
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
  loadRemote();
  setInterval(loadRemote,15000);
})();