'use strict';
const $=id=>document.getElementById(id), el=(tag,cls='',content)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(content!=null)n.textContent=content;return n}, add=(p,...c)=>{p.append(...c.filter(Boolean));return p}, empty=n=>(n.replaceChildren(),n), btn=(label,fn,cls='')=>{const b=el('button',cls,label);b.type='button';b.onclick=fn;return b};
const shapes={library:'M3 4h4v16H3z M10 4h4v16h-4z M16 6l3-1 4 14-3 1z',settings:'M4 7h7m4 0h5M4 17h2m4 0h10 M11 4v6 M7 14v6',flip:'M4 8h14l-3-3m5 11H6l3 3',more:'M4 12h.1m7.9 0h.1m7.9 0h.1',prev:'m14 5-7 7 7 7',next:'m9 5 7 7-7 7',fork:'M7 20V4m0 9c7 0 10-3 10-8m-3 3 3-4 3 4',close:'m5 5 14 14M19 5 5 19',back:'M20 12H4m6-6-6 6 6 6',add:'M12 4v16M4 12h16',play:'m7 4 13 8-13 8z',pause:'M8 5v14m8-14v14',check:'m4 13 5 5L20 6',layers:'m3 8 9-5 9 5-9 5z M3 13l9 5 9-5',arrow:'M4 20 19 5M10 5h9v9',down:'m6 9 6 6 6-6',undo:'m9 4-6 5 6 5M3 9h11c8 0 8 11 0 11',start:'M5 5v14m12-14-7 7 7 7',end:'M19 5v14M7 5l7 7-7 7',note:'M5 3h14v18H5z M8 8h8m-8 4h8m-8 4h5'};
function svg(name){const ns='http://www.w3.org/2000/svg',s=document.createElementNS(ns,'svg'),p=document.createElementNS(ns,'path');s.setAttribute('viewBox','0 0 24 24');s.setAttribute('aria-hidden','true');p.setAttribute('d',shapes[name]);p.setAttribute('stroke','currentColor');p.setAttribute('fill','none');p.setAttribute('stroke-linecap','round');p.setAttribute('stroke-linejoin','round');p.setAttribute('stroke-width',name==='more'?'4':'1.7');s.append(p);return s}
function icon(name,label,fn){const b=btn('',fn,'icon');b.setAttribute('aria-label',label);b.title=label;b.append(svg(name));return b}
function row(label,detail,fn){let b=fn?btn('',fn,'row'):el('div','row');add(b,el('span','',label),detail!=null?el('small','end',detail):null);return b}
function note(t){return el('p','note',t)}
function toast(t){const n=$('toast');n.textContent=t;n.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>n.hidden=true,2600)}
let studyReadFailed=false, unsavedStudy=false;
function saveFailure(reason){
  unsavedStudy=true; const n=$('toast');n.textContent=reason;n.hidden=false;clearTimeout(toast.timer);return false;
}
function read(k,d){
  if(window.Desk?.studyRead && (k==='index'||k==='active'||k.startsWith('study.'))){
    try{const v=JSON.parse(Desk.studyRead(k));if(v&&k.startsWith('study.')){studyJournals.set(v,{rev:v._revision,dirty:new Set});delete v._revision}return v??d}
    catch{studyReadFailed=true;toast('Could not read studies. Reopen before editing.');return d}
  }
  try{return JSON.parse(localStorage.getItem('qb.'+k))??d}catch{return d}
}
function write(k,v){try{localStorage.setItem('qb.'+k,JSON.stringify(v));return true}catch{toast('Not saved: device storage is full');return false}}
let cfg={flip:false,tap:true,arrows:3,trail:0,leela:false,pc:false,pack:'off',lpv:3,spv:3,fpv:3,nodes:1000,backend:'cpu',depth:14,fd:14,privacy:false,tab:'Book',book:'guide',speeds:[],ratings:[],repIds:[],...read('options',{})};
let index=read('index',[]),study=read('study.'+read('active',''),null)||blank(),screen='board',panelGen=0,selected=null,cycle=null,correction=null,gesture=null,promotion=null,engineSeq=0,seq=0,visible=true,modalKey='',pending=new Map,boardRules=null,legal=[],rowsBy={phone:[],pc:[],leela:[]},remoteError='',localError='',timer=0,conn={paired:false,accounts:[]},packs={lite:false,full:false},packBusy='',libMode='Studies',reps={repertoires:[]},editing=null,repNow=null,framesPending=0;
const cur=()=>study.nodes[study.cur], fen=()=>cur().fen, safe=(t,masked='Private')=>cfg.privacy?masked:t;
function save(){
  study.when=Date.now();
  let count=study.next-1;
  if(window.Desk?.studySave){
    if(studyReadFailed)return saveFailure('Study not saved. Reopen to read the stored version.');
    const {nodes,...meta}=study,j=studyJournals.get(study),delta={};
    if(j)for(const id of j.dirty)delta[id]=nodes[id]??null;
    try{
      const result=JSON.parse(Desk.studySave(JSON.stringify(meta),j?.rev||0,JSON.stringify(j?delta:nodes)));
      count=result.n;studyJournals.set(study,{rev:result.rev,dirty:new Set});
    }catch{return saveFailure('Not saved. Keep this board open and export a PGN copy.')}
  }else if(!write('study.'+study.id,study))return false;
  const front={id:study.id,name:study.name,when:study.when,n:count};
  if(index[0]?.id===study.id)index[0]=front;else index=[front,...index.filter(x=>x.id!==study.id)];
  if(unsavedStudy)$('toast').hidden=true;unsavedStudy=false;
  return window.Desk?.studySave?true:write('index',index)&&write('active',study.id);
}
function prefs(){write('options',cfg)}
function task(op,a={}){return new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});if(window.Desk)Desk.task(id,op,JSON.stringify(a));else{pending.delete(id);reject(Error('Android connection required'))}})}
function answer(id,raw,fail){const p=pending.get(id);if(!p)return;pending.delete(id);const v=JSON.parse(raw);if(fail)p.reject(Error(v.error));else p.resolve(v)}
const message=e=>cfg.privacy?'Action unavailable':String(e?.message||e);
function modal(title,fill,k='sheet'){if($('dialog').open)$('dialog').close();modalKey=k;$('dialogtitle').textContent=title;empty($('dialogbody'));fill($('dialogbody'));$('dialog').showModal()}
function hide(){if($('dialog').open)$('dialog').close();modalKey='';promotion=null}
function resetInput(){cycle=correction=selected=gesture=null;clearGhost()}
function dismiss(){if($('dialog').open){hide();return true}if(editing){cancelEditor();return true}if(screen!=='board'){show('board');return true}if(selected){resetInput();paintBoard();return true}return false}
function copy(text){if(window.Desk)Desk.copy(text);else navigator.clipboard?.writeText(text);toast('Copied')}
function field(text,control){return add(el('label','field'),el('span','',text),control)}
function select(values,value,fn){let s=el('select');for(const v of values){let [id,t]=Array.isArray(v)?v:[v,v];let o=el('option','',t);o.value=id;s.append(o)}s.value=value;s.onchange=()=>fn(s.value);return s}
function switching(label,enabled,fn){let r=btn('',fn,'row');r.setAttribute('role','switch');r.setAttribute('aria-checked',enabled);return add(r,el('span','',label),add(el('span','toggle'+(enabled?' on':'')),el('i')))}
function actions(...children){return add(el('div','actions'),...children)}
function section(title,...children){let s=el('section','section');if(title)s.append(el('h3','',title));return add(s,...children)}
function boardPosition(){boardRules=new Chess(fen());legal=boardRules.moves({verbose:true})}
const partNames={p:'pawn',n:'knight',b:'bishop',r:'rook',q:'queen',k:'king'};
function xy(sq){let f=sq.charCodeAt(0)-97,r=+sq[1]-1;return cfg.flip?[7-f,r]:[f,7-r]}
function at(x,y){if(x<0||y<0||x>7||y>7)return null;return String.fromCharCode(97+(cfg.flip?7-x:x))+(cfg.flip?y+1:8-y)}
function under(e){let r=$('board').getBoundingClientRect();return at(Math.floor(8*(e.clientX-r.left)/r.width),Math.floor(8*(e.clientY-r.top)/r.height))}
function img(code){let i=el('img');i.alt='';i.draggable=false;i.src='lib/pieces/'+code+'.svg';return i}
function paintBoard(){
 const squares=empty($('squares')),last=cur().uci,targets=selected&&!editing?legal.filter(m=>m.from===selected).map(m=>m.to):[];
 for(let y=0;y<8;y++)for(let x=0;x<8;x++){let sq=at(x,y),p=editing?editing.map[sq]:boardRules.get(sq),code=p&&(typeof p==='string'?p:p.color+p.type.toUpperCase());let b=btn('',e=>{if(e.detail===0)tap(sq)},'sq'+((x+y)%2?' dark':'')+(code?' piece':'')+(!editing&&last&&(last.slice(0,2)===sq||last.slice(2,4)===sq)?' last':'')+(sq===selected?' sel':'')+(targets.includes(sq)?' legal':''));b.dataset.sq=sq;b.setAttribute('aria-label',sq+(code?' '+(code[0]==='w'?'white ':'black ')+partNames[code[1].toLowerCase()]:''));if(code)b.append(img(code));if(x===0)b.append(el('i','rank',sq[1]));if(y===7)b.append(el('i','file',sq[0]));squares.append(b)}
 const black=editing?editing.turn==='b':boardRules.turn()==='b';$('turn').className=black?'black':'';$('turn').textContent=editing?'Set position':(!legal.length?(boardRules.isCheck()?'Checkmate':'Stalemate'):(black?'Black':'White')+' to move'+(boardRules.isCheck()?' · check':''));
 paintArrows()
}
function activeRows(){return (cfg.leela&&rowsBy.leela.length)?rowsBy.leela:(cfg.pc&&rowsBy.pc.length)?rowsBy.pc:(cfg.pack!=='off'?rowsBy.phone:[])}
let leelaMoveStats=[];
function currentPlan(){const rows=activeRows();return editing?[]:arrowPlan(rows,{limit:cfg.arrows,trail:cfg.trail,leela:rows===rowsBy.leela,stats:leelaMoveStats,side:boardRules.turn(),legal:new Set(legal.map(uci))})}
function arrows(){return currentPlan().filter(s=>s.root).map(s=>s.u)}
function arrow(a,b,kind,w){const [x1,y1]=xy(a),[x2,y2]=xy(b),dx=x2-x1,dy=y2-y1,l=Math.hypot(dx,dy);if(!l)return;const ux=dx/l,uy=dy/l,px=-uy,py=ux,start=[x1*10+5+ux*2,y1*10+5+uy*2],end=[x2*10+5-ux*1.25,y2*10+5-uy*1.25];let to=(s,d)=>[end[0]-ux*s+px*d,end[1]-uy*s+py*d].join(','),from=d=>[start[0]+px*d,start[1]+py*d].join(',');let p=document.createElementNS('http://www.w3.org/2000/svg','polygon');p.setAttribute('points',[from(w),to(3,w),to(3,2*w+.35),to(0,0),to(3,-2*w-.35),to(3,-w),from(-w)].join(' '));p.setAttribute('fill',kind===0?'#216a52':kind===1?'#556c9d':'#a35b3b');p.setAttribute('opacity',kind===0?'.82':'.62');$('ink').append(p)}
function paintArrows(){empty($('ink'));for(const s of currentPlan().reverse())arrow(s.u.slice(0,2),s.u.slice(2,4),s.kind,s.w)}
function clearGhost(){if(!$('ghost'))return;$('ghost').style.display='none';$('squares').querySelector('.lift')?.classList.remove('lift')}
function tap(sq){if(!sq)return;if(editing){editTap(sq);return}const own=boardRules.get(sq)?.color===boardRules.turn();
 if(selected&&selected!==sq&&legal.some(m=>m.from===selected&&m.to===sq)){choose(selected,sq);return}
 if(own){cycle=correction=null;selected=selected===sq?null:sq;paintBoard();return}selected=null;
 if(cfg.tap||arrows().some(u=>u.slice(2,4)===sq)){const p=path(study).slice(-2).map(n=>obj(n.uci)),rank=InstinctaClickChess.ranker.rank(fen(),legal,sq,p);if(rank.length){const hint=arrows().find(u=>u.slice(2,4)===sq);if(hint){const i=rank.findIndex(r=>r.from===hint.slice(0,2));if(i>0)rank.unshift(rank.splice(i,1)[0])}const continuing=cycle?.fen===fen()&&cycle.to===sq,origins=continuing?cycle.origins:rank.map(r=>r.from),at=continuing?cycle.i%origins.length:0;choose(origins[at],sq,{fen:fen(),to:sq,i:at+1,origins});return}}
 resetInput();paintBoard()}
