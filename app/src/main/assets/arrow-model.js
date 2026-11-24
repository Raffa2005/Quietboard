/* Arrow weights/thresholds and path semantics adapted from InstinctaZero Android 3963710 (GPL-3.0-or-later). No rendering code. */
function chance(r,side){let cp=r?.white_mate!=null?Math.sign(r.white_mate)*1000:r?.white_cp;if(cp==null||!Number.isFinite(+cp))return null;return 2/(1+Math.exp(-.00368208*Math.max(-1000,Math.min(1000,cp))*(side==='w'?1:-1)))-1}
function maneuver(pv,count){let out=[],seen=new Set;
 for(let i=0;i<pv.length&&i<Math.min(3,count)*2;i+=2){const u=pv[i];if(!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(u)||i&&pv[i-2].slice(2,4)!==u.slice(0,2))break;
 let a=u.slice(0,2),b=u.slice(2,4),dx=b.charCodeAt(0)-a.charCodeAt(0),dy=+b[1]-+a[1],lx=Math.abs(dx),ly=Math.abs(dy);if(seen.has(b)||a===b)break;seen.add(a);
 if(lx*ly!==2){if(lx&&ly&&lx!==ly)break;let route=[];for(let k=1;k<Math.max(lx,ly);k++)route.push(String.fromCharCode(a.charCodeAt(0)+k*Math.sign(dx))+(+a[1]+k*Math.sign(dy)));if(route.some(s=>seen.has(s)))break;route.forEach(s=>seen.add(s))}
 seen.add(b);out.push(u)}return out}
function arrowPlan(lines,opts){if(!opts.limit||!lines.length)return [];let best=lines[0],root=best?.pv?.[0];if(!root||!opts.legal.has(root))return [];const trail=maneuver(best.pv,opts.trail+1);let shapes=trail.slice(0,opts.limit).map((u,i)=>({u,root:!i,kind:i?2:0,w:i?.69:1.08}));if(!shapes.length)return [];
 const map=new Map((opts.stats||[]).map(s=>[s.uci,s])),seen=new Set([root.slice(0,4)]),first=map.get(root),bestCp=chance(best,opts.side);let alts=lines.slice(1);
 if(opts.leela)alts.sort((a,b)=>{const x=map.get(a.pv?.[0])||{},y=map.get(b.pv?.[0])||{};for(const k of ['visits','q','prior']){const d=(y[k]??-Infinity)-(x[k]??-Infinity);if(!Number.isNaN(d)&&d)return d}return (a.multipv||1)-(b.multipv||1)});
 const qs=[...(opts.stats||[])].filter(s=>s.visits>=Math.max(1,Math.floor((first?.visits||0)*.02))&&s.q!=null).map(s=>s.q);if(first?.q!=null)qs.push(first.q);
 for(const [idx,r] of alts.entries()){if(shapes.length>=opts.limit)break;let u=r.pv?.[0];if(!u||!opts.legal.has(u)||seen.has(u.slice(0,4)))continue;const stat=map.get(u),cp=chance(r,opts.side);let width;
 if(opts.leela){let ref=qs.length?Math.max(...qs):null,alt=stat?.q;if(ref==null||alt==null){ref=bestCp;alt=cp}const loss=ref==null||alt==null?0:Math.max(0,(ref-alt)/2);if(loss>=.16)continue;width=first?.visits!=null?Math.max(2,Math.min(12,Math.round(2+10*Math.sqrt(Math.min(1,((stat?.visits||0)+1)/(first.visits+1)))*(1-loss/.16)))):Math.max(2,10-2*idx)}
 else{const loss=(bestCp-cp)/2;if(loss<0||loss>=.2)continue;width=Math.round(12-loss*50)}
 seen.add(u.slice(0,4));shapes.push({u,root:true,kind:1,w:.16+.071*width})}return shapes}
