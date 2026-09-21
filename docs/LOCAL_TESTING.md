# Local testing and Jev diagnostics

See [README](../README.md) for exact installation, server, recording and playback
commands. The full runner is `python scripts/check_all.py` using Python 3.12+ and
Node.js 22+. `--skip-browser` is explicitly a partial check. All test transports
are fixtures. Browser tests run the actual local adapter and WebGL renderer with
synthetic upstream answers. No live Jev test is part of automation.

## Inspecting injury and toxins

If port 8000 is occupied, run `python3 server.py --port 0` and open the local
address printed by the server. Reload the page after rebuilding or updating it.

The four readouts above the tissue separate **Barrier damage** (junction loss),
**Cell damage** (cell health loss), **LT** and **ST** (peak local epithelial
exposure). Click a readout to select its display layer and most affected cell.
Red broken rings locate damaged junctions; cyan and purple rings locate recorded
LT and ST exposure. Field brightness is a display scale, not a concentration unit.

After a fresh reset, introduce **Tissue injury** at 50%. The initial model state
affects six epithelial cells: the core has health 20 and 80% cell damage, with
less damage toward the edge. Barrier damage also peaks at 80%. Distant cells
retain their original health; LT/ST stay zero. Select **Cell damage** to inspect
the wound core or **Barrier damage** to inspect the junctions. These are proposed
demonstration severities, not calibrated biological measurements. Later repair
and conditional death require the existing manual decisions and clocks.

For LT/ST, reset and introduce **ETEC**. Toxin appears after bacteria reach the
epithelium and colonize; it is not added by Tissue injury or EPEC. Advance biological
time and inspect the LT/ST readouts. A run stopped by its request cap cannot
continue toward toxin production. In deterministic fixture checks, local toxin
exposure was positive by 30 minutes; this is not a timing guarantee for live runs.

For a no-key visual check, open `player.html`, load the bundled ETEC fixture and
seek forward, then choose **LT**. Earlier recordings lack a toxin field grid;
the updated player still draws exposure rings from their saved per-cell values
and explicitly identifies the missing grid. No biology is recomputed on playback.

## Probability contract

The official [Choice documentation](https://docs.typesafe.ai/primitives/choice)
defines a map with one probability per requested option, a selected maximum and
confidence between zero and one. The [API](https://docs.typesafe.ai/api) uses
`answers`, matching question IDs, `type: choice`, `choice`, `probabilities` and
`confidence`, plus actual model and usage. Review recorded documentation sources
in `typesafe_sources.json` when updating the adapter.

The old “Invalid probabilities.” message came from `server.validate_answer`: it
combined invalid numeric values and nonunit sums into one error. No original raw
failing response was supplied, so the exact malformed value from that incident
cannot be reconstructed. The release validates option coverage, JSON numeric
types (excluding booleans), finite range [0,1], sum within 0.000001, selected maximum,
confidence, model identity and token usage. The host enforces the same distribution
contract before any mutation. Valid values are retained exactly. Invalid values
are not normalized, coerced, clipped, completed or replaced by a fallback policy.

Errors now identify the cell and failed condition without echoing raw provider
content. A malformed distribution saves a partial episode, retains the last
accepted physical state and returned usage, and stops playback of live biology.
The failing round is not retried automatically. Prior successful rounds remain
in the recording. Inspect `request_audit` for safe error metadata; restarting a
scenario requires a deliberate reset.

Regression coverage includes missing/extra options, arrays, null, strings,
booleans, NaN, infinity, huge integers, out-of-range values, zero/nonunit sums,
nonmaximal choices, invalid confidence, full-round atomicity and visible browser
failure with saveable partial output. Every fixture input is synthetic.

## Usage and real responses

A configuration badge is not evidence of inference. A cell response includes
model, timestamp, probabilities and local menu. The episode associates these with
started/rejected events and completion receipts. Model confidence is not a claim
that the biology is correct. The supplied recordings are fixtures only.

`python3 server.py --check-jev` is an explicit, potentially paid, one-request
connection check with no retry. It is never run automatically. Live recordings
require `--provider jev` and an explicit chosen request budget. The server defaults
to pinned model `jev-1.13.0`, batch size 20, at most three attempts for specifically
retryable HTTP failures, and a 600-request session cap. Ambiguous transport failures
are not retried; their usage remains unknown. Resetting a tissue does not reset
the server session cap.

Opening the studio from file only allows inspection; decisions need the loopback
server. Opening the player from file is the intended offline workflow. The player
has a restrictive connection policy and tests verify zero requests while loading,
playing, seeking and inspecting recordings.