function choose(from,to,guess=null){let list=legal.filter(m=>m.from===from&&m.to===to);if(!list.length)return;if(list.some(m=>m.promotion)){promotion={from,to,guess};modal('Promote to',p=>{for(const type of ['q','r','b','n'])p.append(row(partNames[type][0].toUpperCase()+partNames[type].slice(1),'',()=>{hide();play(from+to+type,guess)}))},'promotion');return}play(from+to,guess)}
function nextData(u){const r={};for(const name of ['phone','pc','leela'])r[name]=rowsBy[name].filter(x=>x.pv[0]===u&&x.pv.length>1).map(x=>({...x,pv:x.pv.slice(1),san:(x.san||[]).slice(1),inherited:true})).slice(0,1);return r}
function play(u,guess=null){const parent=study.cur,pre=nextData(u),was=cur().kids.find(id=>study.nodes[id].uci===u);try{append(study,obj(u));resetInput();if(guess)correction={parent,child:study.cur,created:was==null,from:u.slice(0,2),to:u.slice(2,4),next:guess};changed(pre)}catch(e){toast(message(e))}}
function undoGuess(){if(!correction||correction.child!==study.cur)return;let c=correction;study.cur=c.parent;if(c.created&&!study.nodes[c.child].kids.length)prune(study,c.child);resetInput();cycle=c.next;changed()}
function nav(id){if(id==null||!study.nodes[id])return;let pre=study.nodes[id].p===study.cur?nextData(study.nodes[id].uci):null;resetInput();study.cur=id;changed(pre)}
function changed(pre=null){save();boardPosition();paintBoard();transport();renderPanel();schedule(pre);refreshCoverage()}
function switchStudy(s){if(!s || (unsavedStudy && !save()))return;stopEngines();editing=null;resetInput();study=s;save();show('board')}
function transport(){const t=empty($('transport')),n=cur(),title=n.id?moveLabel(n):'Starting position';
 let pos=btn('',()=>positionMenu(),'position');add(pos,el('span','',title),svg('down'));t.append(pos);
 let i=icon('fork','Return to intersection',returnIntersection);i.disabled=!cur().id||(!selectedReps().length&&!path(study).some(n=>study.nodes[n.p].kids[0]!==n.id));t.append(i);
 for(const [dir,label,step] of [['prev','Previous move',()=>cur().p],['next','Next main-line move',()=>cur().kids[0]]]){const b=icon(dir,label,()=>nav(step()));b.disabled=step()==null;b.onpointerdown=e=>{if(e.button!==0||b.disabled)return;let repeat;const timer=setTimeout(()=>{repeat=setInterval(()=>{const id=step();if(id!=null)nav(id)},145)},360);const stop=()=>{clearTimeout(timer);clearInterval(repeat);window.removeEventListener('pointerup',stop,true);window.removeEventListener('pointercancel',stop,true)};window.addEventListener('pointerup',stop,true);window.addEventListener('pointercancel',stop,true)};t.append(b)}}
