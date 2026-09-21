/**
 * Cellville manual preintegration boundary, 0.1.0.
 * This is NOT a physical host and is deliberately not imported by app.mjs.
 * It prepares advisory per-channel questions and validates complete replies.
 * Reference hazards, event clocks and transactions stay in RuleKernel + host.
 * run_id is an explicit engineering addition, not a biological registry field.
 */
import { RuleError } from '../manual_v2/virtual_tissue_kernel.mjs';

const fail = (code, message) => { throw new RuleError(code, message); };
const insist = (condition, code, message) => { if (!condition) fail(code, message); };
const clone = value => structuredClone(value);
const pairKey = (id, channel) => JSON.stringify([id, channel]);
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = n => typeof n === 'number' && Number.isFinite(n);
const safeText = x => typeof x === 'string' && x.length > 0 && x.length <= 160 && !/[\u0000-\u001f]/.test(x);

export function freezeSnapshot(snapshot) {
  const frozen = clone(snapshot);
  const visit = value => {
    if (value && typeof value === 'object') {
      Object.values(value).forEach(visit);
      Object.freeze(value);
    }
  };
  visit(frozen);
  return frozen;
}

export function checkEpoch(epoch) {
  insist(record(epoch) && safeText(epoch.run_id), 'BAD_RUN_ID', 'A fresh run_id is required for every reset.');
  for (const key of ['tick', 'revision']) {
    insist(Number.isSafeInteger(epoch[key]) && epoch[key] >= 0, 'BAD_EPOCH', `Invalid ${key}.`);
  }
  insist(finite(epoch.time_min) && epoch.time_min >= 0, 'BAD_TIME', 'Biological time must be supplied in minutes.');
}

/** No legacy generic field or macrophage label is translated automatically. */
export function prepareAdvisoryBatch(kernel, snapshots, epoch) {
  checkEpoch(epoch);
  insist(Array.isArray(snapshots), 'BAD_SNAPSHOTS', 'Expected a snapshot array.');
  const ids = new Set(), cells = [], diagnostics = [];
  for (const raw of snapshots) {
    const s = freezeSnapshot(raw);
    kernel.checkSnapshot(s);
    insist(s.tick === epoch.tick && s.revision === epoch.revision && s.time_min === epoch.time_min,
      'INCONSISTENT_SNAPSHOT', 'All cells must share one sensing epoch.');
    insist(safeText(s.cell.id) && !ids.has(s.cell.id), 'DUPLICATE_CELL', 'Cell identifiers must be unique.');
    ids.add(s.cell.id);
    insist(record(s.provenance) && ['source_kind', 'scope', 'uncertainty'].every(k => safeText(s.provenance[k])),
      'MISSING_PROVENANCE', 'Source kind, scope and uncertainty are required.');
    const rows = kernel.candidates(s);
    diagnostics.push({ id: s.cell.id, candidates: rows });
    const legal = rows.filter(x => x.allowed);
    if (!legal.length) continue;
    const allowed = legal.map(x => x.action_id);
    const channels = Object.fromEntries(legal.map(x => [x.action_id, x.channel]));
    // Only features needed by these legal actions are exposed. Each field is
    // already a local host observation; the host must verify that locality.
    const needed = new Set();
    const paths = p => {
      if (p.all) p.all.forEach(paths);
      else if (p.any) p.any.forEach(paths);
      else needed.add(p.path);
    };
    for (const id of allowed) {
      const a = kernel.action(id);
      paths(a.gate); paths(a.trigger);
      a.hazard.terms.forEach(t => needed.add(t.path));
    }
    const get = path => {
      let v = s;
      for (const key of path.split('.')) {
        if (!record(v) || !Object.hasOwn(v, key)) return undefined;
        v = v[key];
      }
      return v;
    };
    const sensed_features = Object.fromEntries([...needed].filter(p => get(p) !== undefined).map(p => [p, clone(get(p))]));
    cells.push({ id: s.cell.id, type: s.cell.type, allowed, channels, sensed_features });
  }
  return { batch: { ...clone(epoch), policy: 'advisory_only', cells }, diagnostics };
}

