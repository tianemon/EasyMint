// Build a small geographic asset from the already archived Natural Earth / world-atlas topology.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');
const source=path.join(root,'private_docs/design/ui-curation-2026-10-23/motion/vendor/demos/22-hud/assets/land-50m.json');
const raw=fs.readFileSync(source),topology=JSON.parse(raw),{scale,translate}=topology.transform;
const arcs=topology.arcs.map(arc=>{let x=0,y=0;return arc.map(([dx,dy])=>{x+=dx;y+=dy;return [x*scale[0]+translate[0],y*scale[1]+translate[1]];});});
const distance=(p,a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1],q=dx*dx+dy*dy,t=q?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/q)):0;return (p[0]-a[0]-t*dx)**2+(p[1]-a[1]-t*dy)**2;};
function simplify(points){if(points.length<4)return points;let d=.22,index=0;for(let i=1;i<points.length-1;i++){const next=distance(points[i],points[0],points.at(-1));if(next>d){d=next;index=i;}}return index?[...simplify(points.slice(0,index+1)).slice(0,-1),...simplify(points.slice(index))]:[points[0],points.at(-1)];}
const coast=[];for(const geometry of topology.objects.land.geometries)for(const polygon of geometry.arcs){const ring=polygon[0].flatMap(index=>index<0?[...arcs[~index]].reverse():arcs[index]);const xs=ring.map(p=>p[0]),ys=ring.map(p=>p[1]),area=(Math.max(...xs)-Math.min(...xs))*(Math.max(...ys)-Math.min(...ys));if(area<1.5||Math.max(...ys)<-60)continue;const split=Math.floor(ring.length/2),points=[...simplify(ring.slice(0,split+1)),...simplify(ring.slice(split)).slice(1)];coast.push(points.map(p=>p.map(n=>Math.round(n*100)/100)));}
fs.writeFileSync(path.join(root,'app/shared/visual-design/cyberpunk-land.ts'),`/** Simplified Natural Earth land, public domain; world-atlas redistribution under ISC.\n * See resources/visual-design/cyberpunk-land-PROVENANCE.md and cyberpunk-land-LICENSE.txt.\n * Archived input SHA-256: ${crypto.createHash('sha256').update(raw).digest('hex')}\n */\nexport const CYBERPUNK_LAND:number[][][]=${JSON.stringify(coast)};\n`);
console.log('Geographic contours:',coast.length,'vertices:',coast.reduce((n,p)=>n+p.length,0));