function moveLabel(n){if(!n.id)return 'Start';let f=study.nodes[n.p].fen.split(' ');return f[5]+(f[1]==='w'?'. ':'… ')+n.san}
function positionMenu(){modal('Position',p=>{p.append(row('Starting position','',()=>{hide();nav(0)}),row('End of main line','',()=>{let id=0;while(study.nodes[id].kids.length)id=study.nodes[id].kids[0];hide();nav(id)}));if(study.returnTo)p.append(row('Return to saved board','',()=>{const s=read('study.'+study.returnTo);if(s){hide();switchStudy(s)}}));if(study.cur)p.append(row('Edit variation',moveLabel(cur()),()=>variation(study.cur)));p.append(row('Copy FEN','',()=>{copy(fen());hide()}),row('Set up position','',()=>{hide();startEditor()}),row('New study','',()=>{hide();switchStudy(blank())}),row('Import PGN or FEN','',()=>importDialog()))})}
function variation(id){const n=study.nodes[id],parent=study.nodes[n.p];modal(moveLabel(n),p=>{for(const sid of parent.kids)p.append(row(moveLabel(study.nodes[sid]),sid===parent.kids[0]?'Main line':'Variation',()=>{hide();nav(sid)}));if(parent.kids[0]!==id)p.append(row('Make main line','',()=>{motion(study,id);hide();changed()}));p.append(row('Delete this branch','',()=>modal('Delete branch?',q=>add(q,note('This removes '+n.san+' and its continuations.'),actions(btn('Keep',hide,'secondary'),btn('Delete',()=>{prune(study,id);hide();changed()},'primary'))))))})}
function notation(p){let ids=path(study).map(n=>n.id);let id=study.cur;while(study.nodes[id].kids.length){id=study.nodes[id].kids[0];ids.push(id)}
 const bar=add(el('div','row'),el('strong','',safe(study.name,'Study')),btn('PGN',()=>exportDialog(),'chip'));p.append(bar);
 if(!ids.length){p.append(note('No moves yet.'));return}const wrap=el('div','notation');for(const i of ids){let n=study.nodes[i],par=study.nodes[n.p],f=par.fen.split(' ');if(f[1]==='w'||i===ids[0])wrap.append(el('span','number',f[5]+(f[1]==='b'?'…':'.')));let b=btn(n.san,()=>nav(i),i===study.cur?'current':'');if(par.kids.length>1)add(b,el('span','fork','⑂'));b.oncontextmenu=e=>{e.preventDefault();variation(i)};wrap.append(b)}p.append(wrap);let br=cur().kids.length>1?cur():(cur().id?study.nodes[cur().p]:null);if(br?.kids.length>1)p.append(section('Branches',...br.kids.map(i=>row(study.nodes[i].san,i===br.kids[0]?'Main':'Variation',()=>nav(i)))));if(cur().note&&!cfg.privacy)p.append(note(cur().note))}
