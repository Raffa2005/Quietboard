'use strict';
const {Chess}=InstinctaZeroChessRules, START=new Chess().fen(), uid=()=>globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+Math.random().toString(36).slice(2);
const uci=m=>m.from+m.to+(m.promotion||''), obj=m=>({from:m.slice(0,2),to:m.slice(2,4),...(m.length===5?{promotion:m[4]}:{})}), key=fen=>fen.split(' ').slice(0,4).join(' ');
const studyJournals=new WeakMap();
function markNodes(s,...ids){const j=studyJournals.get(s);if(j)for(const id of ids)j.dirty.add(id)}
function blank(fen=START,name='Study'){let c=new Chess(fen);return {id:uid(),name,root:fen,cur:0,next:1,nodes:{0:{id:0,p:null,fen:c.fen(),kids:[],san:'',uci:'',note:''}},when:Date.now()}}
function append(s,move,from=s.cur){let p=s.nodes[from];if(!p)throw Error('Missing position');const c=new Chess(p.fen),m=c.move(move);const u=uci(m);let id=p.kids.find(id=>s.nodes[id].uci===u);if(id==null){id=s.next++;p.kids.push(id);s.nodes[id]={id,p:from,uci:u,san:m.san,fen:c.fen(),kids:[],note:''};markNodes(s,from,id);}s.cur=id;return id}
function path(s,id=s.cur){const a=[];while(id!==0){const n=s.nodes[id];if(!n||a.length>10000)throw Error('Invalid study tree');a.push(n);id=n.p}return a.reverse()}
function prune(s,id){if(!id)return;const p=s.nodes[s.nodes[id].p];p.kids=p.kids.filter(x=>x!==id);markNodes(s,p.id);const stack=[id];while(stack.length){const n=s.nodes[stack.pop()];stack.push(...n.kids);delete s.nodes[n.id];markNodes(s,n.id)}if(!s.nodes[s.cur])s.cur=p.id}
function motion(s,id){const p=s.nodes[s.nodes[id].p];if(!p)return; p.kids=[id,...p.kids.filter(n=>n!==id)];markNodes(s,p.id)}
function parseGame(raw){if(raw.length>600000)throw Error('PGN exceeds 600 KB');const heads={};
 const body=raw.replace(/^\s*\[([a-zA-Z][a-zA-Z0-9_]*)\s+"((?:\\.|[^"\\])*)"\s*\]\s*$/gm,(_,k,v)=>{heads[k]=v.replace(/\\(["\\])/g,'$1');return ''});
 const s=blank(heads.FEN||START,heads.White&&heads.Black?heads.White+' – '+heads.Black:heads.Event&&heads.Event!=='?'?heads.Event:'Imported game');s.tags=heads;s.result=heads.Result||'*';
 const tokens=body.replace(/;[^\r\n]*/g,' ').match(/\{[^}]*\}|\(|\)|[^\s(){}]+/g)||[];let stack=[],count=0;
 for(let tok of tokens){if(tok==='('){if(s.cur===0)throw Error('Variation without a move');stack.push(s.cur);s.cur=s.nodes[s.cur].p;continue}
 if(tok===')'){if(!stack.length)throw Error('Unexpected variation end');s.cur=stack.pop();continue}
 if(tok[0]==='{'){s.nodes[s.cur].note=[s.nodes[s.cur].note,tok.slice(1,-1).trim()].filter(Boolean).join('\n');continue}
 tok=tok.replace(/^\d+\.(?:\.\.)?/,'').replace(/^\.\.\./,'').replace(/\$\d+/g,'').replace(/[!?]+$/,'');if(!tok||/^[.!?]+$/.test(tok))continue;
 if(/^(1-0|0-1|1\/2-1\/2|\*)$/.test(tok)){if(!stack.length)s.result=tok;continue}
 if(++count>5000)throw Error('Maximum 5,000 moves per import');append(s,tok)}
 if(stack.length)throw Error('Unclosed variation');if(!count && !heads.FEN)throw Error('No game moves found');s.cur=0;return s}
function exportGame(s){const tags={...s.tags,Result:s.result||'*'};if(s.root!==START)Object.assign(tags,{SetUp:'1',FEN:s.root});
 const hdr=Object.entries(tags).map(([k,v])=>'['+k+' "'+String(v).replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/[\r\n]/g,' ')+'"]').join('\n');
 function line(id,alts,first){const out=[];while(id!=null){const n=s.nodes[id],p=s.nodes[n.p],fields=p.fen.split(' ');if(fields[1]==='w'||first)out.push(fields[5]+(fields[1]==='b'?'...':'.'));
 out.push(n.san);if(n.note)out.push('{'+n.note.replace(/[{}]/g,'')+'}');if(alts)for(const a of p.kids.slice(1))out.push('('+line(a,false,true)+')');id=n.kids[0];alts=true;first=false}return out.join(' ')}
 const root=s.nodes[0];return hdr+'\n\n'+(root.note?'{'+root.note.replace(/[{}]/g,'')+'} ':'')+line(root.kids[0],true,true)+' '+(s.result||'*')}
const openingLines=[
 ['Italian Game','e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6'],['Ruy López','e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6'],['Scotch Game','e4 e5 Nf3 Nc6 d4 exd4 Nxd4'],['Petroff Defence','e4 e5 Nf3 Nf6 Nxe5 d6'],['Vienna Game','e4 e5 Nc3 Nf6'],['King’s Gambit','e4 e5 f4 exf4'],['Sicilian Defence','e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6'],['Sicilian Dragon','e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6'],['French Defence','e4 e6 d4 d5 Nc3 Nf6'],['Caro–Kann','e4 c6 d4 d5 Nc3 dxe4 Nxe4'],['Scandinavian','e4 d5 exd5 Qxd5 Nc3'],['Pirc Defence','e4 d6 d4 Nf6 Nc3 g6'],['Alekhine Defence','e4 Nf6 e5 Nd5 d4 d6'],['Queen’s Gambit','d4 d5 c4 e6 Nc3 Nf6'],['Queen’s Gambit Accepted','d4 d5 c4 dxc4 Nf3 Nf6'],['Slav Defence','d4 d5 c4 c6 Nf3 Nf6'],['London System','d4 d5 Bf4 Nf6 e3'],['King’s Indian','d4 Nf6 c4 g6 Nc3 Bg7 e4 d6'],['Nimzo-Indian','d4 Nf6 c4 e6 Nc3 Bb4'],['Grünfeld Defence','d4 Nf6 c4 g6 Nc3 d5'],['Dutch Defence','d4 f5 c4 Nf6'],['English Opening','c4 e5 Nc3 Nf6'],['Symmetrical English','c4 c5 Nf3 Nf6'],['Réti Opening','Nf3 d5 c4'],['Bird Opening','f4 d5 Nf3']];
let openings;
function guide(fen){if(!openings){openings=new Map;for(const [name,line] of openingLines){let c=new Chess;for(const san of line.split(' ')){let k=key(c.fen()),m=c.move(san),row=openings.get(k)||new Map;let u=uci(m);if(!row.has(u))row.set(u,{uci:u,san:m.san,names:[]});row.get(u).names.push(name);openings.set(k,row)}}}return [...(openings.get(key(fen))?.values()||[])]}
