(() => {
  const D = window.BNL_DATA;
  const SUPABASE_URL = 'https://idydqeysvkaihzeiuzzn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_4TN0QUiLezLnxxO_-DQ9-A_AqVBEDWd';
  const SCORE_ENDPOINT = `${SUPABASE_URL}/functions/v1/bnl-score`;
  const tabs = [
    ['overview','Tổng quan'],['schedule','Lịch đấu'],['standings','BXH & giải thưởng'],['players','Vận động viên'],['map','Bản đồ & mô phỏng'],['rules','Điều lệ']
  ];
  const nameMap = Object.fromEntries(D.players.map(p => [p.id, p.short]));
  const fullNameMap = Object.fromEntries(D.players.map(p => [p.id, p.name]));
  const idByName = Object.fromEntries(D.players.map(p => [p.short, p.id]));
  let tab = 'overview', season = 'S02', session = 0;
  let scores = {};
  let backendReady = false;

  const schedule = D.scheduleRows.flatMap(([order,...cells]) => cells.flatMap((text,idx) => {
    if (!text) return [];
    const [a,b] = text.split(' vs ');
    const parse = s => s.split('–').map(x => idByName[x]);
    return [{id:`S02-B${idx+1}-M${String(order).padStart(2,'0')}`,session:idx+1,order,teamA:parse(a),teamB:parse(b)}];
  }));

  const team = x => `${nameMap[x[0]]}–${nameMap[x[1]]}`;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));

  async function loadRemoteScores() {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/bnl_matches?select=id,score_a,score_b,status,updated_at&season=eq.S02`, {
        headers: { apikey: SUPABASE_KEY }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = await res.json();
      scores = {};
      rows.forEach(r => {
        if (r.status === 'completed' && r.score_a != null && r.score_b != null) {
          scores[r.id] = { a:r.score_a, b:r.score_b, updatedAt:r.updated_at };
        }
      });
      backendReady = true;
      render();
    } catch (err) {
      console.error('BNL backend unavailable', err);
      backendReady = false;
      render();
    }
  }

  async function submitScore(payload) {
    const res = await fetch(SCORE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type':'application/json',
        apikey: SUPABASE_KEY
      },
      body: JSON.stringify(payload)
    });
    let body = {};
    try { body = await res.json(); } catch {}
    if (!res.ok) throw new Error(body.error || 'Không thể lưu kết quả.');
    await loadRemoteScores();
    return body;
  }

  function renderTabs(){
    const el = document.getElementById('tabs');
    el.innerHTML = tabs.map(([id,label]) => `<button data-tab="${id}" class="${tab===id?'active':''}">${label}</button>`).join('');
    el.querySelectorAll('button').forEach(b => b.onclick = () => {tab=b.dataset.tab; render();});
  }

  function standings(){
    const rows = Object.fromEntries(D.players.map(p => [p.id,{player:p.id,played:0,won:0,lost:0,diff:0,pf:0,pa:0}]));
    schedule.forEach(m => { const s=scores[m.id]; if(!s || s.a===s.b) return; const aWin=s.a>s.b;
      m.teamA.forEach(id=>{const r=rows[id];r.played++;r.won+=aWin?1:0;r.lost+=aWin?0:1;r.diff+=s.a-s.b;r.pf+=s.a;r.pa+=s.b;});
      m.teamB.forEach(id=>{const r=rows[id];r.played++;r.won+=aWin?0:1;r.lost+=aWin?1:0;r.diff+=s.b-s.a;r.pf+=s.b;r.pa+=s.a;});
    });
    return Object.values(rows).sort((a,b)=>b.won-a.won||b.diff-a.diff||b.pf-a.pf||fullNameMap[a.player].localeCompare(fullNameMap[b.player]));
  }

  function overview(){
    const portraits = D.players.slice(0,5).map((p,i)=>`<div class="portrait" style="transform:translateX(${i*34}px);z-index:${10-i}">${p.image?`<img src="${p.image}" alt="${esc(p.name)}">`:`<span>${p.short}</span>`}</div>`).join('');
    return `<div class="hero"><div class="heroCopy"><div class="eyebrow">SEASON 02 / RISE TOGETHER</div><h1>Cùng lên sân.</h1><p>35 trận · 3 buổi · 7 vận động viên · 20 lượt/người. Lịch chính thức đã khóa và sẵn sàng vận hành.</p><div class="heroActions"><button class="primary" data-go="schedule">▣ Xem lịch đấu</button><button class="secondary" data-go="standings">🏆 Mở BXH</button></div></div><div class="heroVisual"><div class="visualStack">${portraits}</div></div></div>
    <div class="statGrid">${stat('35','Trận mùa 02','▣')}${stat('7','Vận động viên','◉')}${stat('20','Lượt / người','↻')}${stat(`${Object.keys(scores).length}/35`,'Đã có kết quả','✓')}</div>
    <div class="panel twoCols"><div><div class="eyebrow">CẤU TRÚC MÙA 02</div><h3>Ba buổi, một bảng xếp hạng.</h3><p>Mỗi vận động viên có đúng 20 lượt thi đấu. Lịch ưu tiên giao thoa đội hình và tránh ghép Hào–Uyên cùng một đội.</p></div><div class="sessionBars"><div><span>Buổi 1</span><b>11 trận</b></div><div><span>Buổi 2</span><b>12 trận</b></div><div><span>Buổi 3</span><b>12 trận</b></div><div><span>Dữ liệu</span><b>${backendReady?'Đã đồng bộ':'Đang kết nối'}</b></div></div></div>`;
  }
  function stat(n,l,i){ return `<div class="stat"><div>${i}</div><strong>${n}</strong><span>${l}</span></div>`; }

  function scheduleView(){
    const filtered = schedule.filter(m => session===0 || m.session===session);
    return `<div class="sectionHead"><div><div class="eyebrow">MASTER SCHEDULE</div><h2>Lịch đấu Mùa 02</h2><p>35 trận chính thức. Chọn buổi để lọc nhanh khi đang ở sân.</p></div><div class="segmented">${[0,1,2,3].map(v=>`<button data-session="${v}" class="${session===v?'active':''}">${v===0?'Tất cả':`Buổi ${v}`}</button>`).join('')}</div></div><div class="matchList">${filtered.map(matchCard).join('')}</div>`;
  }
  function matchCard(m){ const s=scores[m.id]; const aw=s&&s.a>s.b, bw=s&&s.b>s.a; return `<article class="matchCard"><div class="matchMeta"><span>#${String(m.order).padStart(2,'0')}</span><b>BUỔI ${m.session}</b></div><div class="matchTeams"><div class="${aw?'winner':''}"><span>${team(m.teamA)}</span><strong>${s?s.a:'—'}</strong></div><small>VS</small><div class="${bw?'winner':''}"><span>${team(m.teamB)}</span><strong>${s?s.b:'—'}</strong></div></div><div class="matchActions"><button data-score="${m.id}">${s?'Sửa điểm':'Nhập điểm'}</button>${s?`<button class="ghost" data-undo="${m.id}">Hoàn tác</button>`:''}</div></article>`; }

  function standingView(){ const rows=standings(); return `<div class="sectionHead"><div><div class="eyebrow">LIVE TABLE</div><h2>BXH & giải thưởng</h2><p>Xếp theo số trận thắng, sau đó hiệu số và điểm ghi. Kết quả đồng bộ chung cho mọi thiết bị.</p></div></div><div class="tableWrap"><table><thead><tr><th>#</th><th>VĐV</th><th>Trận</th><th>Thắng</th><th>Thua</th><th>Hiệu số</th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td><span class="rank ${i<3?`rank${i+1}`:''}">${i+1}</span></td><td><b>${fullNameMap[r.player]}</b></td><td>${r.played}</td><td>${r.won}</td><td>${r.lost}</td><td class="${r.diff>0?'positive':r.diff<0?'negative':''}">${r.diff>0?'+':''}${r.diff}</td></tr>`).join('')}</tbody></table></div>`; }

  function playersView(){ return `<div class="sectionHead"><div><div class="eyebrow">ROSTER</div><h2>7 vận động viên</h2><p>Đội hình chính thức Mùa 02.</p></div></div><div class="playerGrid">${D.players.map((p,i)=>`<article class="playerCard"><div class="playerImage">${p.image?`<img src="${p.image}" alt="${esc(p.name)}">`:`<div class="initial">KH</div>`}<span>P${String(i+1).padStart(2,'0')}</span></div><div><h3>${p.name}</h3><p>20 lượt · Mùa 02</p></div></article>`).join('')}</div>`; }

  function mapView(){ const pairs=new Map(); schedule.forEach(m=>[m.teamA,m.teamB].forEach(t=>{const k=[...t].sort().join('-');pairs.set(k,(pairs.get(k)||0)+1)})); const top=[...pairs.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8); return `<div class="sectionHead"><div><div class="eyebrow">PAIRING MAP</div><h2>Bản đồ & mô phỏng</h2><p>Nhìn nhanh tần suất đứng cùng đội trong lịch đã khóa.</p></div></div><div class="panel"><div class="mapTitle"><span>⌘</span><h3>Cặp đồng đội xuất hiện nhiều nhất</h3></div><div class="pairList">${top.map(([k,c])=>{const [a,b]=k.split('-');return `<div><span>${nameMap[a]}–${nameMap[b]}</span><div class="bar"><i style="width:${Math.min(100,c/8*100)}%"></i></div><b>${c}</b></div>`}).join('')}</div></div>`; }
  function rulesView(){ return `<div class="sectionHead"><div><div class="eyebrow">RULEBOOK</div><h2>Điều lệ vận hành</h2><p>Bản tóm tắt dùng trực tiếp khi tổ chức trận.</p></div></div><div class="rules">${D.rules.map((r,i)=>`<div><span>${String(i+1).padStart(2,'0')}</span><p>${r}</p></div>`).join('')}</div>`; }
  function seasonOne(){ if(tab==='standings'){return `<div class="sectionHead"><div><div class="eyebrow">HISTORICAL TABLE</div><h2>BXH Mùa 01</h2><p>Dữ liệu đã nhập từ Google Sheet BNL hiện tại.</p></div></div><div class="tableWrap"><table><thead><tr><th>#</th><th>VĐV</th><th>Trận</th><th>Thắng</th><th>Thua</th><th>Elo</th><th>Hiệu số</th></tr></thead><tbody>${D.season1Standings.map((r,i)=>`<tr><td>${i+1}</td><td><b>${fullNameMap[r.player]}</b></td><td>${r.played}</td><td>${r.won}</td><td>${r.lost}</td><td>${r.elo.toFixed(2)}</td><td>${r.diff>0?'+':''}${r.diff}</td></tr>`).join('')}</tbody></table></div>`} return `<div class="hero compact"><div class="heroCopy"><div class="eyebrow">SEASON 01 / ARCHIVE</div><h1>Mùa khai màn.</h1><p>Dữ liệu lịch sử được giữ riêng, không ghi đè lên Mùa 02.</p><div class="heroActions"><button class="primary" data-go="standings">🏆 Xem BXH Mùa 01</button></div></div></div>`; }

  function scoreModal(id){
    const m=schedule.find(x=>x.id===id), old=scores[id]||{a:0,b:0};
    if(!m)return;
    document.getElementById('modalRoot').innerHTML=`<div class="modalBack"><div class="modal"><button class="close" id="closeModal">×</button><div class="eyebrow">${m.id} · BUỔI ${m.session}</div><h2>Nhập kết quả</h2><div class="scoreGrid"><div class="scoreSide"><strong>${team(m.teamA)}</strong><div class="scoreControl"><button data-minus="a">−</button><span id="aScore">${old.a}</span><button data-plus="a">+</button></div></div><div class="versus">VS</div><div class="scoreSide"><strong>${team(m.teamB)}</strong><div class="scoreControl"><button data-minus="b">−</button><span id="bScore">${old.b}</span><button data-plus="b">+</button></div></div></div><label class="pinLabel">Mã nhập điểm<input id="scorePin" placeholder="Nhập mã chung" type="password" autocomplete="one-time-code"></label><p class="error" id="scoreError"></p><button class="primary full" id="saveScore">✓ Xác nhận & lưu</button><p class="localNote">Kết quả được lưu trên hệ thống chung và cập nhật cho mọi thiết bị.</p></div></div>`;
    let a=old.a,b=old.b;
    const sync=()=>{document.getElementById('aScore').textContent=a;document.getElementById('bScore').textContent=b;};
    document.querySelectorAll('[data-plus]').forEach(x=>x.onclick=()=>{x.dataset.plus==='a'?a++:b++;sync()});
    document.querySelectorAll('[data-minus]').forEach(x=>x.onclick=()=>{if(x.dataset.minus==='a')a=Math.max(0,a-1);else b=Math.max(0,b-1);sync()});
    document.getElementById('closeModal').onclick=closeModal;
    document.querySelector('.modalBack').onclick=e=>{if(e.target.classList.contains('modalBack'))closeModal()};
    document.getElementById('saveScore').onclick=async()=>{
      const pin=document.getElementById('scorePin').value;
      const er=document.getElementById('scoreError');
      const btn=document.getElementById('saveScore');
      if(!pin){er.textContent='Vui lòng nhập mã.';return}
      btn.disabled=true; btn.textContent='Đang lưu...'; er.textContent='';
      try{
        await submitScore({action:'save',matchId:id,scoreA:a,scoreB:b,pin});
        closeModal();
      }catch(e){
        er.textContent=e.message || 'Không thể lưu kết quả.';
        btn.disabled=false; btn.textContent='✓ Xác nhận & lưu';
      }
    };
  }

  async function undoScore(id){
    const pin = window.prompt('Nhập mã để hoàn tác kết quả:');
    if(!pin) return;
    try{
      await submitScore({action:'undo',matchId:id,pin});
    }catch(e){
      window.alert(e.message || 'Không thể hoàn tác.');
    }
  }

  function closeModal(){document.getElementById('modalRoot').innerHTML='';}

  function bind(){
    document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>{tab=b.dataset.go;render()});
    document.querySelectorAll('[data-session]').forEach(b=>b.onclick=()=>{session=Number(b.dataset.session);render()});
    document.querySelectorAll('[data-score]').forEach(b=>b.onclick=()=>scoreModal(b.dataset.score));
    document.querySelectorAll('[data-undo]').forEach(b=>b.onclick=()=>undoScore(b.dataset.undo));
  }

  function render(){
    renderTabs();
    document.getElementById('seasonLabel').textContent=season==='S02'?'Mùa 02 · Rise Together':'Mùa 01 · Founding Season';
    document.getElementById('crumbSeason').textContent=season==='S02'?'MÙA 02':'MÙA 01';
    const v=document.getElementById('view');
    if(season==='S01'){v.innerHTML=seasonOne();bind();return;}
    v.innerHTML=tab==='overview'?overview():tab==='schedule'?scheduleView():tab==='standings'?standingView():tab==='players'?playersView():tab==='map'?mapView():rulesView();
    bind();
  }

  document.getElementById('seasonPicker').onclick=()=>{season=season==='S02'?'S01':'S02';tab='overview';render()};
  document.getElementById('brandHome').onclick=()=>{tab='overview';render()};

  render();
  loadRemoteScores();
  setInterval(loadRemoteScores, 30000);
})();