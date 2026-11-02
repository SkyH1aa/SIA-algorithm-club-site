/* Bounded teaching examples. No game engine, network request or scene ownership. */
((root) => {
  'use strict';
  const vertices = ['A', 'B', 'C', 'D', 'E'];
  const edges = [[0,1,4],[0,2,1],[2,1,2],[1,3,1],[2,3,5],[3,4,3],[2,4,8]];
  const points = [[48,140],[164,58],[164,220],[290,90],[392,200]];
  const clone = value => JSON.parse(JSON.stringify(value));
  function shortestPath() {
    const dist = [0,Infinity,Infinity,Infinity,Infinity], previous = Array(5).fill(null), settled = [];
    const frames = [];
    const snapshot = (key, vars, current = null) => frames.push({key, vars, current, dist: [...dist], previous: [...previous], settled: [...settled]});
    snapshot('distStart', {});
    while (settled.length < vertices.length) {
      const u = vertices.map((_,i) => i).filter(i => !settled.includes(i)).sort((a,b) => dist[a]-dist[b] || a-b)[0];
      if (!Number.isFinite(dist[u])) break;
      settled.push(u);
      const updates = [];
      edges.forEach(([a,b,w]) => {
        const v = a === u ? b : b === u ? a : -1;
        if (v < 0 || settled.includes(v)) return;
        if (dist[u]+w < dist[v]) { dist[v] = dist[u]+w; previous[v] = u; updates.push(`${vertices[v]}=${dist[v]}`); }
      });
      snapshot('distStep', {node: vertices[u], distance: dist[u], updates: updates.join(', ') || '—'}, u);
    }
    const route=[];
    for(let at=4; at!==null; at=previous[at]) route.unshift(vertices[at]);
    snapshot('distDone', {route: route.join(' → '), distance: dist[4]});
    return frames;
  }
  function minimax() {
    // MAX at the root; MIN children. Left-to-right alpha-beta, integer terminal utility.
    const tree = [[3,5],[2,9],[4,6]], visited = [], pruned = [], values = Array(3).fill(null), frames = [];
    let alpha = -Infinity;
    const snapshot = (key, vars, branch = -1, leaf = -1) => frames.push({key, vars, branch, leaf, visited: [...visited], pruned: [...pruned], values: [...values], alpha});
    snapshot('miniStart', {});
    tree.forEach((children,b) => {
      let beta = Infinity;
      for (let l=0; l<children.length; l++) {
        visited.push(b*2+l); beta = Math.min(beta, children[l]); values[b] = beta;
        snapshot('miniVisit', {value: children[l], beta, alpha: Number.isFinite(alpha) ? alpha : '−∞'}, b,l);
        if (beta <= alpha) {
          for (let rest=l+1; rest<children.length; rest++) pruned.push(b*2+rest);
          snapshot('miniPrune', {beta,alpha}, b,l); break;
        }
      }
      alpha = Math.max(alpha,beta);
    });
    snapshot('miniDone', {value:alpha, visited:visited.length, total:6});
    return frames;
  }
  function bfs() {
    const adjacency = [[1,2],[0,3],[0,3,4],[1,2],[2]], queue = [0], seen = [0], order = [], distance = [0,null,null,null,null], frames = [];
    const snapshot = (key,vars,current=null) => frames.push({key,vars,current,queue:[...queue],seen:[...seen],order:[...order],distance:[...distance]});
    snapshot('bfsStart', {});
    while(queue.length) {
      const u=queue.shift(); order.push(u); const added=[];
      adjacency[u].forEach(v=>{ if (!seen.includes(v)) {seen.push(v); queue.push(v); distance[v]=distance[u]+1; added.push(vertices[v]);} });
      snapshot('bfsStep', {node:vertices[u], added:added.join(', ') || '—', queue:queue.map(i=>vertices[i]).join(' → ') || '∅'},u);
    }
    snapshot('bfsDone', {order:order.map(i=>vertices[i]).join(' → ')});
    return frames;
  }
  function correspondence() {
    const links = [[0,1],[0,2],[1,3],[2,3]], matrix = Array.from({length:4},()=>Array(4).fill(0));
    const frames = [{key:'matrixStart',vars:{},matrix:clone(matrix),selected:null,links:[]}];
    links.forEach(([a,b],i)=>{matrix[a][b]=matrix[b][a]=1; frames.push({key:'matrixStep',vars:{a:vertices[a],b:vertices[b]},matrix:clone(matrix),selected:[a,b],links:links.slice(0,i+1)});});
    frames.push({key:'matrixDone',vars:{edges:links.length,entries:matrix.flat().reduce((a,b)=>a+b,0)},matrix:clone(matrix),selected:null,links});
    return frames;
  }
  const engineering = () => ['flowStart','flowLocal','flowRequest','flowCheck','flowRender','flowFallback'].map((key,index)=>({key,vars:{},index}));
  const examples = {ai:shortestPath, systems:engineering, 'ai-lab':minimax, math:correspondence, resources:bfs};
  function createPlayer(length, render, timers = root) {
    let step=0, timer=null, playing=false, disposed=false;
    const stop = () => { if (timer !== null) timers.clearTimeout(timer); timer=null; playing=false; };
    const notify = () => render({step,playing,done:step===length-1});
    const tick = () => { timer=null; if (!playing || disposed) return; step=Math.min(length-1,step+1); if(step===length-1) stop(); notify(); if(playing) timer=timers.setTimeout(tick,1400); };
    return {
      next() {if(disposed) return; stop(); step=Math.min(length-1,step+1); notify();},
      toggle() {if(disposed) return; if(playing) stop(); else {if(step===length-1) step=0; playing=true; timer=timers.setTimeout(tick,1400);} notify();},
      reset() {if(disposed) return; stop(); step=0; notify();},
      pause() {if(disposed) return; stop(); notify();},
      dispose() {stop(); disposed=true;},
      get state() {return {step,playing,done:step===length-1};}
    };
  }
  const dictionaries = {
    zh: {text:'文字推演与输入', edges:'无向边与权重', inputs:'固定叶子效用（从左到右）', unweighted:'无向边（每条边长为 1）', title:'可推演的算法',next:'下一步',play:'播放',pause:'暂停',reset:'重置',step:'步骤 {n} / {total}',complete:'演示完成',demo:'固定小样例 · 本地计算',distance:'最短距离',queue:'队列 · 队首在左',visited:'出队顺序',matrix:'邻接矩阵',source:'数据结构',output:'算法结果',
      distTitle:'最短路径，逐点确定',flowTitle:'从页面到数据，再回到页面',miniTitle:'先比较，再剪去无益分支',matrixTitle:'同一个图，两种表达',bfsTitle:'队列如何展开一层搜索',
      distStart:'从 A 出发。d(A)=0，其余距离为 ∞；边权非负，使用 Dijkstra。',distStep:'确定 {node} 的最短距离 {distance}，松弛相邻边：{updates}。',distDone:'最短路 {route}，总权重 {distance}。所有距离均由边权计算。',
      miniStart:'示意树：根节点取 MAX，下一层取 MIN。按从左到右的顺序搜索；叶子是固定效用值，不是棋力评分。',miniVisit:'读取叶子 {value}：本分支 β={beta}，根节点 α={alpha}。',miniPrune:'β={beta} ≤ α={alpha}，根节点已有不差的选择，剩余叶子无需读取。虚线表示剪枝。',miniDone:'根值为 {value}，读取 {visited}/{total} 个叶子。中间分支保留上界 ≤2，未冒充精确求值。',
      matrixStart:'无向简单图：A—D 为顶点。每加入一条边，同步填写矩阵的两个对称位置。',matrixStep:'加入边 {a}—{b}：M[{a},{b}]=M[{b},{a}]=1。',matrixDone:'{edges} 条无向边对应 {entries} 个非零项；矩阵对称，对角线为 0。',
      bfsStart:'从 A 入队开始，入队时立即标记访问，避免同一顶点重复入队。',bfsStep:'弹出 {node}；新入队：{added}。当前队列：{queue}。',bfsDone:'出队顺序 {order}。B、C 距 A 一条边，D、E 距 A 两条边。',
      flowStart:'这是本站成员展示的代码路径示意，不发送请求，也不代表实时运行状态。',flowLocal:'首帧直接呈现内置成员数据；远程请求独立进行，不阻塞页面。',flowRequest:'浏览器向 club-drive 边缘函数发送 showcase_members_list 请求。',flowCheck:'检查 HTTP 状态、JSON 与成员数组；有效数据才进入字段规范化。',flowRender:'远程成员有效时更新成员展示；名称、方向、头像分别规范化，文字先转义。',flowFallback:'请求失败或列表为空时，保留本地成员数据；这是一条恢复分支，不是额外服务。',
      local:'首帧 · 内置成员数据',request:'club-drive · 成员请求',check:'响应校验与字段规范化',render:'成员 DOM · 安全呈现',fallback:'失败 / 空列表 → 本地数据',bound:'α / β 边界',upper:'上界',unseen:'未读取'},
    en: {text:'Text trace and inputs',edges:'Undirected edges and weights',inputs:'Fixed leaf utilities (left to right)',unweighted:'Undirected edges (unit length)',title:'Algorithms you can trace',next:'Next',play:'Play',pause:'Pause',reset:'Reset',step:'Step {n} / {total}',complete:'Example complete',demo:'Small fixed example · computed locally',distance:'Shortest distance',queue:'Queue · front on the left',visited:'Dequeue order',matrix:'Adjacency matrix',source:'Data structure',output:'Algorithm result',
      distTitle:'A shortest path, settled one vertex at a time',flowTitle:'From the page to its data, and back',miniTitle:'Compare first. Prune what cannot improve.',matrixTitle:'One graph. Two representations.',bfsTitle:'How a queue unfolds a search',
      distStart:'Start at A. d(A)=0; all other distances are ∞. Dijkstra applies because every edge weight is nonnegative.',distStep:'Settle {node} at distance {distance}. Relax adjacent edges: {updates}.',distDone:'Shortest path: {route}; total weight {distance}. Every distance is computed from the edge weights.',
      miniStart:'Illustrative tree: MAX at the root, MIN below. Search left to right. Leaves are fixed utilities, not game-engine evaluations.',miniVisit:'Read leaf {value}: branch β={beta}, root α={alpha}.',miniPrune:'β={beta} ≤ α={alpha}. The root already has an option at least as good. Remaining leaves need not be read; dashed marks indicate pruning.',miniDone:'Root value: {value}; {visited}/{total} leaves read. The middle branch keeps an upper bound ≤2, not a fabricated exact value.',
      matrixStart:'An undirected simple graph on A–D. Each edge writes two symmetric matrix entries.',matrixStep:'Add {a}—{b}: M[{a},{b}]=M[{b},{a}]=1.',matrixDone:'{edges} undirected edges produce {entries} nonzero entries. The matrix is symmetric with a zero diagonal.',
      bfsStart:'Enqueue A. Mark each vertex as soon as it is enqueued, so no vertex enters the queue twice.',bfsStep:'Dequeue {node}; enqueue {added}. Queue now: {queue}.',bfsDone:'Dequeue order: {order}. B and C are one edge from A; D and E are two edges away.',
      flowStart:'A diagram of this site’s member-showcase code path. No requests are sent; this is not live system status.',flowLocal:'Render built-in members immediately. The remote request runs independently and never blocks the first frame.',flowRequest:'The browser sends showcase_members_list to the club-drive edge function.',flowCheck:'Check HTTP status, JSON and the member array. Normalize fields only for valid data.',flowRender:'Valid remote members update the display. Normalize names, directions and avatars; escape text before rendering.',flowFallback:'On a failed request or empty list, keep local members. This is a recovery branch, not another service.',
      local:'First frame · built-in members',request:'club-drive · member request',check:'Validate response / normalize fields',render:'Member DOM · escaped text',fallback:'Failure / empty → local data',bound:'α / β bounds',upper:'upper bound',unseen:'unread'}
  };
  const api = {vertices,edges,shortestPath,minimax,bfs,correspondence,engineering,createPlayer,dictionaries};
  if(typeof module === 'object' && module.exports) module.exports=api;
  if(!root.document) return;
  root.HomeCapabilities = api;
  const host = root.document.querySelector('[data-matrix]');
  if(!host) return;
  const tabs=[...host.querySelectorAll('[role="tab"]')], panel=host.querySelector('[role="tabpanel"]');
  const figure=host.querySelector('[data-cap-figure]'), note=host.querySelector('[data-cap-explanation]'), title=host.querySelector('[data-cap-title]');
  const next=host.querySelector('[data-cap-next]'), play=host.querySelector('[data-cap-play]'), reset=host.querySelector('[data-cap-reset]'), counter=host.querySelector('[data-cap-step]');
  let active='ai', frames=examples.ai(), player, inView=true;
  const reduced=root.matchMedia('(prefers-reduced-motion: reduce)');
  const meta={ai:['capCp','capCpDesc','visualization-lab.html','enterLab','distTitle'],systems:['capWeb','capWebDesc','club-features.html','featuresOverview','flowTitle'],'ai-lab':['capAi','capAiDesc','gomoku.html','startGomoku','miniTitle'],math:['capMath','capMathDesc','graph-lab.html','enterLab','matrixTitle'],resources:['capDoc','capDocDesc','resources.html','enterResources','bfsTitle']};
  const lang=()=>root.ClubI18n?.getLang?.() === 'en' ? 'en':'zh';
  const tr=(key,vars={})=>{
    const id=`homeCapabilities.${key}`, translated=root.ClubI18n?.t?.(id,vars);
    return translated && translated!==id ? translated : dictionaries[lang()][key].replace(/\{(\w+)\}/g,(_,name)=>String(vars[name]??''));
  };
  function register() { root.ClubI18n?.mergeDict?.({zh:{homeCapabilities:dictionaries.zh},en:{homeCapabilities:dictionaries.en}}); }
  const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const text=(x,y,value,cls='')=>`<text x="${x}" y="${y}" class="${cls}" text-anchor="middle">${esc(value)}</text>`;
  const line=(a,b,cls='',label='')=>`<path d="M${a[0]},${a[1]} L${b[0]},${b[1]}" class="cap-edge ${cls}"/>${label!==''?text((a[0]+b[0])/2,(a[1]+b[1])/2-9,label,'cap-weight'):''}`;
  const node=(p,label,cls='',sub='')=>`<g class="cap-node ${cls}"><circle cx="${p[0]}" cy="${p[1]}" r="20"/>${text(p[0],p[1]+5,label)}${sub!==''?text(p[0],p[1]+38,sub,'cap-value'):''}</g>`;
  const svg=(content,view='0 0 440 280')=>`<svg class="cap-figure-svg" viewBox="${view}" aria-hidden="true" focusable="false">${content}</svg>`;
  function graph(frame,breadth=false) {
    const links=breadth?[[0,1],[0,2],[1,3],[2,3],[2,4]]:edges;
    let content=links.map(([a,b,w])=>line(points[a],points[b],!breadth&&frame.previous[b]===a||!breadth&&frame.previous[a]===b?'is-path':'',breadth?'':w)).join('');
    content+=points.map((p,i)=>node(p,vertices[i],frame.current===i?'is-current':(breadth?frame.order:frame.settled).includes(i)?'is-settled':'',breadth?(frame.distance[i]??'—'):(Number.isFinite(frame.dist[i])?frame.dist[i]:'∞'))).join('');
    if(breadth) return svg(content)+`<div class="cap-queue"><span>${tr('queue')}</span><div>${frame.queue.map(i=>`<b>${vertices[i]}</b>`).join('')||'<b>∅</b>'}</div></div><div class="cap-data-line">${tr('visited')}: ${frame.order.map(i=>vertices[i]).join(' → ')||'—'}</div>`;
    return svg(content)+`<div class="cap-distance"><span>${tr('distance')}</span>${vertices.map((v,i)=>`<b>${v}<em>${Number.isFinite(frame.dist[i])?frame.dist[i]:'∞'}</em></b>`).join('')}</div>`;
  }
  function tree(frame) {
    const branchPoints=[[84,105],[220,105],[356,105]], leafPoints=[[48,200],[116,200],[184,200],[256,200],[324,200],[392,200]], utilities=[3,5,2,9,4,6];
    let content=text(220,20,'MAX','cap-role')+node([220,49],frame.key==='miniDone'?frame.alpha:'?','is-current');
    content+=branchPoints.map((p,b)=>line([220,69],p)+node(p,frame.values[b]===null?'MIN':(!frame.visited.includes(b*2+1)?'≤':'')+frame.values[b],frame.branch===b?'is-current':'')+(frame.values[b]===null?'':text(p[0],p[1]+38,'MIN','cap-role'))).join('');
    content+=leafPoints.map((p,i)=>line([branchPoints[Math.floor(i/2)][0],125],p,frame.pruned.includes(i)?'is-pruned':frame.visited.includes(i)?'is-path':'')+node(p,frame.visited.includes(i)?utilities[i]:frame.pruned.includes(i)?'×':'?',frame.pruned.includes(i)?'is-pruned':frame.visited.includes(i)?'is-settled':'')).join('');
    return svg(content)+`<div class="cap-data-line">${tr('bound')}: α=${Number.isFinite(frame.alpha)?frame.alpha:'−∞'} · ${tr('unseen')}: ${6-frame.visited.length-frame.pruned.length}</div>`;
  }
  function matrix(frame) {
    const p=[[55,72],[167,72],[55,206],[167,206]];
    const content=frame.links.map(([a,b])=>line(p[a],p[b],frame.selected?.[0]===a&&frame.selected?.[1]===b?'is-path':'')).join('')+p.map((point,i)=>node(point,vertices[i],frame.selected?.includes(i)?'is-current':'')).join('');
    return `<div class="cap-correspondence">${svg(content,'0 0 220 280')}<table class="cap-table"><caption>${tr('matrix')}</caption><thead><tr><th scope="col">M</th>${vertices.slice(0,4).map(v=>`<th scope="col">${v}</th>`).join('')}</tr></thead><tbody>${frame.matrix.map((row,a)=>`<tr><th scope="row">${vertices[a]}</th>${row.map((v,b)=>`<td class="${frame.selected&&(frame.selected[0]===a&&frame.selected[1]===b||frame.selected[1]===a&&frame.selected[0]===b)?'is-current':v?'is-filled':''}">${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function flow(frame) {
    return `<div class="cap-flow">${['local','request','check','render'].map((key,i)=>`<div class="cap-flow-node ${frame.index===i+1?'is-current':frame.index>i+1?'is-settled':''}"><span class="cap-flow-port" aria-hidden="true"></span><strong>${tr(key)}</strong><code>${['getFallbackMembers()','showcase_members_list','normalizeMemberCard()','renderMembers()'][i]}</code></div>`).join('')}<div class="cap-flow-fallback ${frame.index===5?'is-current':''}">${tr('fallback')}</div></div>`;
  }
  function refresh() {
    register(); const state=player?.state||{step:0,playing:false,done:false}, frame=frames[state.step], selected=tabs.find(tab=>tab.dataset.axis===active), m=meta[active];
    tabs.forEach(tab=>{const on=tab===selected;tab.classList.toggle('is-active',on);tab.setAttribute('aria-selected',String(on));tab.tabIndex=on?0:-1;});
    panel.setAttribute('aria-labelledby',selected.id); host.dataset.activeAxis=active;
    const home=(key,fallback)=>{const id=`home.${key}`,value=root.ClubI18n?.t?.(id);return value&&value!==id?value:fallback;};
    host.querySelector('[data-matrix-title]').textContent=home(m[0],selected.querySelector('strong').textContent);
    host.querySelector('[data-matrix-copy]').textContent=home(m[1],selected.querySelector('small').textContent);
    const link=host.querySelector('[data-matrix-link]'); link.href=`public/${m[2]}`;link.dataset.i18n=`home.${m[3]}`; link.textContent=home(m[3],lang()==='en'?'Explore →':'继续探索 →');
    host.querySelector('.cap-controls').setAttribute('aria-label',tr('title'));
    title.textContent=tr(m[4]); note.textContent=tr(frame.key,frame.vars);
    host.querySelector('[data-cap-text]').textContent=tr('text');
    const input=active==='ai'?`${tr('edges')}: ${edges.map(([a,b,w])=>`${vertices[a]}–${vertices[b]}: ${w}`).join('; ')}`:active==='ai-lab'?`${tr('inputs')}: MIN(3,5), MIN(2,9), MIN(4,6)`:active==='resources'?`${tr('unweighted')}: A–B, A–C, B–D, C–D, C–E`:'';
    host.querySelector('[data-cap-transcript]').innerHTML=(input?`<li>${esc(input)}</li>`:'')+frames.map((f,i)=>`<li${i===state.step?' aria-current="step"':''}>${esc(tr(f.key,f.vars))}</li>`).join('');
    figure.innerHTML=active==='ai'?graph(frame):active==='systems'?flow(frame):active==='ai-lab'?tree(frame):active==='math'?matrix(frame):graph(frame,true);
    host.querySelector('[data-cap-demo]').textContent=tr('demo');
    counter.textContent=tr('step',{n:state.step+1,total:frames.length});
    next.textContent=tr('next');next.disabled=state.done;play.textContent=tr(state.playing?'pause':'play');play.setAttribute('aria-pressed',String(state.playing));reset.textContent=tr('reset');reset.disabled=state.step===0&&!state.playing;
    host.querySelector('[data-matrix-code]').textContent=({ai:'d(v) ← min(d(v), d(u) + w)',systems:'local → request → validate → render','ai-lab':'β ≤ α ⇒ prune',math:'M = Mᵀ · diag(M) = 0',resources:'enqueue → mark → dequeue'})[active];
  }
  function select(axis) {player?.dispose();active=axis;frames=examples[axis]();player=createPlayer(frames.length,refresh);refresh();}
  tabs.forEach((tab,index)=>{tab.addEventListener('click',()=>select(tab.dataset.axis));tab.addEventListener('keydown',event=>{const delta={ArrowDown:1,ArrowRight:1,ArrowUp:-1,ArrowLeft:-1}[event.key];if(delta===undefined&&event.key!=='Home'&&event.key!=='End')return;event.preventDefault();const i=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+delta+tabs.length)%tabs.length;select(tabs[i].dataset.axis);tabs[i].focus();});});
  next.addEventListener('click',()=>player.next());play.addEventListener('click',()=>{if(!root.document.hidden&&inView)player.toggle();});reset.addEventListener('click',()=>player.reset());
  root.addEventListener('club:langchange',refresh);root.document.addEventListener('visibilitychange',()=>{if(root.document.hidden)player.pause();});
  root.addEventListener('pagehide',()=>player.pause());root.addEventListener('blur',()=>player.pause());
  root.addEventListener('club:sceneprogress',event=>{if(event.detail?.section&&event.detail.section!=='capabilities'&&player.state.playing)player.pause();});
  reduced.addEventListener('change',()=>player.pause());
  if(root.IntersectionObserver) new root.IntersectionObserver(entries=>{inView=entries.some(e=>e.isIntersecting);if(!inView)player.pause();},{threshold:0.15}).observe(host);
  select('ai');
  root.setTimeout(refresh,0);
})(typeof window==='object'?window:globalThis);
