import {surface, GRID} from './engine.mjs';
import {MANUAL_HOST_MANIFEST} from './manual-parameters.mjs';

const geometry=MANUAL_HOST_MANIFEST.geometry;
export const MANUAL_FIELDS={TNF:'basal',SECRETORY_STIMULUS:'apical',CXCL8:'basal',MUCUS:'apical'};
export class CompartmentFields {
  constructor(){
    this.w=geometry.grid_width;this.h=geometry.grid_height;this.volume=geometry.effective_voxel_volume_pL;
    this.side=Array.from({length:this.w*this.h},(_,i)=>(Math.floor(i/this.w)+.5)/this.h<surface((i%this.w+.5)/this.w)?'apical':'basal');
    this.values=Object.fromEntries(Object.keys(MANUAL_FIELDS).map(k=>[k,new Float64Array(this.w*this.h)]));
    this.ledger=Object.fromEntries(Object.keys(MANUAL_FIELDS).map(k=>[k,{deposited:0,decayed:0,initial:0}]));
    this.edges=[];
    for(let y=0;y<this.h;y++)for(let x=0;x<this.w;x++){
      const i=y*this.w+x;
      if(x+1<this.w&&this.side[i]===this.side[i+1])this.edges.push([i,i+1,geometry.dx_um**2]);
      if(y+1<this.h&&this.side[i]===this.side[i+this.w])this.edges.push([i,i+this.w,geometry.dy_um**2]);
    }
  }
  nearest(x_um,y_um,side){
    let found=-1,best=Infinity;
    for(let i=0;i<this.side.length;i++)if(this.side[i]===side){
      const d=((i%this.w+.5)*geometry.dx_um-x_um)**2+((Math.floor(i/this.w)+.5)*geometry.dy_um-y_um)**2;
      if(d<best){best=d;found=i;}
    }
    if(found<0)throw new Error('No accessible compartment voxel.');return found;
  }
  deposit(field,index,amount){
    if(!this.values[field]||this.side[index]!==MANUAL_FIELDS[field]||!Number.isFinite(amount)||amount<0)throw new Error('Invalid compartment deposition.');
    this.values[field][index]+=amount/this.volume;this.ledger[field].deposited+=amount;
  }
  amount(field){return this.values[field].reduce((a,b)=>a+b,0)*this.volume;}
  advance(dt,{D=MANUAL_HOST_MANIFEST.transport.D_um2_per_min,decay=Math.LN2/MANUAL_HOST_MANIFEST.transport.half_life_min}={}){
    if(![dt,D,decay].every(x=>Number.isFinite(x)&&x>=0))throw new Error('Invalid field interval.');
    const n=Math.max(1,Math.ceil(dt*D*(2/geometry.dx_um**2+2/geometry.dy_um**2)/.45)),h=dt/n;
    for(const field of Object.keys(this.values)){
      let a=this.values[field];const before=this.amount(field);
      for(let s=0;s<n;s++){
        const b=a.slice();
        for(const [i,j,spacing2] of this.edges){const transfer=D*h*(a[j]-a[i])/spacing2;b[i]+=transfer;b[j]-=transfer;}
        a=b;
      }
      const loss=Math.exp(-decay*dt);
      for(let i=0;i<a.length;i++){
        a[i]*=loss;
        if(!Number.isFinite(a[i])||a[i]<0)throw new Error('Unstable field transport; no clipping applied.');
      }
      this.values[field]=a;this.ledger[field].decayed+=before*(1-loss);
    }
    return n;
  }
  display(){
    const result={pathogen:new Array(GRID.w*GRID.h).fill(0)};
    for(const [name,a]of Object.entries(this.values)){
      const scale=MANUAL_HOST_MANIFEST.visualization[`${name}_scale`];
      result[name]=Array.from({length:GRID.w*GRID.h},(_,i)=>{
        const x=(i%GRID.w)/(GRID.w-1),y=Math.floor(i/GRID.w)/(GRID.h-1);
        const side=y<surface(x)?'apical':'basal';if(side!==MANUAL_FIELDS[name])return 0;
        const index=Math.min(this.h-1,Math.floor(y*this.h))*this.w+Math.min(this.w-1,Math.floor(x*this.w));
        return 1-Math.exp(-a[index]*scale);
      });
    }
    return result;
  }
  audit(){return Object.fromEntries(Object.keys(this.values).map(k=>[k,{...this.ledger[k],present:this.amount(k),residual:this.ledger[k].initial+this.ledger[k].deposited-this.ledger[k].decayed-this.amount(k)}]));}
}
