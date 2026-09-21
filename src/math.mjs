/* Minimal column major linear algebra for the dependency free WebGL renderer. */
export const V3={
 sub:(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],
 add:(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]],
 dot:(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],
 cross:(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],
 norm:a=>{const n=Math.hypot(...a)||1;return a.map(v=>v/n);}
};
export const M4={
 identity:()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],
 mul:(a,b)=>{const o=Array(16).fill(0);for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)o[c*4+r]+=a[k*4+r]*b[c*4+k];return o;},
 transform:(m,p)=>{const v=[...p,1];return [0,1,2,3].map(r=>v.reduce((s,x,k)=>s+x*m[k*4+r],0));},
 trs:(p,s=[1,1,1],rot=0)=>{const c=Math.cos(rot),n=Math.sin(rot);return [c*s[0],n*s[0],0,0,-n*s[1],c*s[1],0,0,0,0,s[2],0,p[0],p[1],p[2],1];},
 perspective:(fov,aspect,near=.1,far=120)=>{const f=1/Math.tan(fov/2),nf=1/(near-far);return [f/aspect,0,0,0,0,f,0,0,0,0,(far+near)*nf,-1,0,0,2*far*near*nf,0];},
 lookAt:(eye,target)=>{const z=V3.norm(V3.sub(eye,target)),x=V3.norm(V3.cross([0,1,0],z)),y=V3.cross(z,x);return [x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-V3.dot(x,eye),-V3.dot(y,eye),-V3.dot(z,eye),1];}
};
export function hexColor(s,alpha=1){const n=parseInt(s.replace('#',''),16);return [(n>>16&255)/255,(n>>8&255)/255,(n&255)/255,alpha];}
export function mixColor(a,b,t){return a.map((v,i)=>v+(b[i]-v)*t);}
