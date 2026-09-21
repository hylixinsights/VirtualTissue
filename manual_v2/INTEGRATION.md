# Virtual tissue integration guide

Version 2.0.0. Adult human ileal microdomain. One agent is one individual cell.

## What can run immediately

The registry is executable input for the included native JavaScript rule kernel. It contains 28 cell type or state entries, 55 action contracts, 28 duration models and 55 explicit numerical settings. The numbers are proposed demonstration settings, not fitted human measurements.

The kernel evaluates eligibility, scores and initiation hazards. It samples event starts and durations, tracks channel locks, reserves resources and targets, advances or interrupts events, and produces completion transactions. Physical effects are not silently simulated. The host must implement the capabilities named by each action.

The existing HTML applications were not modified. Their old action labels cannot all be translated directly. In particular, an epithelial action that previously recruited a neutrophil now only permits chemokine induction. Vascular entry remains a separate host transaction.

## Run the software checks

The package was tested with Node 22.16.0. It has no external JavaScript dependencies and makes no network requests.

```bash
node test_kernel.mjs
node run_demo.mjs
```

The first command writes `test_report.json`. The second writes `demo_trace.json` and runs one synthetic epithelial cell through delayed induction and finite output. It is a small integration demonstration, not a 100 cell tissue simulation. The tests use mock host receipts and do not validate real tissue mechanics or biological outcomes.

## Files to load

`virtual_tissue_rules_v2.json` is the authoritative operational registry. `virtual_tissue_rules_v2.schema.json` defines its structure. `virtual_tissue_kernel.mjs` is the runtime reference. `example_snapshot.json` is an explicitly synthetic input for one epithelial action. `data_manifest.json` identifies source data to retrieve and filter before biological initialization. The DOCX explains the evidence, calculations and assumptions.

```javascript
import { RuleKernel, validateRegistry } from './virtual_tissue_kernel.mjs';

const response = await fetch('./virtual_tissue_rules_v2.json');
if (!response.ok) throw new Error('Registry could not be loaded');
const registry = await response.json();
validateRegistry(registry);

const kernel = new RuleKernel(registry, {
  seed: 21,
  profile: 'demonstration',
  capabilities: [
    'immutable_snapshot',
    'unique_cell_ids',
    'atomic_commit',
    'event_log',
    'resource_ledger',
    'field_transport'
  ]
});
```

Declare a capability only after the host implements it. The example above enables a narrow field based induction route, not epithelial mechanics or recruitment. Browser modules should be served through the application's existing server rather than opened through an unsupported local file import.

## Snapshot contract

Each snapshot has `tick`, `revision`, `time_min`, `cell`, `context` and `signals`. The cell contains a stable string identifier and a dictionary type identifier. Biological time is in minutes. Positions, where used by the host, are in micrometers. The registry lists required feature paths and their missing value policies.

A missing gate feature denies the action. A missing score feature raises an explicit error. Do not fill every receptor or physical permission with true just to make events appear. Sparse RNA zeros must not be silently interpreted as confirmed absence; uncertain competence needs an explicit initialization policy and provenance.

The core reads the supplied snapshot, not the full tissue or hidden pathogen locations. Contacts, intracellular access, antigen recognition, basement support and migration routes are host verified inputs. The example snapshot is a software fixture and must not be mistaken for a measured cell.

## One tissue update

Update physical fields and contacts first, with their own stable solver substeps. Build one immutable sensing snapshot for all cells. Call `kernel.plan(snapshot, decisionIntervalMinutes)` for each cell. Gather all proposals, sort globally by proposed start time, resolve reproducible ties and start each accepted event with `kernel.start`.

The returned start time can fall inside the next decision interval. Do not call `advance` with a time earlier than that event's `started_at`. Advance to the interval endpoint using a fresh continuation context. Inputs are treated as constant over the interval where the numerical approximation requires it. Reduce the interval when that assumption is inadequate.