/**
 * Enforces completeness PER (cell id, channel), unlike the reference helper
 * which allows omitted cells and disallows multiple decisions for one cell.
 * This function validates data only. It never starts or commits an event.
 */
export function validateCompleteChannelReply(batch, response, currentEpoch) {
  checkEpoch(batch); checkEpoch(currentEpoch);
  insist(record(response), 'BAD_REPLY', 'Expected a reply object.');
  const topKeys = new Set(['run_id', 'tick', 'revision', 'decisions']);
  insist(Object.keys(response).every(k => topKeys.has(k)), 'FORBIDDEN_REPLY_FIELD', 'Unexpected top-level reply field.');
  for (const key of ['run_id', 'tick', 'revision']) {
    insist(response[key] === batch[key] && currentEpoch[key] === batch[key], 'STALE_REPLY', 'Reply belongs to a different run or tissue revision.');
  }
  insist(currentEpoch.time_min === batch.time_min, 'STALE_TIME', 'Biological time advanced while the reply was pending.');
  insist(Array.isArray(batch.cells) && Array.isArray(response.decisions), 'BAD_REPLY', 'Expected cells and decisions arrays.');
  const expected = new Map(), ids = new Set();
  for (const cell of batch.cells) {
    insist(safeText(cell.id) && !ids.has(cell.id), 'DUPLICATE_REQUEST_CELL', 'Duplicate cell in request.');
    ids.add(cell.id);
    insist(Array.isArray(cell.allowed) && cell.allowed.length > 0 && record(cell.channels), 'BAD_REQUEST_MENU', 'Missing menu or channel map.');
    insist(new Set(cell.allowed).size === cell.allowed.length, 'BAD_REQUEST_MENU', 'Duplicate action in request.');
    for (const action of cell.allowed) {
      const channel = cell.channels[action];
      insist(safeText(action) && safeText(channel), 'BAD_REQUEST_MENU', 'Invalid action or channel identifier.');
      const key = pairKey(cell.id, channel);
      if (!expected.has(key)) expected.set(key, new Set());
      expected.get(key).add(action);
    }
  }
  const seen = new Set(), decisions = [];
  const decisionKeys = new Set(['id', 'choice', 'channel', 'confidence', 'probabilities']);
  for (const d of response.decisions) {
    insist(record(d) && Object.keys(d).every(k => decisionKeys.has(k)), 'FORBIDDEN_DECISION_FIELD', 'Provider cannot supply clocks, rates, effects or arbitrary fields.');
    insist(safeText(d.id) && safeText(d.channel), 'BAD_DECISION', 'Invalid cell id or channel.');
    const key = pairKey(d.id, d.channel), menu = expected.get(key);
    insist(menu && !seen.has(key), 'UNKNOWN_OR_DUPLICATE_CHANNEL', 'Unknown or duplicate cell/channel decision.');
    insist(menu.has(d.choice), 'UNLICENSED_ACTION', 'Choice is outside this channel menu.');
    seen.add(key);
    if (Object.hasOwn(d, 'confidence')) {
      insist(finite(d.confidence) && d.confidence >= 0 && d.confidence <= 1, 'BAD_CONFIDENCE', 'Invalid reported confidence.');
    }
    if (Object.hasOwn(d, 'probabilities')) {
      const p = d.probabilities;
      insist(record(p) && Object.keys(p).length === menu.size && [...menu].every(a => Object.hasOwn(p,a)),
        'BAD_DISTRIBUTION', 'Probability keys must equal this channel menu.');
      insist(Object.values(p).every(v => finite(v) && v >= 0 && v <= 1), 'BAD_DISTRIBUTION', 'Invalid probability value.');
      insist(Math.abs(Object.values(p).reduce((a,b) => a+b,0)-1) <= 0.002, 'BAD_DISTRIBUTION', 'Probabilities must sum to one.');
    }
    decisions.push(clone(d));
  }
  insist(seen.size === expected.size, 'INCOMPLETE_REPLY', 'One reply is required for each requested cell/channel.');
  return { ...clone(currentEpoch), decisions, causal_execution_permitted: false };
}