function exportDialog(){modal('Export PGN',p=>{if(cfg.privacy){p.append(note('Export includes original names and comments.'));p.append(btn('Copy original PGN',()=>copy(exportGame(study)),'primary'))}else{let t=el('textarea');t.value=exportGame(study);t.readOnly=true;p.append(field('Game',t),btn('Copy PGN',()=>copy(t.value),'primary'))}})}
function importDialog(){modal('Import',p=>{const t=el('textarea');t.placeholder='PGN or FEN';t.maxLength=600000;let msg=note('');p.append(field('Game or position',t),msg,btn('Open as new study',()=>{try{let v=t.value.trim();if(!v)throw Error('Enter a PGN or FEN');let s=v.split(/\s+/).length===6&&v.split(' ')[0].includes('/')?blank(v,'Position'):parseGame(v);hide();switchStudy(s)}catch(e){msg.textContent=message(e)}},'primary'))})}
function show(dest){hide();if(editing){write('draft',editFen());editing=null;$('tabs').hidden=$('transport').hidden=false}resetInput();screen=dest;panelGen++;$('studio').hidden=dest!=='board';$('page').hidden=dest==='board';empty($('tools'));add($('tools'),icon('library','Library',()=>show('library')),icon('settings','Settings',()=>show('settings')));
 if(dest==='board'){standardBoardTools();boardPosition();paintBoard();transport();paintTabs();renderPanel();schedule();refreshCoverage()}else{stopEngines();if(dest==='library')libraryPage();if(dest==='settings')settingsPage()}window.scrollTo(0,0)}
