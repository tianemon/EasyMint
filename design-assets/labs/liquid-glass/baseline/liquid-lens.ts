/** Rounded-surface lens field: neutral centre, deterministic refraction in the curved rim. */
export function roundedLensMap(width:number,height:number,radius:number,strength=10):{width:number;height:number;data:Uint8ClampedArray} {
  const mapWidth=Math.max(1,Math.min(512,Math.ceil(width))),mapHeight=Math.max(1,Math.min(256,Math.ceil(height)));
  const data=new Uint8ClampedArray(mapWidth*mapHeight*4);
  const r=Math.max(1,Math.min(radius,width/2,height/2)),rim=Math.min(12,height*.23),scale=32;
  for(let y=0;y<mapHeight;y++)for(let x=0;x<mapWidth;x++) {
    const px=(x+.5)*width/mapWidth-width/2,py=(y+.5)*height/mapHeight-height/2;
    const qx=Math.abs(px)-(width/2-r),qy=Math.abs(py)-(height/2-r);
    const vx=Math.max(qx,0),vy=Math.max(qy,0),length=Math.hypot(vx,vy);
    const distance=length+Math.min(Math.max(qx,qy),0)-r;
    let dx=0,dy=0,edge=0;
    if(distance<0&&-distance<rim) {
      const normalX=length>0?vx/length:qx>qy?1:0,normalY=length>0?vy/length:qy>=qx?1:0;
      // A convex bevel: surface normal flattens towards the centre. Snell's
      // law yields a single smooth bend rather than a sinusoidal ripple.
      const depth=-distance,t=depth/rim,normal=1-t;
      const incident=Math.atan(normal/Math.sqrt(Math.max(.0001,1-normal*normal)));
      const refracted=incident-Math.asin(Math.sin(incident)/1.5);
      const boundary=Math.min(1,depth/.75);
      const bend=Math.min(strength,Math.tan(refracted)*strength*.7)*boundary*boundary*(3-2*boundary);
      edge=1-t*t*(3-2*t);
      dx=normalX*Math.sign(px)*bend;dy=normalY*Math.sign(py)*bend;
    }
    const offset=(y*mapWidth+x)*4;
    data[offset]=Math.max(0,Math.min(255,128+dx/scale*255));
    data[offset+1]=Math.max(0,Math.min(255,128+dy/scale*255));
    // Blue carries the edge mask; red/green retain signed displacement.
    data[offset+2]=Math.round(edge*255);data[offset+3]=255;
  }
  return {width:mapWidth,height:mapHeight,data};
}
