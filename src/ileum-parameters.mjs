import {freezeSnapshot} from '../integration/manual_contract.mjs';

// Every number here is an illustrative P prior. Papers support mechanisms only.
export const ILEUM_MANIFEST = freezeSnapshot({
  version:'cellville.ileum.1.0.0', evidence:'P', calibrated:false,
  scope:'Human ileal cutaway; innate–epithelium–barrier experiment. Not a Crohn subtype, autoantigen model or full intestinal tract.',
  reference:'Two original Manual v2 handlers retained. ILEUM_* events and transport are separate proposed host extensions, not additional validated registry handlers.',
  population:'100 initial cells on the preserved six-class roster. Generic macrophages receive explicit synthetic innate competence, without a resident/inflammatory subtype mapping. NK and fibroblasts remain visual-only in this experiment.',
  species:'Escherichia coli, enteropathogenic (EPEC), E2348/69-inspired phenotype',
  pathogenesis:'Apical attachment, Tir–intimin intimate adhesion and attaching/effacing brush-border injury. No Shiga toxin, active intracellular invasion, or EPEC-specific clinical calibration.',
  ibd:'Local initial junction injury plus reduced resolution competence; background luminal microbial products can leak through damaged junctions and sustain a proposed myeloid TNF–injury loop. No external TNF source is required. Not a complete IBD model.',
  units:{time:'min',position:'normalized 2D tissue coordinates, converted to µm in snapshots',
    water:'NWU (normalized excess water amount); downstream water is a secretion proxy, not mL or stool output',
    innate:'PAMP, DAMP and resolution are normalized local activities on 50 epithelial patches, not molar cytokine concentrations',
    TNF_CXCL8:'Original NAU/NCU compartment accounting'},
  controls:{epec_count:24,initial_junction:.60,reduced_resolution:.08},
  bacteria:{attach_rate:.06,adhesion_min:10,replicate_rate:.004,replication_budget:72,max_agents:256,washout_rate:.0015,
    drift:.00035,brush_injury_rate:.009,junction_injury_rate:.0006,contact_radius:.028},
  innate:{activation_tau:15,tnf_rate:.065,tnf_budget_NAU:12,event_energy:.05,tnf_K:.035,damage_rate:.005,repair_rate:.007,
    brush_repair_rate:.003,luminal_PAMP:.50,signal_decay:.035,signal_diffusion:.06,reach:.05,speed:.0025,
    phagocytosis_min:6,processing_min:18,crossing_min:12,apical_crossing_min:8,efferocytosis_min:10,
    event_rate:.25,death_health:12,neutrophil_lifetime:240},
  fluid:{transit_rate:.12,water_reabsorption_rate:.035,initial_water_reservoir:100},
  numerical:'One minute operator splitting. Reference host advances first, extension responses become input to the next reference interval. All extension proposals use one snapshot; targets are revalidated and exclusively reserved before start. Display never consumes RNG.',
  references:[
    {id:'Shaw2005',url:'https://journals.asm.org/doi/10.1128/iai.73.2.1243-1251.2005',supports:'EPEC effectors, brush-border remodeling and A/E lesions in human small-intestinal organ culture; not kinetic values.'},
    {id:'Martin2019',url:'https://pmc.ncbi.nlm.nih.gov/articles/PMC7060942/',supports:'Human ileal inflammatory cellular associations. Does not establish or fit the reduced feedback circuit.'},
    {id:'Shen2023',url:'https://pmc.ncbi.nlm.nih.gov/articles/PMC10309577/',supports:'Human neutrophil segmented nuclear morphology.'},
    {id:'Honda2020',url:'https://www.nature.com/articles/s41467-020-15068-4',supports:'Intestinal macrophage spatial organization in mice; transfer to human depiction is T.'}
  ]
});
export const ILEUM_ACTIONS = freezeSnapshot({
  ILEUM_ADHESION:'Build Tir–intimin attachment',ILEUM_PHAGOCYTOSIS:'Engulf one EPEC',
  ILEUM_CARGO_PROCESSING:'Kill internalized EPEC',ILEUM_VASCULAR_CROSSING:'Cross the vascular boundary',
  ILEUM_APICAL_CROSSING:'Cross toward the luminal focus',ILEUM_EFFEROCYTOSIS:'Clear one dead cell'
});
export function parseIleumPrompt(text){
  const t=text.toLowerCase(),x=/right/.test(t)?.76:/center|centre/.test(t)?.5:.25;
  let kind=null;
  if(/cas[p]?4|shiga|salmonella|autoantigen/.test(t))return {valid:false,error:'This experiment implements EPEC attachment, innate ileitis only.'};
  if(/restore|resolution control/.test(t))kind='regulation';
  else if(/remove|stop|withdraw/.test(t))kind='resolve';
  else if(/epec|e\.?\s*coli/.test(t))kind=/adhesion.off|attachment.off/.test(t)?'epec_control':'epec';
  else if(/ileitis|ibd|persistent.*inflamm/.test(t))kind='ileitis';
  const descriptions={
    epec:['EPEC · attaching and effacing','Place 24 EPEC agents in the lumen. Intimate Tir–intimin attachment precedes brush-border injury.'],
    epec_control:['EPEC · attachment disabled','Matched bolus of 24 agents with the modeled intimate attachment route disabled; a mechanism control, not a named mutant.'],
    ileitis:['Persistent ileal inflammation','Apply one local junction injury and reduce local resolution competence. Background microbial products may sustain the innate–barrier feedback. No TNF source is added.'],
    regulation:['Restore local resolution','Restore resolution competence in the selected region. Existing injury, mediators and bacteria remain.'],
    resolve:['Stop further input','Stop reference stimulus sources and future bacterial replication. Existing bacteria, inflammation remain; the ileitis susceptibility is retained.']
  };
  if(!kind)return {valid:false,error:'Choose EPEC, persistent ileitis, restore resolution, or remove inputs.'};
  return {valid:true,kind,x,strength:1,title:descriptions[kind][0],description:descriptions[kind][1],note:'P: uncalibrated mechanistic experiment. Compare separate reset episodes with the same seed.'};
}