function paintTabs(){let p=empty($('tabs'));for(const t of ['Moves','Lines','Book','Repertoire']){const b=btn(t,()=>{resetInput();cfg.tab=t;prefs();paintBoard();paintTabs();renderPanel()},'tab');b.setAttribute('role','tab');b.setAttribute('aria-selected',cfg.tab===t);p.append(b)}}
function renderPanel(){if(screen!=='board'||editing)return;const p=empty($('panel')),gen=++panelGen;if(cfg.tab==='Moves')notation(p);if(cfg.tab==='Lines')enginePanel(p);if(cfg.tab==='Book')bookPanel(p,gen);if(cfg.tab==='Repertoire')repPanel(p,gen)}
function stopEngines(){clearTimeout(timer);++engineSeq;local.close();window.Desk?.stop();rowsBy={phone:[],pc:[],leela:[]};localError=remoteError=''}
const local=new LocalStockfish((f,rows,err)=>{if(f&&f!==fen())return;localError=err||'';rowsBy.phone=rows;enginePaint()});
function enginePaint(){if(!framesPending)framesPending=requestAnimationFrame(()=>{framesPending=0;if(screen!=='board'||editing)return;paintArrows();paintValues();if(cfg.tab==='Lines')renderPanel()})}
function query(){let req={history:path(study).map(n=>n.uci)};if(study.game&&conn.paired&&study.owner===conn.owner)req.game_id=study.game;else if(study.root!==START)req.initial_fen=study.root;return req}
function schedule(pre){clearTimeout(timer);window.Desk?.stop();local.cancel();const id=++engineSeq;leelaMoveStats=[];rowsBy=pre||{phone:[],pc:[],leela:[]};remoteError=localError='';enginePaint();if(!visible||screen!=='board'||editing||!legal.length)return;
 timer=setTimeout(()=>{const a=query();if(cfg.pack!=='off'&&packs[cfg.pack])local.search(cfg.pack,fen(),study.root,a.history,cfg.fpv,cfg.fd);
 if(conn.paired&&(cfg.pc||cfg.leela)&&window.Desk)Desk.analyze(id,JSON.stringify({...a,engines:cfg.pc&&cfg.leela?'both':cfg.pc?'stockfish':'leela',nodes:cfg.nodes,backend:cfg.backend,sf_depth:cfg.depth,sf_lines:cfg.spv,leela_lines:cfg.lpv}))},100)}
