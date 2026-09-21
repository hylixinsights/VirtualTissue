/**
 * Virtual tissue rule kernel 2.0.0.
 * Native JavaScript ES module, no network and no dependencies.
 * This is an event and constraint kernel, NOT a fitted tissue or pathogen model.
 * Host physics is deliberately represented by typed, acknowledged transactions.
 */
export class RuleError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'RuleError'; this.code = code; this.details = details; }
}
const BAD_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const copy = x => JSON.parse(JSON.stringify(x));
function demand(test, code, text, details) { if (!test) throw new RuleError(code, text, details); }
function finite(x, name = 'number') { demand(typeof x === 'number' && Number.isFinite(x), 'NONFINITE_VALUE', `${name} must be a finite number`); return x; }
function nonnegative(x, name) { finite(x, name); demand(x >= 0, 'NEGATIVE_VALUE', `${name} must be nonnegative`); return x; }
function pathParts(path) { demand(typeof path === 'string' && path.length > 0, 'BAD_PATH', 'A nonempty path is required'); const p = path.split('.'); demand(p.every(k => k && !BAD_KEYS.has(k)), 'UNSAFE_PATH', 'Unsafe object path'); return p; }
export function readPath(object, path) {
  let x = object;
  for (const p of pathParts(path)) {
    if (x === null || typeof x !== 'object' || !Object.hasOwn(x, p)) return undefined;
    x = x[p];
  }
  return x;
}
export function writePath(object, path, value) {
  const parts = pathParts(path); let obj = object;
  for (const p of parts.slice(0, -1)) { if (!Object.hasOwn(obj, p)) obj[p] = {}; demand(obj[p] !== null && typeof obj[p] === 'object', 'BAD_PATH', 'Cannot descend through a scalar'); obj = obj[p]; }
  obj[parts.at(-1)] = value;
}
export function seededRandom(seed = 1) {
  demand(Number.isInteger(seed), 'BAD_SEED', 'Seed must be an integer'); let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return (((t ^ t >>> 14) >>> 0) + 0.5) / 4294967296; };
}
function unitRandom(rng) { const u = finite(rng(), 'random draw'); demand(u > 0 && u < 1, 'BAD_RANDOM_DRAW', 'RNG must return an open interval (0,1) value'); return u; }
export function parameter(registry, ref) {
  demand(Object.hasOwn(registry.parameters, ref), 'UNKNOWN_PARAMETER', `Unknown parameter ${ref}`); return finite(registry.parameters[ref].value, ref);
}
export function evaluatePredicate(predicate, environment, registry) {
  if (Object.hasOwn(predicate, 'all')) return predicate.all.every(p => evaluatePredicate(p, environment, registry));
  if (Object.hasOwn(predicate, 'any')) return predicate.any.some(p => evaluatePredicate(p, environment, registry));
  const left = readPath(environment, predicate.path);
  if (left === undefined || left === null) return false; // Missing does not mean biological zero.
  const right = Object.hasOwn(predicate, 'param') ? parameter(registry, predicate.param) : predicate.value;
  switch (predicate.op) {
    case 'eq': return left === right;
    case 'in': demand(Array.isArray(right), 'BAD_PREDICATE', 'in requires an array'); return right.includes(left);
    case 'gte': case 'gt': case 'lte': case 'lt':
      if (typeof left !== 'number' || !Number.isFinite(left)) return false;
      finite(right, 'predicate threshold');
      return predicate.op === 'gte' ? left >= right : predicate.op === 'gt' ? left > right : predicate.op === 'lte' ? left <= right : left < right;
    default: throw new RuleError('UNKNOWN_OPERATOR', `Unknown operator ${predicate.op}`);
  }
}
export function logistic(z) { finite(z, 'score'); return z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)); }
export function actionHazard(action, environment, registry) {
  let score = parameter(registry, action.hazard.intercept_ref);
  for (const term of action.hazard.terms) {
    const x = readPath(environment, term.path);
    demand(typeof x === 'number' && Number.isFinite(x), 'MISSING_SCORE_FEATURE', `Missing or invalid feature ${term.path}`);
    score += x * parameter(registry, term.weight_ref);
  }
  const base = nonnegative(parameter(registry, action.hazard.base_rate_ref), 'base hazard');
  return { score, hazard_per_minute: base * logistic(score) };
}
export function eventProbability(totalHazard, dt) { nonnegative(totalHazard, 'hazard'); nonnegative(dt, 'dt'); return -Math.expm1(-totalHazard * dt); }
export function sampleCompeting(candidates, dt, rng = seededRandom()) {
  nonnegative(dt, 'dt');
  const H = candidates.reduce((s, c) => s + nonnegative(c.hazard_per_minute, 'hazard'), 0);
  if (H === 0 || dt === 0) return null;
  const waiting = -Math.log(unitRandom(rng)) / H;
  if (waiting > dt) return null;
  const u = unitRandom(rng) * H; let sum = 0;
  for (const c of candidates) { sum += c.hazard_per_minute; if (u < sum) return { action_id: c.action_id, waiting_minutes: waiting, total_hazard: H }; }
  return { action_id: candidates.at(-1).action_id, waiting_minutes: waiting, total_hazard: H };
}
export function sampleDuration(model, rng = seededRandom()) {
  demand(model.distribution === 'triangular' && model.unit === 'minute', 'UNSUPPORTED_DURATION', 'Only minute based triangular durations are supported');
  const a = nonnegative(model.lower, 'lower'), m = finite(model.mode, 'mode'), b = finite(model.upper, 'upper');
  demand(a <= m && m <= b, 'BAD_DURATION', 'Require lower <= mode <= upper');
  if (a === b) return a;
  const u = unitRandom(rng), f = (m - a) / (b - a);
  return u < f ? a + Math.sqrt(u * (b - a) * (m - a)) : b - Math.sqrt((1 - u) * (b - a) * (b - m));
}
export function exactMemory(previous, activity, tau, dt) {
  finite(previous); finite(activity); nonnegative(dt, 'dt'); demand(tau > 0 && Number.isFinite(tau), 'BAD_TAU', 'tau must be positive');
  demand(previous >= 0 && previous <= 1 && activity >= 0 && activity <= 1, 'UNNORMALIZED_MEMORY', 'Use normalized activity and memory in [0,1]');
  return activity + (previous - activity) * Math.exp(-dt / tau);
}
export function receptorActivity(concentration, K, hill = 1, competence = 1) {
  nonnegative(concentration, 'concentration'); demand(K > 0 && hill > 0 && Number.isFinite(K) && Number.isFinite(hill), 'BAD_RECEPTOR_PARAMETERS', 'K and Hill coefficient must be positive');
  demand(typeof competence === 'number' && competence >= 0 && competence <= 1, 'UNKNOWN_COMPETENCE', 'Functional competence must be explicitly assigned in [0,1]');
  return concentration === 0 ? 0 : competence * logistic(hill * Math.log(concentration / K));
}
export function boundedFlux(rate, capacity, dt, availableSubstrate) {
  [rate, capacity, dt, availableSubstrate].forEach(x => nonnegative(x, 'flux argument'));
  const amount = Math.min(rate * capacity * dt, availableSubstrate);
  return { amount, substrate_used: amount, substrate_remaining: availableSubstrate - amount };
}
export function diffuse2D(input, width, height, { D, dx, dy = dx, dt, decay = 0 }) {
  demand(Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0 && input.length === width * height, 'BAD_GRID', 'Grid dimensions do not match');
  nonnegative(D, 'D'); nonnegative(dt, 'dt'); nonnegative(decay, 'decay'); demand(dx > 0 && dy > 0 && Number.isFinite(dx) && Number.isFinite(dy), 'BAD_SPACING', 'Spacing must be positive');
  let c = Float64Array.from(input); c.forEach(x => nonnegative(x, 'concentration'));
  // No flux outer boundaries, equal voxel volumes, positivity preserving explicit diffusion.
  // Compartment interfaces, binding and advection are host extensions, not silently approximated here.
  const steps = Math.max(1, Math.ceil(dt * D * (2 / dx ** 2 + 2 / dy ** 2) / 0.9));
  demand(steps <= 1000000, 'EXCESSIVE_SUBSTEPS', 'Refine the solver choice rather than allocating unbounded substeps');
  const h = dt / steps, loss = Math.exp(-decay * h);
  const initial = c.reduce((a, b) => a + b, 0);
  for (let s = 0; s < steps; s++) {
    const next = new Float64Array(c.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x; let lap = 0;
      if (x > 0) lap += (c[i - 1] - c[i]) / dx ** 2;
      if (x + 1 < width) lap += (c[i + 1] - c[i]) / dx ** 2;
      if (y > 0) lap += (c[i - width] - c[i]) / dy ** 2;
      if (y + 1 < height) lap += (c[i + width] - c[i]) / dy ** 2;
      next[i] = (c[i] + D * h * lap) * loss;
      demand(next[i] >= -1e-14 && Number.isFinite(next[i]), 'NUMERICAL_FAILURE', 'Negative or nonfinite field; no silent clipping applied');
    }
    c = next;
  }
  return { values: c, substeps: steps, amount_before_proportional: initial, amount_after_proportional: c.reduce((a, b) => a + b, 0), decay_loss_expected: initial * (1 - Math.exp(-decay * dt)) };
}
export function validateRegistry(r) {
  demand(r?.metadata?.version === '2.0.0', 'SCHEMA_VERSION', 'This kernel accepts registry 2.0.0');
  demand(r.metadata.individual_cell_weight === 1 && r.metadata.fixed_population === false, 'CELL_SCALE', 'One agent represents one cell; population is not fixed');
  const ids = new Set();
  for (const [k, p] of Object.entries(r.parameters)) { finite(p.value, k); demand(p.evidence === 'P' && p.calibrated === false, 'MISLABELED_PRIOR', 'The distributed demonstration registry must retain its proposed labels'); }
  for (const a of r.actions) {
    demand(!ids.has(a.id), 'DUPLICATE_ACTION', a.id); ids.add(a.id);
    demand(r.duration_models[a.duration_ref], 'UNKNOWN_DURATION', a.duration_ref);
    parameter(r, a.hazard.base_rate_ref); parameter(r, a.hazard.intercept_ref); parameter(r, a.refractory_ref);
    a.hazard.terms.forEach(t => { pathParts(t.path); parameter(r, t.weight_ref); });
    a.costs.forEach(c => { pathParts(c.path); nonnegative(parameter(r, c.amount_ref), 'cost'); });
    a.cell_types.forEach(t => demand(r.cell_types[t], 'UNKNOWN_CELL_TYPE', t));
    a.evidence.source_refs.forEach(id => demand(r.references[id], 'UNKNOWN_REFERENCE', id));
    const check = q => { if (q.all) q.all.forEach(check); else if (q.any) q.any.forEach(check); else { pathParts(q.path); demand(['eq','in','gte','gt','lte','lt'].includes(q.op), 'UNKNOWN_OPERATOR', q.op); if (q.param) parameter(r,q.param); } };
    check(a.gate); check(a.trigger); check(a.continuation.recheck_predicate);
    a.completion_effects.forEach(e => { demand(['set','intent'].includes(e.op), 'UNKNOWN_EFFECT', e.op); if (e.op === 'set') pathParts(e.path); });
  }
  for (const [name, counts] of Object.entries(r.initial_presets)) {
    demand(Object.values(counts).every(n => Number.isInteger(n) && n >= 0) && Object.values(counts).reduce((a,b) => a+b, 0) === 100, 'BAD_ROSTER', name);
    Object.keys(counts).forEach(t => demand(r.cell_types[t], 'UNKNOWN_CELL_TYPE', t));
  }
  return { valid: true, actions: ids.size, cell_types: Object.keys(r.cell_types).length, parameters: Object.keys(r.parameters).length };
}
export class RuleKernel {
  constructor(registry, { seed = 1, capabilities = [], enabledExtensions = [], profile = 'demonstration' } = {}) {
    validateRegistry(registry);
    demand(profile === 'demonstration', 'UNCALIBRATED_RESEARCH_MODE', 'Research mode is not implemented by this uncalibrated reference kernel. Fit and validate a separate version.');
    this.registry = copy(registry); this.rng = seededRandom(seed); this.capabilities = new Set(capabilities); this.extensions = new Set(enabledExtensions);
    this.actions = new Map(this.registry.actions.map(a => [a.id, a])); this.events = new Map(); this.targetOwners = new Map(); this.retiredTargets = new Set(); this.nextId = 1; this.minimumRevision = new Map();
  }
  action(id) { demand(this.actions.has(id), 'UNKNOWN_ACTION', id); return this.actions.get(id); }
  checkSnapshot(s) {
    demand(s?.cell && typeof s.cell.id === 'string' && s.cell.id.length > 0, 'BAD_CELL_ID', 'Snapshot needs a stable cell id');
    demand(Number.isInteger(s.revision) && s.revision >= 0 && Number.isInteger(s.tick) && s.tick >= 0, 'BAD_REVISION', 'Snapshot needs nonnegative integer revision and tick');
    nonnegative(s.time_min, 'time_min'); demand(this.registry.cell_types[s.cell.type], 'UNKNOWN_CELL_TYPE', s.cell.type);
    demand(s.revision >= (this.minimumRevision.get(s.cell.id) ?? 0), 'STALE_SNAPSHOT', 'Snapshot predates an acknowledged transaction');
  }
  activeEvents(cellId) { return [...this.events.values()].filter(e => e.cell_id === cellId && ['running','paused','pending'].includes(e.status)); }
  environment(s, owner = null) {
    const env = copy(s);
    for (const e of this.activeEvents(s.cell.id)) if (e.id !== owner) for (const cost of e.reserved_costs) {
      const total = readPath(env, cost.path); if (typeof total === 'number') writePath(env, cost.path, total - cost.amount);
    }
    return env;
  }
  eligibility(actionId, s, now = s.time_min) {
    this.checkSnapshot(s); const a = this.action(actionId); const reasons = [];
    if (!a.enabled_by_default && !this.extensions.has(a.id)) reasons.push('EXTENSION_DISABLED');
    if (!a.cell_types.includes(s.cell.type)) reasons.push('LINEAGE_NOT_LICENSED');
    for (const c of [...this.registry.host_contract.required_for_any_execution, ...a.required_host_capabilities]) if (!this.capabilities.has(c)) reasons.push(`MISSING_CAPABILITY:${c}`);
    if (s.cell.viability === 'cleared') reasons.push('CELL_CLEARED');
    const active = this.activeEvents(s.cell.id);
    if (active.some(e => e.locks.some(l => a.exclusive_locks.includes(l)))) reasons.push('CHANNEL_LOCKED');
    const previous = [...this.events.values()].filter(e => e.cell_id === s.cell.id && e.action_id === a.id && e.status === 'acknowledged');
    if (previous.some(e => now < e.acknowledged_at + parameter(this.registry, a.refractory_ref))) reasons.push('REFRACTORY');
    const env = this.environment(s);
    if (!evaluatePredicate(a.gate, env, this.registry)) reasons.push('GATE_FAILED_OR_MISSING_INPUT');
    if (!evaluatePredicate(a.trigger, env, this.registry)) reasons.push('TRIGGER_FAILED_OR_MISSING_INPUT');
    if (a.exclusive_locks.includes('target')) {
      const target = s.context?.target_id;
      if (typeof target !== 'string' || !target) reasons.push('MISSING_TARGET_ID');
      else if (this.targetOwners.has(target) || this.retiredTargets.has(target)) reasons.push('TARGET_UNAVAILABLE');
    }
    if (a.id === 'VASCULAR_CROSSING' && typeof s.context?.crossing_slot_id !== 'string') reasons.push('MISSING_CROSSING_SLOT_ID');
    if (a.id === 'VASCULAR_CROSSING' && this.targetOwners.has(`vascular:${s.context.crossing_slot_id}`)) reasons.push('CROSSING_SLOT_RESERVED');
    if (reasons.length) return { action_id: a.id, allowed: false, reasons };
    const h = actionHazard(a, env, this.registry);
    return { action_id: a.id, allowed: true, reasons: [], channel: a.channel, initiation_policy: a.initiation_policy, ...h };
  }
  candidates(s) { return this.registry.cell_types[s.cell.type].allowed_actions.map(id => this.eligibility(id, s)); }
  plan(s, dt) {
    nonnegative(dt,'dt'); const candidates = this.candidates(s).filter(x => x.allowed), grouped = new Map(), proposals = [];
    for (const c of candidates) {
      if (c.initiation_policy === 'automatic_when_eligible') proposals.push({ action_id: c.action_id, waiting_minutes: 0, channel: c.channel });
      else { if (!grouped.has(c.channel)) grouped.set(c.channel,[]); grouped.get(c.channel).push(c); }
    }
    for (const [channel, group] of grouped) { const choice = sampleCompeting(group,dt,this.rng); if (choice) proposals.push({ ...choice, channel }); }
    // All proposals must still pass start(), because different channels can share a resource or lock.
    return proposals.map(p => ({ ...p, cell_id:s.cell.id, tick:s.tick, revision:s.revision, proposed_start_min:s.time_min+p.waiting_minutes })).sort((a,b) => a.proposed_start_min-b.proposed_start_min || a.action_id.localeCompare(b.action_id));
  }
  start(actionId, s, { start_min = s.time_min, proposal = null, initialized_duration = null, initialized_elapsed = 0 } = {}) {
    demand(start_min >= s.time_min && Number.isFinite(start_min), 'BAD_EVENT_TIME', 'Start cannot predate its sensing snapshot');
    if (proposal) demand(proposal.cell_id === s.cell.id && proposal.action_id === actionId && proposal.revision === s.revision && proposal.tick === s.tick, 'STALE_PROPOSAL', 'Proposal identity or revision mismatch');
    const candidate = this.eligibility(actionId,s,start_min); demand(candidate.allowed, 'ACTION_REJECTED', 'Action did not pass legality checks', candidate);
    const a = this.action(actionId); const env = this.environment(s);
    const reserved = a.costs.map(c => ({path:c.path,amount:parameter(this.registry,c.amount_ref)}));
    for (const cost of reserved) demand(readPath(env,cost.path) >= cost.amount, 'INSUFFICIENT_RESOURCE','Resource was already reserved');
    let duration = initialized_duration === null ? sampleDuration(this.registry.duration_models[a.duration_ref],this.rng) : nonnegative(initialized_duration,'initialized duration');
    const support = this.registry.duration_models[a.duration_ref];
    demand(duration >= support.lower && duration <= support.upper, 'DURATION_OUTSIDE_PRIOR', 'Historical full duration must be inside this versioned demonstration support; change the prior explicitly rather than bypassing it');
    demand(initialized_elapsed >= 0 && initialized_elapsed <= duration && Number.isFinite(initialized_elapsed), 'BAD_INITIAL_ELAPSED','Initialized elapsed time must fall inside its explicitly supplied duration');
    demand(initialized_duration !== null || initialized_elapsed === 0, 'BAD_INITIAL_EVENT', 'An aged event requires an explicit historical duration');
    const id = `event_${this.nextId++}`;
    const target = a.exclusive_locks.includes('target') ? s.context.target_id : a.id === 'VASCULAR_CROSSING' ? `vascular:${s.context.crossing_slot_id}` : null;
    const event = {id,action_id:actionId,cell_id:s.cell.id,cell_type:s.cell.type,status:'running',started_at:start_min,last_update:start_min,duration_min:duration,active_elapsed_min:initialized_elapsed,locks:[...a.exclusive_locks],reserved_costs:reserved,target_id:target,source_tick:s.tick,source_revision:s.revision,initialization_override:initialized_duration !== null,initial_context:copy(s.context ?? {})};
    if (target !== null) { demand(!this.targetOwners.has(target) && !this.retiredTargets.has(target),'TARGET_UNAVAILABLE','Target already owned'); this.targetOwners.set(target,id); }
    this.events.set(id,event); return copy(event);
  }
  getEvent(id) { demand(this.events.has(id),'UNKNOWN_EVENT',id); return this.events.get(id); }
  cancel(id, reason = 'explicit_host_cancellation') {
    const e = this.getEvent(id); demand(e.status !== 'acknowledged','ALREADY_COMMITTED','Committed events cannot be cancelled');
    if (e.status === 'cancelled') return copy(e);
    e.status = 'cancelled'; e.cancel_reason = reason;
    if (e.target_id && this.targetOwners.get(e.target_id) === id) this.targetOwners.delete(e.target_id);
    // Inventory never left the cell before completion. Releasing reservations is the refund.
    return copy(e);
  }
  advance(id, s, now = s.time_min) {
    this.checkSnapshot(s); const e = this.getEvent(id), a = this.action(e.action_id);
    demand(s.cell.id === e.cell_id,'EVENT_CELL_MISMATCH','Event belongs to another cell');
    demand(now >= e.last_update && Number.isFinite(now),'TIME_REVERSED','Biological time cannot move backwards');
    if (['acknowledged','cancelled'].includes(e.status)) return copy(e);
    if (s.cell.viability === 'cleared') return this.cancel(id,'cell_cleared');
    if (['death_committed','dead_present'].includes(s.cell.viability) && a.continuation.on_death === 'cancel') return this.cancel(id,'terminal_death_precedence');
    if (e.target_id && this.targetOwners.get(e.target_id) !== id) return this.cancel(id,'target_ownership_lost');
    if (a.exclusive_locks.includes('target') && s.context?.target_id !== e.target_id) return this.cancel(id,'target_identity_changed');
    const pass = evaluatePredicate(a.continuation.recheck_predicate,this.environment(s,id),this.registry);
    if (!pass && a.continuation.on_gate_loss === 'cancel') return this.cancel(id,'continuation_gate_lost');
    if (!pass && a.continuation.on_gate_loss === 'pause') { e.last_update=now; e.status=e.status==='pending'?'pending':'paused'; e.completion_blocked=true; return copy(e); }
    e.completion_blocked=false;
    if (e.status === 'pending') return this.completionPlan(id);
    const step = now - e.last_update, remaining = e.duration_min-e.active_elapsed_min;
    e.active_elapsed_min = Math.min(e.duration_min,e.active_elapsed_min+step); e.last_update=now;
    if (e.active_elapsed_min >= e.duration_min) { e.status='pending'; e.ready_at = now - Math.max(0,step-remaining); return this.completionPlan(id); }
    e.status='running'; return copy(e);
  }
  completionPlan(id) {
    const e=this.getEvent(id),a=this.action(e.action_id);
    demand(e.status==='pending' && !e.completion_blocked,'EVENT_NOT_COMPLETE','Event has not completed active time or its continuation is blocked');
    return {transaction_id:`${id}:complete`,event_id:id,cell_id:e.cell_id,action_id:e.action_id,target_id:e.target_id,source_revision:e.source_revision,ready_at:e.ready_at,reserved_costs:copy(e.reserved_costs),effects:copy(a.completion_effects),event_duration_min:e.duration_min,initial_context:copy(e.initial_context),required_host_capabilities:[...a.required_host_capabilities],instruction:'Recheck physical preconditions, apply all effects and resource consumption atomically, increment revision, then acknowledge. Failed transactions change nothing.'};
  }
  acknowledge(id, receipt) {
    const e=this.getEvent(id);
    if (e.status==='acknowledged') { demand(receipt?.transaction_id===`${id}:complete`,'BAD_RECEIPT','Receipt mismatch'); return {already_acknowledged:true,event:copy(e)}; }
    demand(e.status==='pending' && !e.completion_blocked,'EVENT_NOT_COMPLETE','No pending completion');
    demand(receipt?.committed===true && receipt.transaction_id===`${id}:complete` && Number.isInteger(receipt.next_revision) && receipt.next_revision>e.source_revision,'BAD_RECEIPT','An atomic host receipt with an advanced revision is required');
    demand(Number.isFinite(receipt.applied_at) && receipt.applied_at>=e.ready_at,'BAD_RECEIPT','Commit time precedes readiness');
    e.status='acknowledged';e.acknowledged_at=receipt.applied_at;e.receipt=copy(receipt);
    this.minimumRevision.set(e.cell_id,Math.max(this.minimumRevision.get(e.cell_id)??0,receipt.next_revision));
    if(e.target_id){if(e.action_id==='EFFEROCYTOSIS'||e.action_id==='PHAGOCYTOSIS')this.retiredTargets.add(e.target_id);this.targetOwners.delete(e.target_id);}
    return {already_acknowledged:false,event:copy(e)};
  }
}
export function validateProviderResponse(batch,response){
  demand(response?.tick===batch.tick&&response?.revision===batch.revision,'STALE_PROVIDER_RESPONSE','Provider response does not match tick and revision');
  demand(Array.isArray(batch.cells)&&Array.isArray(response.decisions),'BAD_PROVIDER_RESPONSE','Cells and decisions must be arrays');
  const cells=new Map(batch.cells.map(c=>[c.id,c])),seen=new Set();
  for(const d of response.decisions){demand(cells.has(d.id)&&!seen.has(d.id),'BAD_PROVIDER_CELL','Unknown or duplicate cell');seen.add(d.id);const c=cells.get(d.id);demand(c.allowed.includes(d.choice),'PROVIDER_UNLICENSED_ACTION','Choice is outside allowed actions');if(c.channels?.[d.choice])demand(d.channel===c.channels[d.choice],'PROVIDER_CHANNEL_MISMATCH','Wrong action channel');demand(!Object.hasOwn(d,'duration')&&!Object.hasOwn(d,'hazard')&&!Object.hasOwn(d,'latency'),'PROVIDER_OWNS_FORBIDDEN_FIELD','Provider cannot set biological clocks or hazards');}
  return true;
}
