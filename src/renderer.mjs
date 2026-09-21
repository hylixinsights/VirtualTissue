import {cellDamage} from './tissue-readouts.mjs';
import {M4,V3,hexColor,mixColor} from './math.mjs';
import {TYPES,ACTIONS,GRID,clamp,surface,surfaceNormal,sample,isEpi} from './engine.mjs';
import {cellDecision} from './decision-callout.mjs';
/* Genuine perspective 3D meshes, depth testing and instanced rendering.
 * Animation uses analytical phase functions only. No engine RNG is called.
 */
const VS=`#version 300 es
precision highp float;
layout(location=0) in vec3 position;
layout(location=1) in vec3 normal;
layout(location=2) in mat4 model;
layout(location=6) in vec4 color;
layout(location=7) in float unlit;
uniform mat4 vp;
out vec3 N;out vec3 world;out vec4 C;out float U;
void main(){vec4 w=model*vec4(position,1.);world=w.xyz;N=normalize(transpose(inverse(mat3(model)))*normal);C=color;U=unlit;gl_Position=vp*w;}`;
const FS=`#version 300 es
precision highp float;
in vec3 N;in vec3 world;in vec4 C;in float U;
uniform vec3 eye;
out vec4 outColor;
void main(){
 vec3 n=normalize(N);
 vec3 L=normalize(vec3(-.5,.85,1.));
 float key=max(0.,dot(n,L));float fill=max(0.,dot(n,normalize(vec3(1.,.3,-.2))));
 float hemi=.12+.14*(n.y*.5+.5);
 float spec=pow(max(0.,dot(n,normalize(L+normalize(eye-world)))),32.)*.16;
 vec3 lit=C.rgb*(.47+key*.5+fill*.12+hemi)+spec;
 outColor=vec4(mix(lit,C.rgb,U),C.a);
}`;
const quadVS=`#version 300 es
precision highp float;
layout(location=0) in vec3 position;
uniform mat4 vp;out vec2 uv;
void main(){uv=vec2((position.x+8.)/16.,(5.-position.y)/10.);gl_Position=vp*vec4(position,1.);}`;
const quadFS=`#version 300 es
precision highp float;in vec2 uv;uniform sampler2D field;out vec4 outColor;
void main(){outColor=texture(field,uv);}`;
function shaderProgram(gl,vs,fs){
 const mk=(type,s)=>{const sh=gl.createShader(type);gl.shaderSource(sh,s);gl.compileShader(sh);if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(sh));return sh;};
 const p=gl.createProgram(),v=mk(gl.VERTEX_SHADER,vs),f=mk(gl.FRAGMENT_SHADER,fs);gl.attachShader(p,v);gl.attachShader(p,f);gl.linkProgram(p);gl.deleteShader(v);gl.deleteShader(f);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p));return p;
}
function meshBuilder(){
 const positions=[],normals=[],indices=[];
 return {positions,normals,indices,vertex(p,n){positions.push(...p);normals.push(...n);return positions.length/3-1;},
 tri(a,b,c,n){const base=positions.length/3;const norm=n??V3.norm(V3.cross(V3.sub(b,a),V3.sub(c,a)));for(const p of [a,b,c]){positions.push(...p);normals.push(...norm);}indices.push(base,base+1,base+2);},
 quad(a,b,c,d,n){this.tri(a,b,c,n);this.tri(a,c,d,n);}};
}
function sphereMesh(seg=18,rings=12){
 const m=meshBuilder();
 for(let j=0;j<=rings;j++){const t=j/rings*Math.PI;for(let i=0;i<=seg;i++){const a=i/seg*Math.PI*2;const p=[Math.sin(t)*Math.cos(a),Math.cos(t),Math.sin(t)*Math.sin(a)];m.vertex(p,p);}}
 for(let j=0;j<rings;j++)for(let i=0;i<seg;i++){const a=j*(seg+1)+i,b=a+seg+1;m.indices.push(a,b,a+1,b,b+1,a+1);}return m;
}
function latheMesh(profile,seg=18){
 const m=meshBuilder();
 for(let j=0;j<profile.length;j++){
  const [r,y]=profile[j],p=profile[Math.max(0,j-1)],q=profile[Math.min(profile.length-1,j+1)];
  const dy=q[1]-p[1],dr=q[0]-p[0];
  for(let i=0;i<=seg;i++){const a=i/seg*Math.PI*2,c=Math.cos(a),s=Math.sin(a);m.vertex([r*c,y,r*s],V3.norm([dy*c,-dr,dy*s]));}
 }
 for(let j=0;j<profile.length-1;j++)for(let i=0;i<seg;i++){const a=j*(seg+1)+i,b=a+seg+1;m.indices.push(a,a+1,b,b,a+1,b+1);}return m;
}
function cubeMesh(){
 const m=meshBuilder();const pts=[[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1],[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1]];
 for(const f of [[0,1,2,3],[5,4,7,6],[4,0,3,7],[1,5,6,2],[3,2,6,7],[4,5,1,0]])m.quad(...f.map(i=>pts[i]));return m;
}
function roundBoxMesh(){
 // Subdivided cube projected onto a rounded box: soft toy edges.
 const m=meshBuilder(),n=5,core=.72;
 const faces=[[0,1,2,1],[0,1,2,-1],[1,0,2,1],[1,0,2,-1],[2,0,1,1],[2,0,1,-1]];
 for(const [axis,u,v,sign]of faces){
  const start=m.positions.length/3;
  for(let j=0;j<=n;j++)for(let i=0;i<=n;i++){
   const p=[0,0,0];p[axis]=sign;p[u]=-1+2*i/n;p[v]=-1+2*j/n;
   const c=p.map(v=>Math.max(-core,Math.min(core,v))),normal=V3.norm(V3.sub(p,c));m.vertex(c.map((v,k)=>v+normal[k]*(1-core)),normal);
  }
  for(let j=0;j<n;j++)for(let i=0;i<n;i++){const a=start+j*(n+1)+i,b=a+n+1;m.indices.push(a,a+1,b,a+1,b+1,b);}
 }return m;
}
function tissueMesh(){
 const m=meshBuilder(),N=150,bottom=-4.58,z0=-2.0,z1=0;
 for(let i=0;i<N;i++){
  const xa=i/N,xb=(i+1)/N,x=-8+xa*16,xx=-8+xb*16,y=5-surface(xa)*10,yy=5-surface(xb)*10;
  m.quad([x,bottom,z1],[xx,bottom,z1],[xx,yy,z1],[x,y,z1],[0,0,1]);
  m.quad([xx,bottom,z0],[x,bottom,z0],[x,y,z0],[xx,yy,z0],[0,0,-1]);
  const nn=V3.norm([-(yy-y),xx-x,0]);
  m.quad([x,y,z1],[xx,yy,z1],[xx,yy,z0],[x,y,z0],nn);
 }
 const yl=5-surface(0)*10,yr=5-surface(1)*10;
 m.quad([-8,bottom,z0],[-8,bottom,z1],[-8,yl,z1],[-8,yl,z0],[-1,0,0]);
 m.quad([8,bottom,z1],[8,bottom,z0],[8,yr,z0],[8,yr,z1],[1,0,0]);
 m.quad([-8,bottom,z0],[8,bottom,z0],[8,bottom,z1],[-8,bottom,z1],[0,-1,0]);return m;
}
const worldPos=(x,y,z=0)=>[-8+x*16,5-y*10,z];
const ink=hexColor('#34494C'),white=hexColor('#FFFAF1'),pink=hexColor('#EB9097');
export class Diorama {
 constructor(canvas,overlay,onPick){
  this.canvas=canvas;this.overlay=overlay;this.ctx=overlay.getContext('2d');this.onPick=onPick;
  const gl=canvas.getContext('webgl2',{alpha:true,antialias:true,premultipliedAlpha:false,preserveDrawingBuffer:true});
  if(!gl)throw new Error('WebGL 2 is unavailable. Open this file in a browser with hardware graphics enabled.');
  this.gl=gl;this.program=shaderProgram(gl,VS,FS);this.vpLoc=gl.getUniformLocation(this.program,'vp');this.eyeLoc=gl.getUniformLocation(this.program,'eye');
  this.batches={};this.addGeometry('sphere',sphereMesh());this.addGeometry('box',roundBoxMesh());this.addGeometry('cube',cubeMesh());
  this.addGeometry('goblet',latheMesh([[.04,-1],[.24,-.96],[.27,-.65],[.35,-.3],[.76,.06],[.95,.45],[.98,.75],[.86,.96],[.25,1],[.02,1.02]],20));
  this.addGeometry('nk',latheMesh([[.08,-1],[.72,-.9],[1,-.52],[1,.52],[.72,.9],[.08,1]],6));
  this.addGeometry('tissue',tissueMesh());
  this.phases=new Map();this.drawn=new Map();this.selected=null;this.current=null;this.previous=null;this.transitionAt=0;this.transitionMs=850;
  this.yaw=.22;this.pitch=.21;this.zoom=1;this.target=[0,-.6,-.35];this.sceneTime=0;this.lastTick=-1;this.fades=new Map();
  this.options={faces:true,labels:true,signals:'chemokine',arrows:true,actions:true,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches};
  this.pending=null;this.fieldKey='';this.displayPoints=[];
  this.callout=document.createElement('div');this.callout.id='cellCallout';this.callout.className='cellCallout';this.callout.hidden=true;
  this.callout.setAttribute('role','status');this.callout.setAttribute('aria-live','polite');this.callout.setAttribute('aria-atomic','true');
  canvas.parentElement.append(this.callout);
  this.createField();this.controls();
  this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(canvas.parentElement);this.resize();
  this.lost=false;canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();this.lost=true;});canvas.addEventListener('webglcontextrestored',()=>location.reload());
 }
 addGeometry(name,m){
  const gl=this.gl,vao=gl.createVertexArray();gl.bindVertexArray(vao);
  for(const [loc,data] of [[0,m.positions],[1,m.normals]]){const buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.STATIC_DRAW);gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,3,gl.FLOAT,false,0,0);}
  const idx=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,idx);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint32Array(m.indices),gl.STATIC_DRAW);
  const inst=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,inst);
  for(let j=0;j<4;j++){gl.enableVertexAttribArray(2+j);gl.vertexAttribPointer(2+j,4,gl.FLOAT,false,21*4,j*16);gl.vertexAttribDivisor(2+j,1);}
  gl.enableVertexAttribArray(6);gl.vertexAttribPointer(6,4,gl.FLOAT,false,84,64);gl.vertexAttribDivisor(6,1);
  gl.enableVertexAttribArray(7);gl.vertexAttribPointer(7,1,gl.FLOAT,false,84,80);gl.vertexAttribDivisor(7,1);
  gl.bindVertexArray(null);this.batches[name]={vao,inst,count:m.indices.length,instances:[],alpha:[]};
 }
 createField(){
  const gl=this.gl;this.fieldProgram=shaderProgram(gl,quadVS,quadFS);this.fieldVao=gl.createVertexArray();gl.bindVertexArray(this.fieldVao);
  const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-8,5,.075,8,5,.075,8,-5,.075,-8,5,.075,8,-5,.075,-8,-5,.075]),gl.STATIC_DRAW);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,0,0);
  this.tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.tex);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.bindVertexArray(null);
 }
 resize(){
  const r=this.canvas.parentElement.getBoundingClientRect();this.w=r.width;this.h=r.height;this.dpr=Math.min(devicePixelRatio||1,2);
  this.canvas.width=Math.round(this.w*this.dpr);this.canvas.height=Math.round(this.h*this.dpr);this.overlay.width=this.canvas.width;this.overlay.height=this.canvas.height;
  this.ctx.setTransform(this.dpr,0,0,this.dpr,0,0);
 }
 controls(){
  const cv=this.canvas;let ptr=null,pinch=0;const points=new Map();
  cv.addEventListener('pointerdown',e=>{points.set(e.pointerId,{x:e.clientX,y:e.clientY});cv.setPointerCapture(e.pointerId);ptr={id:e.pointerId,x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,moved:false};if(points.size===2){const p=[...points.values()];pinch=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);}});
  cv.addEventListener('pointermove',e=>{
   if(!points.has(e.pointerId))return;points.set(e.pointerId,{x:e.clientX,y:e.clientY});
   if(points.size===2){const p=[...points.values()],d=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);if(pinch)this.zoom=clamp(this.zoom*d/pinch,.72,2.7);pinch=d;if(ptr)ptr.moved=true;return;}
   if(!ptr)return;const dx=e.clientX-ptr.x,dy=e.clientY-ptr.y;if(Math.hypot(e.clientX-ptr.startX,e.clientY-ptr.startY)>5)ptr.moved=true;
   if(ptr.moved){this.yaw=clamp(this.yaw+dx*.004,-.6,.6);this.pitch=clamp(this.pitch+dy*.003,-.04,.48);}ptr.x=e.clientX;ptr.y=e.clientY;
  });
  const end=e=>{points.delete(e.pointerId);if(ptr&&!ptr.moved&&points.size===0){const r=cv.getBoundingClientRect();this.pick(e.clientX-r.left,e.clientY-r.top);}ptr=null;pinch=0;};
  cv.addEventListener('pointerup',end);cv.addEventListener('pointercancel',()=>{ptr=null;points.clear();});
  cv.addEventListener('wheel',e=>{e.preventDefault();this.zoom=clamp(this.zoom*Math.exp(-e.deltaY*.001),.72,2.7);},{passive:false});
  cv.addEventListener('dblclick',()=>this.home());
 }
 home(){this.yaw=.22;this.pitch=.21;this.zoom=1;this.target=[0,-.6,-.35];}
 front(){this.yaw=0;this.pitch=0;this.zoom=1;}
 focus(c){this.target=worldPos(c.x,c.y,0);this.zoom=1.9;}
 setFrame(frame,instant=false){
  const now=performance.now(),progress=this.options.reduced?1:clamp((now-this.transitionAt)/this.transitionMs),ease=1-Math.pow(1-progress,3);
  // Several biological minutes can arrive before the next display frame.
  // Continue from the on-screen position instead of swallowing intermediate moves.
  const visible=(this.current?.cells??[]).map(c=>{const old=this.previousById.get(c.id)??c;return {...c,x:old.x+(c.x-old.x)*ease,y:old.y+(c.y-old.y)*ease};});
  this.previous=this.current;this.current=frame;this.transitionAt=now;if(instant)this.previous=frame;
  this.currentById=new Map(frame.cells.map(c=>[c.id,c]));
  this.previousById=new Map((instant?frame.cells:visible).map(c=>[c.id,c]));
  this.fieldKey='';
  for(const c of frame.cells)if(!c.alive&&(!this.previousById.get(c.id)||this.previousById.get(c.id).alive))this.fades.set(c.id,performance.now());
 }
 project(p){const q=M4.transform(this.vp,p);return {x:(q[0]/q[3]+1)*this.w/2,y:(1-q[1]/q[3])*this.h/2,z:q[2]/q[3]};}
 pick(x,y){
  if(this.pending){
   let best=null,bestD=Infinity;for(let i=0;i<=500;i++){const u=.04+i/500*.92,q=this.project(worldPos(u,surface(u),.3)),d=Math.hypot(q.x-x,q.y-y);if(d<bestD){bestD=d;best=u;}}
   if(bestD<Math.max(120,this.h*.35))this.onPick({placeX:best});return;
  }
  let best=null;
  for(const p of this.displayPoints){const d=Math.hypot(x-p.s.x,y-p.s.y);if(d<p.r+8&&(!best||d/(p.r+8)<best.score))best={id:p.id,score:d/(p.r+8)};}
  this.onPick({cell:best?.id??null});
 }
 instance(name,pos,scale,color,angle=0,parent=null,unlit=0){
  let model=M4.trs(pos,scale,angle);if(parent)model=M4.mul(parent,model);
  const data=[...model,...color,unlit];const b=this.batches[name];(color[3]<.99?b.alpha:b.instances).push(...data);
 }
 rod(a,b,r,color,parent=null){
  const d=V3.sub(b,a),len=Math.hypot(...d);if(len<.00001)return;
  const y=V3.norm(d),x=V3.norm(V3.cross(Math.abs(y[2])>.95?[0,1,0]:[0,0,1],y)),z=V3.cross(x,y),p=a.map((v,i)=>(v+b[i])/2);
  let m=[x[0]*r,x[1]*r,x[2]*r,0,y[0]*len/2,y[1]*len/2,y[2]*len/2,0,z[0]*r,z[1]*r,z[2]*r,0,...p,1];if(parent)m=M4.mul(parent,m);
  const arr=[...m,...color,0];(color[3]<.99?this.batches.sphere.alpha:this.batches.sphere.instances).push(...arr);
 }
 render(time){
  if(!this.current||this.lost)return;const gl=this.gl;
  this.sceneTime=time;const aspect=this.w/this.h,fit=Math.max(20.4,19/aspect/Math.tan(.28)/2),radius=fit/this.zoom;
  this.eye=[this.target[0]+Math.sin(this.yaw)*radius*Math.cos(this.pitch),this.target[1]+Math.sin(this.pitch)*radius,this.target[2]+Math.cos(this.yaw)*radius*Math.cos(this.pitch)];
  this.vp=M4.mul(M4.perspective(.56,aspect),M4.lookAt(this.eye,this.target));
  for(const b of Object.values(this.batches)){b.instances.length=0;b.alpha.length=0;}
  this.displayPoints.length=0;
  this.buildScene(time);
  gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.enable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.disable(gl.BLEND);gl.depthMask(true);
  gl.useProgram(this.program);gl.uniformMatrix4fv(this.vpLoc,false,this.vp);gl.uniform3fv(this.eyeLoc,this.eye);
  for(const b of Object.values(this.batches))this.drawBatch(b,false);
  gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);
  this.drawField();
  gl.useProgram(this.program);gl.uniformMatrix4fv(this.vpLoc,false,this.vp);gl.uniform3fv(this.eyeLoc,this.eye);
  for(const b of Object.values(this.batches))this.drawBatch(b,true);
  gl.depthMask(true);gl.bindVertexArray(null);
  this.drawOverlay(time);
 }
 drawBatch(b,alpha){const data=alpha?b.alpha:b.instances;if(!data.length)return;const gl=this.gl;gl.bindVertexArray(b.vao);gl.bindBuffer(gl.ARRAY_BUFFER,b.inst);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.DYNAMIC_DRAW);gl.drawElementsInstanced(gl.TRIANGLES,b.count,gl.UNSIGNED_INT,0,data.length/21);}
 buildScene(time){
  const f=this.current,t=time*.001,quiet=this.options.reduced;
  this.instance('box',[0,-4.83,-.6],[8.42,.3,1.9],hexColor('#D1DBBE'));
  this.instance('box',[0,-5.15,-.65],[8.53,.12,2],hexColor('#829D91'));
  this.instance('tissue',[0,0,0],[1,1,1],hexColor('#E8B2A2'));
  // Delicate basement line, sculpted into the cutaway surface.
  for(let i=0;i<100;i++){
   const x=i/100,xx=(i+1)/100;
   this.rod(worldPos(x,surface(x)+.039,.07),worldPos(xx,surface(xx)+.039,.07),.025,hexColor('#CE8C88'));
  }
  // A visible vascular tube. Red disks are decorative, not extra model agents.
  this.instance('box',[0,-4.25,.04],[7.85,.22,.27],hexColor('#B75672'));
  this.instance('box',[0,-4.18,.12],[7.79,.11,.27],hexColor('#E67A8C'));
  for(let i=0;i<18;i++){const x=((i*.829+t*.26)%15.1)-7.55;this.instance('sphere',[x,-4.18+Math.sin(i*2)*.027,.41],[.105,.065,.035],hexColor('#FFB1B7'));}
  // Matrix fibers are anchored decorations and have no influence on the engine.
  for(let i=0;i<28;i++){
   const x=.06+((i*.381966)%1)*.88,y=surface(x)+.12+((i*.618033)%1)*(.78-surface(x));
   if(y>.91)continue;const a=worldPos(x,y,.035),b=[a[0]+.29,a[1]+.045,a[2]];this.rod(a,b,.013,hexColor('#D19795'));
  }
  const interp=quiet?1:clamp((time-this.transitionAt)/this.transitionMs),ease=1-Math.pow(1-interp,3);
  for(const c of f.cells){
   const old=this.previousById.get(c.id)??c;
   const x=old.x+(c.x-old.x)*ease,y=old.y+(c.y-old.y)*ease;
   let fade=1,extrude=0;
   if(!c.alive&&c.v5){if(!c.corpse)continue;fade=.64;}else if(!c.alive){
    const when=this.fades.get(c.id);fade=when!==undefined?clamp(1-(time-when)/1500):0;
    if(this.previous===this.current)fade=0;
    if(!c.corpse)fade=0;
    extrude=c.deathKind==='apoptosis'?(1-fade)*.7:0;
    if(fade<.015)continue;
   }
   let pos=worldPos(x,y,c.z+.19),angle=0;
   if(isEpi(c)){const n=surfaceNormal(x);angle=Math.atan2(-n.x,-n.y);pos[0]+=n.x*(.32+extrude);pos[1]-=n.y*(.32+extrude);pos[2]=.38;}
   else if(!quiet)pos[1]+=Math.sin(t*2+(c.visualIndex??c.id)*1.73)*.022;
   // Lift selection in display depth only, so nearby cells cannot hide its nucleus.
   if(c.id===this.selected&&!isEpi(c))pos[2]+=1.15;
   const parent=M4.trs(pos,[fade,fade,fade],angle);
   let widthFactor=1;
   if(isEpi(c)){const centers=f.slots.map(s=>{const n=surfaceNormal(s.x);return [-8+s.x*16+n.x*.32,5-s.y*10-n.y*.32];});const at=centers[c.slot];let gap=Infinity;for(const j of [c.slot-1,c.slot+1])if(centers[j])gap=Math.min(gap,Math.hypot(at[0]-centers[j][0],at[1]-centers[j][1]));widthFactor=Math.min(1,gap/.49);}
   if(c.v5&&['dendritic','inflammatory_monocyte'].includes(c.state.type)&&c.v5.phenotype!=='resident_like')this.myeloidCell(c,parent);else this.cell(c,parent,time,widthFactor);
   if(c.v5){
    for(let j=1;j<c.v5.trail.length;j++){const a=c.v5.trail[j-1],b=c.v5.trail[j];this.rod(worldPos(a.x,a.y,.5),worldPos(b.x,b.y,.5),.018,hexColor(c.state.type==='inflammatory_monocyte'?'#DBAA71':'#B4D477',.7));}
    if(c.state.viability==='death_committed'||!c.alive){this.rod([pos[0]-.16,pos[1]-.16,pos[2]+.34],[pos[0]+.16,pos[1]+.16,pos[2]+.34],.035,hexColor('#BA555E'));this.rod([pos[0]+.16,pos[1]-.16,pos[2]+.34],[pos[0]-.16,pos[1]+.16,pos[2]+.34],.035,hexColor('#BA555E'));}
    if(c.v5.presented.length)for(let j=0;j<3;j++){const xx=pos[0]-.2+j*.2;this.instance('box',[xx,pos[1]+.42,pos[2]+.2],[.035,.10,.025],hexColor('#8CD8EC'));this.instance('sphere',[xx,pos[1]+.53,pos[2]+.2],[.048,.027,.028],hexColor('#D38454'));}
   }
   if(c.manual&&this.options.actions){
    // Amber beads stay at the cell during preparation; green extracellular
    // beads appear only with an accepted capacity and available substrate.
    if(c.manual.preparing){
     const phase=quiet?0:t*2;
     const size=c.id===this.selected ? .10 : .075;
     for(let j=0;j<3;j++){const a=phase+j*Math.PI*2/3;this.instance('sphere',[pos[0]+Math.cos(a)*.3,pos[1]+.6,pos[2]+Math.sin(a)*.12],[size,size,size],hexColor('#F2CD78'));}
    }
    if(c.manual.secreting){
     const q=quiet?.5:(t*.7+(c.visualIndex??0)*.13)%1;
     const p=worldPos(c.x,c.y+.055+q*.045,.5);
     const size=(.085+q*.05)*(c.id===this.selected?1.5:1);
     this.instance('sphere',p,[size,size,size],hexColor('#69D8AD',1-q*.45));
    }
    if(c.manual.mucus>0){
     const n=surfaceNormal(c.x),p=worldPos(c.x,c.y,.48),opacity=1-Math.exp(-c.manual.mucus*80);
     this.instance('sphere',[p[0]+n.x*.85,p[1]-n.y*.85,p[2]],[.28,.10,.15],hexColor('#99DED9',.15+opacity*.65));
    }
   }
   const ss=this.project(pos),rr=this.project([pos[0]+.36,pos[1],pos[2]]);this.displayPoints.push({id:c.id,s:ss,r:Math.abs(rr.x-ss.x),world:pos});
  }
  if(f.lab){
   for(const b of f.lab.bacteria){
    if(!['free','attached'].includes(b.state))continue;
    const p=worldPos(b.x,b.y,.72),a=b.state==='attached'?0:(Number(b.id.split('-')[1])*.61);
    this.instance('sphere',p,[f.unified?.14:.078,f.unified?.05:.031,f.unified?.05:.034],hexColor(b.species==='ETEC'?(b.state==='attached'?'#168F9B':'#66DDE4'):(b.state==='attached'?'#B35A35':'#DD8858')),a);
    if(b.state==='attached')this.instance('sphere',[p[0],p[1]-.035,p[2]-.025],[.095,.027,.035],hexColor('#EDD09B'));
   }
   for(const q of f.lab.patches){
    if(q.water<.015)continue;
    const p=worldPos(q.x,surface(q.x)-.14,.78),amount=1-Math.exp(-q.water);
    this.instance('sphere',p,[.27,.04+amount*.22,.13],hexColor('#64C9DB',.35+amount*.4));
   }
  }
  if(f.unified)for(const slot of f.slots){if(slot.junction<.98){const p=worldPos(slot.x,slot.y,.69);this.instance('sphere',p,[.16,.045,.06],hexColor('#B96862',.3+.7*(1-slot.junction)));}}
  // Broken slots expose the tissue. Repair appears as a mint patch, not a new cell.
  for(const s of f.slots){const c=this.currentById.get(s.cell);if(!c.alive){
   const pos=worldPos(s.x,s.y,.095);this.instance('sphere',pos,[.27,.13,.055],hexColor('#9F676D'));
   if(s.seal>.005){this.instance('box',[pos[0],pos[1]+.05,.18],[.25,.055,.14],hexColor('#91C5B3',.2+s.seal*.65));}
  }}
  // Visible pathogen particles sample the actual simulated concentration.
  if(this.options.signals!=='none'){
   let num=0;
   for(let j=0;j<GRID.h;j+=2)for(let i=0;i<GRID.w;i+=2){
    const value=f.fields.pathogen[j*GRID.w+i];if(value<.013||num>75)continue;
    const px=(i+.25)/GRID.w,py=(j+.35)/GRID.h,pp=worldPos(px,py,.41),s=.055+Math.sqrt(value)*.11;
    const a=t*.4+i;pp[0]+=Math.sin(a)*.018;pp[1]+=Math.cos(a)*.018;
    this.instance('sphere',pp,[s*1.6,s*.72,s*.7],hexColor('#CC726B'),.6+i*.38);
    this.instance('sphere',[pp[0]+s*.4,pp[1]+s*.2,pp[2]+s*.65],[s*.13,s*.13,s*.09],ink);num++;
   }
  }
  for(const s of f.sources)if(s.kind==='particle'){const p=worldPos(s.x,s.y-.04,.55);this.instance('nk',p,[.14,.23,.12],hexColor('#ADC6E2'),.45);}
  if(this.pending?.valid&&this.pending.kind!=='resolve'){
   const p=worldPos(this.pending.x,surface(this.pending.x)-.085,.6);
   this.instance('sphere',p,[.14,.14,.14],hexColor('#FAE0A1'),0,null,1);
  }
 }
 myeloidCell(c,parent){
  const dc=c.state.type==='dendritic',color=hexColor(dc?'#68B6B4':'#D3A277'),nucleus=hexColor('#79618C');
  this.instance('sphere',[0,0,0],dc?[.24,.21,.20]:[.25,.26,.24],color,0,parent);
  if(dc){for(let i=0;i<5;i++){const a=i*1.27+.25,x=Math.cos(a),y=Math.sin(a);this.rod([x*.15,y*.15,0],[x*.53,y*.48,-.02],.025,color,parent);this.rod([x*.38,y*.35,0],[x*.48-y*.12,y*.43+x*.12,0],.015,color,parent);}}
  this.instance('sphere',[-.055,.04,.20],dc?[.10,.11,.04]:[.13,.16,.04],nucleus,-.35,parent);
  if(!dc)this.instance('sphere',[.025,.06,.231],[.085,.105,.025],color,-.4,parent);
  for(let j=0;j<(c.lab?.cargo?.length??0);j++)this.instance('sphere',[.1,.0+j*.055,.22],[.045,.022,.027],hexColor('#C96D4D'),0,parent);
 }
 cell(c,parent,time,widthFactor=1){
  if(isEpi(c))parent=M4.mul(parent,M4.trs([0,0,0],[widthFactor,1,1]));
  const color=hexColor(TYPES[c.type].color),dark=mixColor(color,ink,.2),light=mixColor(color,white,.35);
  let faceZ=.27,faceScale=1;
  const add=(shape,p,s,col=color,rot=0)=>this.instance(shape,p,s,col,rot,parent);
  const nucleus=hexColor('#77628E'),nuclearLight=hexColor('#A695B7');
  if(c.type==='enterocyte'){
   add('box',[0,0,0],[.232,.39,.30]);
   add('box',[0,.36,0],[.24,.035,.30],light);
   add('sphere',[0,-.19,.287],[.095,.12,.038],nucleus);
   const brush=c.lab?.patch?.brush??1;
   for(let i=-3;i<=3;i++)for(const z of [-.12,.13])add('sphere',[i*.064,.40+.05*brush,z],[.018,.015+.085*brush,.022],light);
   faceZ=.306;faceScale=.72;
  }else if(c.type==='goblet'){
   add('goblet',[0,-.013,0],[.25,.365,.27]);faceZ=.257;faceScale=.66;
   add('sphere',[0,-.22,.16],[.064,.09,.032],nucleus);
   for(let j=0;j<9;j++){const x=((j%3)-1)*.105,y=.12+Math.floor(j/3)*.069;add('sphere',[x,y,.20],[.055,.049,.04],j%2?light:hexColor('#E0EFDE'));}
  }else if(c.type==='fibroblast'){
   add('sphere',[0,0,0],[.35,.115,.15]);faceZ=.16;faceScale=.6;
   this.rod([-.16,0,0],[-.59,-.055,-.02],.047,color,parent);this.rod([.16,0,0],[.60,.10,-.02],.038,color,parent);
   add('sphere',[-.06,.026,.139],[.15,.057,.026],nucleus);
  }else if(c.type==='macrophage'){
   add('sphere',[0,0,0],[.37,.29,.27]);faceZ=.278;faceScale=.72;
   // Broad asymmetric lamellipodium and a few tapering processes, not radial beads.
   add('sphere',[-.25,.08,-.035],[.20,.21,.14],light,-.4);
   this.rod([-.29,.17,0],[-.52,.31,-.015],.050,color,parent);
   this.rod([-.30,-.08,0],[-.54,-.17,-.03],.037,color,parent);
   this.rod([.25,.10,0],[.45,.20,-.02],.045,color,parent);
   this.rod([.20,-.17,0],[.35,-.35,-.03],.035,color,parent);
   add('sphere',[-.085,.10,.254],[.18,.117,.036],nucleus,-.35);
   add('sphere',[-.015,.153,.283],[.083,.048,.022],color,-.4);
   for(let j=0;j<4;j++)add('sphere',[.14+(j%2)*.105,-.05+Math.floor(j/2)*.13,.252],[.043,.05,.026],light);
   for(let j=0;j<(c.lab?.cargo?.length??0);j++)add('sphere',[.14+j*.1,.0,.288],[.055,.027,.026],hexColor('#C96D4D'));
  }else if(c.type==='neutrophil'){
   add('sphere',[0,0,0],[.26,.25,.24]);faceZ=.25;faceScale=.57;
   const lobes=[[-.14,.06,.219],[-.075,.145,.204],[.065,.11,.219],[.13,.01,.228]];
   for(let i=0;i<lobes.length;i++){if(i)this.rod(lobes[i-1],lobes[i],.029,nucleus,parent);add('sphere',lobes[i],[.065,.063,.027],nucleus);}
   for(let j=0;j<14;j++){const a=j*2.399,r=.17+(j%3)*.012;add('sphere',[Math.cos(a)*r,Math.sin(a)*r,.22],[.012,.013,.010],j%2?nuclearLight:light);}
  }else{
   add('sphere',[0,0,0],[.265,.27,.25]);faceZ=.264;faceScale=.59;
   add('sphere',[-.025,.055,.23],[.172,.156,.035],nucleus);
   for(let i=0;i<7;i++){const a=Math.PI*1.12+i*.14;add('sphere',[Math.cos(a)*.21,Math.sin(a)*.21,.224],[.025,.023,.018],nuclearLight);}
  }
  if(!this.options.faces)return;
  const s=faceScale,eyesY=c.type==='enterocyte'?.095:c.type==='goblet'?-.05:c.type==='fibroblast'?-.035:-.115;
  add('sphere',[-.079*s,eyesY,faceZ],[.031*s,.039*s,.018],ink);add('sphere',[.079*s,eyesY,faceZ],[.031*s,.039*s,.018],ink);
  add('sphere',[-.084*s,eyesY+.013,faceZ+.015],[.009,.010,.006],white);add('sphere',[.074*s,eyesY+.013,faceZ+.015],[.009,.010,.006],white);
  add('sphere',[-.14*s,eyesY-.057,faceZ-.008],[.040*s,.019,.012],pink);add('sphere',[.14*s,eyesY-.057,faceZ-.008],[.040*s,.019,.012],pink);
  const stressed=c.health<65||['alarm','cytokine','recruit'].includes(c.action);
  if(stressed)add('sphere',[0,eyesY-.092,faceZ+.005],[.030,.038,.009],ink);
  else for(let i=0;i<5;i++){const a=Math.PI*1.14+i*.18*Math.PI;add('sphere',[Math.cos(a)*.053*s,eyesY-.061+Math.sin(a)*.042,faceZ+.006],[.012,.011,.009],ink);}
 }
 drawField(){
  const key=`${this.current.tick}:${this.current.revision??0}:${this.options.signals}:${this.current.sources.length}`;
  if(this.fieldKey!==key){
   this.fieldKey=key;const f=this.current.fields,name=this.options.signals;
   const a=new Uint8Array(GRID.w*GRID.h*4),palette=this.current.mode==='manual'?{CCL2:[218,167,101],CXCL8:[85,206,173],MUCUS:[132,216,229],TNF:[211,145,188],SECRETORY_STIMULUS:[249,203,110],WATER:[81,193,223],LT:[67,221,240],ST:[190,152,255],DAMP:[250,142,98],PAMP:[223,177,109]}:{pathogen:[244,137,116],danger:[255,183,111],chemokine:[85,206,173],cytokine:[168,137,226]};
   for(let i=0;i<GRID.w*GRID.h;i++){
    let rgb=[0,0,0],alpha=0;
    const names=name==='all'?Object.keys(palette):name==='none'?[]:[name].filter(k=>palette[k]);
    for(const k of names){const v=clamp(f[k]?.[i]??0);if(v>.003){const aa=Math.sqrt(v)*.70;for(let j=0;j<3;j++)rgb[j]+=palette[k][j]*aa;alpha+=aa;}}
    if(alpha>0)for(let j=0;j<3;j++)a[i*4+j]=rgb[j]/alpha;a[i*4+3]=Math.min(160,alpha*180);
   }
   const gl=this.gl;gl.bindTexture(gl.TEXTURE_2D,this.tex);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,GRID.w,GRID.h,0,gl.RGBA,gl.UNSIGNED_BYTE,a);
  }
  const gl=this.gl;gl.useProgram(this.fieldProgram);gl.uniformMatrix4fv(gl.getUniformLocation(this.fieldProgram,'vp'),false,this.vp);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.tex);gl.uniform1i(gl.getUniformLocation(this.fieldProgram,'field'),0);gl.bindVertexArray(this.fieldVao);gl.drawArrays(gl.TRIANGLES,0,6);
 }
 label(text,p,color='#D8E8DD',size=11){
  const q=this.project(p),ct=this.ctx;ct.font=`600 ${size}px system-ui, sans-serif`;ct.textAlign='left';ct.fillStyle=color;ct.fillText(text,q.x,q.y);return q;
 }
 drawOverlay(time){
  const ct=this.ctx,w=this.w,h=this.h;ct.clearRect(0,0,w,h);ct.lineCap='round';
  if(this.options.labels){
   this.label('LUMEN',[-7.75,3.75,0],'#C3D8D1',10);
   this.label('LAMINA PROPRIA',[-7.67,-3.66,.12],'#9B616B',9);
   this.label('VASCULAR RESERVE',[-7.7,-4.53,.6],'#795866',9);
  }
  if(this.current.lab?.audit.water.retained>.05){
   const wet=this.current.lab.patches.reduce((a,b)=>a.water>b.water?a:b);
   this.label('OSMOTIC WATER',worldPos(wet.x,surface(wet.x)-.21,.8),'#BFEFF3',11);
  }
  if(this.options.arrows&&['chemokine','CXCL8','CCL2','all'].includes(this.options.signals)){
   ct.strokeStyle='rgba(32,132,105,.62)';ct.fillStyle='rgba(32,132,105,.7)';ct.lineWidth=1.35;
   const f=this.current.fields[this.options.signals==='CCL2'?'CCL2':this.current.mode==='manual'?'CXCL8':'chemokine'];
   for(let x=.08;x<.96;x+=.075)for(let y=.32;y<.9;y+=.09){
    if(y<surface(x)+.05)continue;const gx=sample(f,x+.02,y)-sample(f,x-.02,y),gy=sample(f,x,y+.02)-sample(f,x,y-.02),n=Math.hypot(gx,gy);if(n<.002)continue;
    const a=this.project(worldPos(x,y,.42)),b=this.project(worldPos(x+gx/n*.025,y+gy/n*.035,.42));
    this.arrow(ct,a.x,a.y,b.x,b.y);
   }
  }
  // Activation is the current local sensing state, independent of last action.
  // Persistent rings also appear immediately after Apply, before any decision.
  if(this.options.actions&&(this.current.mode!=='manual'||this.current.unified))for(const p of this.displayPoints){
   if(!this.currentById.get(p.id).sensing?.activation.active&&!this.currentById.get(p.id).unified?.active)continue;
   ct.strokeStyle='#EFBE69';ct.lineWidth=2.5;ct.beginPath();ct.arc(p.s.x,p.s.y,p.r+4,0,Math.PI*2);ct.stroke();
   ct.fillStyle='#EFBE69';ct.strokeStyle='#173F40';ct.lineWidth=1.5;ct.beginPath();ct.arc(p.s.x,p.s.y-p.r-5,3.5,0,Math.PI*2);ct.fill();ct.stroke();
  }
  this.diagnosticMarkers=[];
  if(this.current.unified){
   const layer=this.options.signals;
   if(['all','BARRIER_DAMAGE'].includes(layer))for(const slot of this.current.slots){
    const damage=Math.max(0,1-slot.junction);if(damage<=.02)continue;
    const p=this.project(worldPos(slot.x,slot.y,.78));ct.strokeStyle='#FF8175';ct.lineWidth=3+damage*3;
    ct.beginPath();ct.moveTo(p.x-5,p.y-6);ct.lineTo(p.x,p.y);ct.lineTo(p.x-3,p.y+6);ct.stroke();
    const cellPoint=this.displayPoints.find(q=>q.id===slot.cell);
    if(layer==='BARRIER_DAMAGE'&&cellPoint){
     ct.setLineDash([9,5]);ct.beginPath();ct.arc(cellPoint.s.x,cellPoint.s.y,cellPoint.r+13,0,Math.PI*2);ct.stroke();ct.setLineDash([]);
    }
    this.diagnosticMarkers.push({cell:slot.cell,kind:'BARRIER_DAMAGE',value:damage});
   }
   if(['CELL_DAMAGE','LT','ST'].includes(layer))for(const p of this.displayPoints){
    const c=this.currentById.get(p.id),value=layer==='CELL_DAMAGE'?cellDamage(c):(c.unified?.local?.[layer]??0);
    if(value<=0)continue;
    ct.strokeStyle=layer==='LT'?'#43DDF0':layer==='ST'?'#BE98FF':'#FF8175';ct.lineWidth=2+Math.min(1,layer==='CELL_DAMAGE'?value:value*15)*3;
    ct.beginPath();ct.arc(p.s.x,p.s.y,p.r+11,0,Math.PI*2);ct.stroke();
    this.diagnosticMarkers.push({cell:c.id,kind:layer,value});
   }
  }
  const sel=this.displayPoints.find(p=>p.id===this.selected);
  if(sel){
   const pulse=this.options.reduced?0:(1+Math.sin(time*.004))*2;
   ct.strokeStyle='#143F40';ct.lineWidth=6;ct.beginPath();ct.arc(sel.s.x,sel.s.y,sel.r+8+pulse,0,Math.PI*2);ct.stroke();
   ct.strokeStyle='#FFF2BD';ct.lineWidth=3;ct.stroke();
  }
  if(this.arrival&&!this.replay){
   const dt=(time-this.arrival.start)/1000;
   if(dt>=0&&dt<5){const p=this.project(worldPos(this.arrival.x,surface(this.arrival.x)-.1,.9));
    ct.strokeStyle=`rgba(248,219,139,${Math.max(0,1-dt/5)})`;ct.lineWidth=3;ct.beginPath();ct.arc(p.x,p.y,24+(dt%1.5)*25,0,Math.PI*2);ct.stroke();
    this.bubble(this.arrival.title,p.x,p.y-45,'#F5DE9F','#3A5847');}
  }
  this.drawCallout(sel);
  if(this.options.actions){
   // Persistent screen-space markers stay readable even when zoomed out.
   for(const p of this.displayPoints){const m=this.currentById.get(p.id).manual;if(!m)continue;
    const preparing=m.events.some(e=>e.status==='running')||!!this.currentById.get(p.id).lab?.event,secreting=m.secreting;
    if(!preparing&&!secreting)continue;
    const pulse=this.options.reduced?0:(1+Math.sin(time*.004))*2;
    ct.fillStyle=secreting?'#69EDB9':'#FFDA78';ct.strokeStyle='#173F40';ct.lineWidth=2;
    ct.beginPath();ct.arc(p.s.x,p.s.y-p.r-7,4+pulse,0,Math.PI*2);ct.fill();ct.stroke();
   }
   const age=(time-this.transitionAt)/1000;
   if(age<4){
    let n=0;for(const p of this.displayPoints){const c=this.currentById.get(p.id);if(c.lastDecisionTick!==this.current.tick||['rest','maintain','patrol','migrate'].includes(c.action))continue;
     if(n++>20&&c.id!==this.selected)continue;
     const alpha=this.options.reduced?1:clamp(1-(age-2)/2);ct.globalAlpha=alpha;const cy=p.s.y-p.r-7-(this.options.reduced?0:Math.min(age,2)*10);
     this.drawGlyph(ACTIONS[c.action]?.icon??'signal',p.s.x,cy,hexColor(TYPES[c.type].color));ct.globalAlpha=1;
    }
   }
  }
  if(this.pending?.valid&&this.pending.kind!=='resolve'){
   const p=this.project(worldPos(this.pending.x,surface(this.pending.x)-.01,.5));ct.strokeStyle='#F5DA96';ct.lineWidth=2;ct.setLineDash([5,5]);ct.beginPath();ct.ellipse(p.x,p.y,28,18,0,0,Math.PI*2);ct.stroke();ct.setLineDash([]);
   this.bubble('Click to place here',p.x,p.y-38,'#FCF0CD','#725A40');
  }
 }
 drawCallout(point){
  const c=this.currentById.get(this.selected),box=this.callout;
  box.hidden=!c||!point||this.pending!==null||point.s.z>1||point.s.z< -1||point.s.x<0||point.s.x>this.w||point.s.y<0||point.s.y>this.h;
  if(box.hidden)return;
  if(this.calloutFrame!==this.current||this.calloutCell!==c.id||this.calloutReplay!==this.replay){
   this.calloutFrame=this.current;this.calloutCell=c.id;this.calloutReplay=this.replay;
   const model=cellDecision(c,this.current,this.replay),nodes=[];
   const el=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls;n.textContent=text;return n;};
   nodes.push(el('div','calloutClock',model.clock),el('strong','calloutName',model.name));
   for(const row of model.rows){const n=el('div',`calloutRow ${row.tone}`,row.text);
    if(row.detail)n.append(el('small','calloutDetail',row.detail));
    if(row.progress!==undefined){const track=el('div','calloutProgress',''),fill=el('i','','');fill.style.width=`${row.progress*100}%`;track.append(fill);n.append(track);}
    nodes.push(n);
   }
   if(model.note)nodes.push(el('p','calloutNote',model.note));
   box.replaceChildren(...nodes);
  }
  const bw=box.offsetWidth,bh=box.offsetHeight,gap=point.r+22,pad=10;
  const x=clamp(point.s.x-bw/2,pad,Math.max(pad,this.w-bw-pad));
  // Keep the HUD and camera controls free. Flip below near the top edge.
  let y=point.s.y-gap-bh;if(y<70)y=point.s.y+gap;
  y=clamp(y,70,Math.max(70,this.h-bh-48));
  box.style.transform=`translate(${Math.round(x)}px,${Math.round(y)}px)`;
  const above=y+bh/2<point.s.y,endY=above?y+bh:y,endX=clamp(point.s.x,x+16,x+bw-16);
  const ct=this.ctx;ct.strokeStyle='#FFF2BD';ct.lineWidth=2;ct.beginPath();ct.moveTo(point.s.x,point.s.y+(above?-1:1)*(point.r+10));ct.lineTo(endX,endY);ct.stroke();
 }
 drawGlyph(kind,x,y){
  const c=this.ctx;c.fillStyle='#FFFCF2';c.strokeStyle='#FFFFFF';c.lineWidth=1;c.beginPath();c.arc(x,y,10,0,Math.PI*2);c.fill();c.save();c.translate(x,y);c.strokeStyle='#536D60';c.fillStyle='#536D60';c.lineWidth=1.5;c.beginPath();
  if(kind==='shield'){c.moveTo(0,-5);c.lineTo(4,-3);c.lineTo(3,3);c.lineTo(0,5);c.lineTo(-3,3);c.lineTo(-4,-3);c.closePath();c.stroke();}
  else if(kind==='drop'){c.moveTo(0,-5);c.bezierCurveTo(7,3,2,7,0,5);c.bezierCurveTo(-5,5,-4,0,0,-5);c.fill();}
  else if(kind==='alarm'){c.moveTo(0,-5);c.lineTo(0,1);c.stroke();c.beginPath();c.arc(0,4,1,0,7);c.fill();}
  else if(kind==='heart'){c.moveTo(0,4);c.bezierCurveTo(-8,-1,-3,-6,0,-2);c.bezierCurveTo(3,-6,8,-1,0,4);c.fill();}
  else if(kind==='target'){c.arc(0,0,5,0,7);c.moveTo(-6,0);c.lineTo(6,0);c.moveTo(0,-6);c.lineTo(0,6);c.stroke();}
  else if(kind==='eat'){c.arc(0,0,5,.5,Math.PI*2-.5);c.lineTo(0,0);c.closePath();c.fill();}
  else if(kind==='mesh'){for(let i=-3;i<=3;i+=3){c.moveTo(i,-5);c.lineTo(i,5);c.moveTo(-5,i);c.lineTo(5,i);}c.stroke();}
  else if(kind==='fade'){c.arc(0,0,4,0,7);c.stroke();c.moveTo(-2,0);c.lineTo(2,0);c.stroke();}
  else{for(let i=1;i<=3;i++){c.moveTo(-3+i*2,0);c.arc(-3,0,i*2,-.85,.85);c.stroke();}}
  c.restore();
 }
 bubble(text,x,y,bg,fg){
  const c=this.ctx;c.font='600 10px system-ui, sans-serif';const width=c.measureText(text).width+16;
  c.fillStyle=bg;c.beginPath();c.roundRect(x-width/2,y-9,width,21,7);c.fill();c.fillStyle=fg;c.textAlign='center';c.fillText(text,x,y+5);
 }
 arrow(c,x,y,xx,yy){const a=Math.atan2(yy-y,xx-x);c.beginPath();c.moveTo(x,y);c.lineTo(xx,yy);c.moveTo(xx-4*Math.cos(a-.5),yy-4*Math.sin(a-.5));c.lineTo(xx,yy);c.lineTo(xx-4*Math.cos(a+.5),yy-4*Math.sin(a+.5));c.stroke();}
}