function frame(id,raw){if(id!==engineSeq||screen!=='board')return;const {event,data}=JSON.parse(raw);if(data.fen&&data.fen!==fen()){try{if(new Chess(data.fen).fen()!==fen())return}catch{return}}
 if(event==='engine-error'||event==='error')remoteError=cfg.privacy?'PC analysis unavailable':data.error||data.message||'PC analysis unavailable';
 let name=event==='stockfish'?'pc':event==='lc0'?'leela':null,d=data;if(event==='done'&&data.final_snapshot){name='leela';d=data.final_snapshot}
 if(name==='leela'&&Array.isArray(d.move_stats))leelaMoveStats=d.move_stats;if(name&&Array.isArray(d.lines))rowsBy[name]=d.lines.filter(x=>Array.isArray(x.pv)&&x.pv.length);enginePaint()}
function sanLine(pv){let c=new Chess(fen());let s=[];for(const u of pv.slice(0,8)){try{s.push(c.move(obj(u)).san)}catch{break}}return s.join(' ')}
function enginePanel(p){const enabled=[['phone','Stockfish · phone',cfg.pack!=='off'],['pc','Stockfish · PC',cfg.pc],['leela','Leela · PC',cfg.leela]].filter(v=>v[2]);if(!enabled.length){p.append(row('Engines','Choose engine',()=>{show('settings')}));return}
 const grid=el('div','enginegrid');p.append(grid);for(const [k,title] of enabled){let rows=rowsBy[k],d=rows[0],section=el('section','enginelist'),lines=el('div','enginescroll');grid.append(section);section.append(row(title,d?.inherited?'Inherited':d?.depth?'Depth '+d.depth:d?.nodes?d.nodes+' nodes':'',()=>show('settings')),lines);for(const r of rows){let val=r.white_mate!=null?'#'+r.white_mate:r.white_cp!=null?(r.white_cp>=0?'+':'')+(r.white_cp/100).toFixed(2):r.white_score??r.score??'—';let b=btn('',()=>play(r.pv[0]),'row');add(b,el('span','lineval',val),el('span','pv linebody',r.san?.length?r.san.slice(0,8).join(' '):sanLine(r.pv)));lines.append(b)}}
 if(localError||remoteError)p.append(note(localError||remoteError));else if(!legal.length)p.append(note('Game over.'))}
