// Operational baseline for the illustrative legacy game, not calibrated biology.
// Pure local sensing: no RNG, provider call, global scenario or state mutation.
export const ACTIVATION_POLICY = Object.freeze({
 version:'local-cues-v1', pathogen:.03, danger:.035, chemokine:.006,
 cytokine:.045, health:94, reserveChemokine:.0025, neighborRadius:.105, repairRadius:.14
});
export function activationFor(c,o){
 const reasons=[],p=ACTIVATION_POLICY;
 const above=(code,label,value,threshold)=>{if(value>threshold)reasons.push({code,label,value,threshold,comparison:'>'});};
 if(c.reserve){
  above('chemokine','Chemokine at the vessel',o.chemokine,p.reserveChemokine);
 }else{
  above('pathogen','Local pathogen contact',o.pathogen,p.pathogen);
  above('danger','Local damage signal',o.danger,p.danger);
  above('chemokine','Local chemokine',o.chemokine,p.chemokine);
  above('cytokine','Local cytokine',o.cytokine,p.cytokine);
  if(o.nearbyGap)reasons.push({code:'barrier',label:'Nearby barrier damage'});
  if(o.health<p.health)reasons.push({code:'injury',label:'Own cell damage',value:o.health,threshold:p.health,comparison:'<'});
  if(o.nearbyStressedCell)reasons.push({code:'neighbor',label:'Altered neighboring cell',cellId:o.stressedNeighborId});
  if(o.corpseId!==null&&o.corpseId!==undefined)reasons.push({code:'debris',label:'Nearby cell debris',cellId:o.corpseId});
 }
 return {active:reasons.length>0,reasons};
}