```javascript
const proposals = kernel.plan(snapshot, dtMinutes);
for (const proposal of proposals) {
  kernel.start(proposal.action_id, snapshot, {
    start_min: proposal.proposed_start_min,
    proposal
  });
}

// continuationSnapshot is supplied by your host, at the interval endpoint.
for (const event of kernel.activeEvents(snapshot.cell.id)) {
  const result = kernel.advance(
    event.id,
    continuationSnapshot,
    continuationSnapshot.time_min
  );
  if (!result.transaction_id) continue;
  // result is a pending completion plan, not an already applied effect.
}
```

This pattern illustrates the interface. A multi cell host also needs global reservation ordering, field deposition and physical conflict resolution. The test suite does not implement those host functions on your behalf.

## Atomic completion

A completion plan contains state assignments, typed physical intents, reserved costs and an event identifier. The host must recheck its physical preconditions, apply every effect and resource debit together, increment the tissue revision and then acknowledge. A failed transaction changes nothing. It can remain pending or be explicitly cancelled with a logged reason.

```javascript
// After your host has successfully applied the entire transaction:
kernel.acknowledge(plan.event_id, {
  transaction_id: plan.transaction_id,
  committed: true,
  next_revision: newTissueRevision,
  applied_at: biologicalTimeMinutes
});
```

Do not acknowledge a failed or partially applied transaction. Do not debit resources at start and again at completion. Reservations reduce availability, not total inventory. On successful completion the host consumes the reserved amount once. On cancellation total inventory stays unchanged and the reservation is released.

The same event must not be acknowledged under a different transaction identifier. Previous snapshots are rejected after acknowledgment. Engulfed targets are retired so two agents cannot consume the same extracellular object.

## Continuous processes and physical helpers

`exactMemory` updates a normalized exposure memory for a constant activity interval. `receptorActivity` evaluates a supplied concentration response with explicit competence. `boundedFlux` converts a rate and duration into an amount limited by available substrate. The host chooses the substrate source and applies the matching ledger.

`diffuse2D` covers an equal volume two dimensional grid with closed outer boundaries, diffusion and first order decay. It uses stable substeps and reports a mass diagnostic. It does not implement membrane permeability, matrix binding, perfusion, advection or a full mucus layer. Do not declare those processes implemented merely because this helper runs.

Protein induction changes an output or synthesis capacity. In particular, `IL1B_PRIMING` enables pro IL1B synthesis capacity; bounded host synthesis must fill the precursor store before active release is permitted. A gene score cannot directly refill a whole protein store.

## Human and mouse overlays

The default species is human. The human epithelial intracellular alarm requires the corresponding CASP4 competence and intracellular access. The mouse epithelial NAIP/NLRC4 action is disabled by default and requires a separate species context. These are scoped experimental mechanisms, not universal claims about every infection or every human cell.

Optional matrix, antibody, endocrine, type 2 and specialized transport actions are disabled unless explicitly enabled and implemented. Specialized functions of a dictionary cell type need not be active merely because the cell is present in the initial roster.

## Optional model provider

The provider request uses `tick`, `revision` and `cells`, consistent with the inspected batch boundary but with a stricter response contract. Each cell receives only permitted actions, their channels and local sensed inputs. A response includes the same tick and revision and a decision array.

`validateProviderResponse` rejects stale revisions, duplicate or unknown cells, unlicensed actions and attempts to set durations or hazards. Provider confidence is not a biological rate. Keep provider calls outside the physics and clock layer. No provider service is integrated or invoked by this package.

## First host integration target

Connect epithelial CXCL8 induction and finite goblet or Paneth release first. Verify the event log, explicit biological time and resource accounting. Add one contact dependent macrophage action and then a vascular entry route. Keep unrelated actions disabled until their host effects pass tests.

The immediate goal is a correct, inspectable decision layer. Parameter fitting, a validated 100 cell tissue trajectory and patient specific prediction remain separate scientific tasks.
