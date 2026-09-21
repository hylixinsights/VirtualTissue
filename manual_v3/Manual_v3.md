# Manual v3 — Gut tissue

Version 3.0.0, application 6.1.1. Language: English. Target: an illustrative adult
human ileal mucosal microdomain. This is a reproducible mechanistic demonstration,
not a calibrated biological predictor. No parameter fitting or validation against
human experimental trajectories has been performed.

## Authority and executable rules

This manual, `constraints.json`, `model.json`, the selected tissue pack and the
physical host define one model. `constraints.json` contains 56 action contracts:
55 inherited reference contracts plus the proposed ETEC transport response.
`model.json` declares the 22 supported host handlers. A supported handler may still
be unavailable in the default population because competence, input or target gates
are absent. The other 34 contracts are specification material and remain blocked.
The compiler checks the registry hash, version, population, supported action IDs
and perturbations. Both the studio and server load the same fingerprinted pack.

The printable HTML generated from this manual includes every exact action
contract: local predicates, cell types, energy and store reservations, channel
exclusions, continuation/cancellation rules, duration models and typed outcomes.
Use that appendix or `constraints.json` for the complete numerical specification;
prose does not override an executable predicate. `model.json` identifies the
unchanged reference registry and extension from which v3 was assembled.
`manual_v2` is retained solely as an immutable tested reference and kernel dependency,
not as another selectable model. Its broad biological specification is not a claim
that every process is implemented in this host.

Evidence labels: M means a mechanism measured in the cited system; A means an
association; T means transfer between species, sites or experimental systems;
P means a proposed assumption. All executable numerical values are P, even when
literature supports the underlying mechanism. Minutes and micrometers are units,
not evidence that the chosen rates and distances have been calibrated.

## Geometry, cells and initial state

The host uses a 300 × 200 micrometer physical slice, rendered as a 3D cutaway.
There are separate apical, basal and vascular compartments. Depth in the
illustration does not add a third dimension to the physical transport solver.
The explicit population is stored in `tissues/ileum/population.json`.

| Identity | Count | Role and permitted response families |
| --- | --- | --- |
| Enterocyte | 42 | Barrier response/recovery, CXCL8 induction, toxin-induced transport; severe-damage death gates |
| Goblet cell | 8 | Finite mucus release, epithelial response and injury handling |
| Fibroblast | 20 | Local stromal activation and CXCL8 induction |
| Resident macrophage | 6 | Local uptake, cargo processing, corpse clearance, TNF and regulatory output when licensed |
| Inflammatory monocyte | 4 | CCL2-related recruitment/movement and conditional adaptation; two begin in vascular reserve |
| Dendritic cell | 2 | Local sampling, acquisition, antigen processing and recorded surface display |
| Neutrophil | 10 | CXCL8-related recruitment/movement and contact-dependent uptake; six begin in vascular reserve |
| NK cell | 8 | Cytotoxicity handler exists, but default scenarios supply no verified NK recognition gate |

Counts, positioning, competence and initial stores are synthetic priors. The six
approved cell morphologies are preserved, with separate monocyte and dendritic
meshes. Cells have stable IDs, explicit origin, viability, resources, stores,
programs, memory and finite substrates. No hidden cell replacement restores a
quiet-looking scene after injury.

## Local sensing and sparse decisions

Each cell samples only its accessible local field, nearby structural patches,
physical contacts and nearby altered cells. Contact radius is 0.05 in the host's
normalized slice coordinates, neighbor radius 0.08, and patch radius 0.09; these
mixed-axis normalized distances are illustrative, not isotropic measured radii.
Movement converts displacement to micrometers. Chemotaxis reads adjacent basal
voxels, never a remote focus or global map.

Basal TNF, CXCL8, CCL2, PAMP and DAMP are local fields. Apical LT and ST are separate
toxin fields; epithelial enterotoxin activity is the larger of their receptor
proxies. Mucus and the local secretory stimulus occupy the apical compartment.
IL10 is a patch-level regulatory proxy, not a fully resolved cytokine transport
system. Damage, junction integrity, brush border, cargo and acquired antigen are
additional local state. NAU/NCU are normalized amounts/concentrations; NWU is a
normalized water quantity. None can be reported as physiological molarity or mL.

A viable cell becomes eligible only after a local departure (contact, toxin,
microbial/damage cue, cytokine, injury, changed neighbor, acquired cargo/antigen or
post-recruitment adaptation), its reconsideration clock is due, and at least one
non-WAIT action passes the manual and host gates. Quiet baseline produces zero
questions. Persistent local challenges can be reconsidered at five-minute
intervals; completed short motility episodes may allow earlier reconsideration.
The scheduler does not make a fresh request for every cell every frame.

Jev receives one independent Choice question per eligible cell. Batching shares
HTTP overhead; it does not create a tissue-wide choice. WAIT is always offered.
Jev selects among legal actions; it does not generate numerical rates, targets,
new mechanisms or scientific explanations. Probability is model preference, not
biological hazard. The server and host reject missing options, nonnumeric,
nonfinite, negative, out-of-range or nonunit distributions and inconsistent
choices. The complete round is validated before any cellular commit or RNG draw.
A failed round pauses at its pre-round physical state; previous successful minutes
remain. Failed usage is retained and the recording becomes partial.

## Clocks, resources and outcomes

Selection starts an event and reserves resources/targets; it does not instantly
complete the effect. The reference kernel enforces channels, budgets, continuation,
cancellation and atomic, idempotent completion. The generated rule appendix lists
all durations and costs. Examples of uncalibrated duration ranges are:

| Process | Biological clock | Visible or recorded outcome |
| --- | --- | --- |
| Cytokine/chemokine induction | 30–360 min | Output capacity, followed by finite substrate-consuming secretion |
| Goblet release | 1–15 min | Actual mucus release using available stores |
| Motility episode | 1–10 min | Accepted local displacement and trail; no teleport to infection |
| Antigen processing | 60–720 min | Display record linked to actually acquired antigen |
| Monocyte adaptation | 1440–10080 min | Resident-like phenotype with monocyte origin retained |
| Death commitment | 60–720 min | Irreversible committed state after sustained severe injury gates |
| Death execution | 15–120 min | Dead-present cell, local gap and damage signal |

Damage ≥0.75 can license commitment; the model does not guarantee death whenever
infection exists. Execution follows commitment automatically, as a manual
consequence rather than another discretionary Jev call. Death is unclassified:
no apoptosis, pyroptosis or necroptosis subtype is inferred. Corpses persist until
contact-dependent clearance; there is no epithelial extrusion or regeneration
solver. The finite recruited-neutrophil lifetime is a declared host prior.

Phagocytosis reserves a real accessible target, removes it from the free/attached
pool, and records cargo and antigen provenance. Digestion and antigen processing
are distinct. Dendritic cells can process acquired antigen and record surface
display; macrophage uptake and cargo processing are implemented, but macrophage
peptide-MHC presentation is not. There are no T cells, lymph nodes or priming
outcomes. Trans-epithelial sampling is a coarse spatial assumption informed by a
mouse study, not a calibrated human dendrite simulation [5].

Monocyte recruitment and eventual resident-like adaptation reflect environmental
dependence supported in mice [6]. Low alarm, recruitment history and permissive
resolution are required; inflammation pauses adaptation. It must not be described
as all immune cells differentiating in minutes. Neutrophils follow CXCL8; monocytes
follow CCL2. Their exact speeds, reserves and crossing clocks are proposed.

## Four release scenarios

| Scenario | Input | Interpretable consequences and controls |
| --- | --- | --- |
| Baseline | Fresh tissue, no input, 60 min | Intact barrier and zero Jev requests; animation cannot activate cells |
| ETEC | 24 local apical bacteria, 180 min | Colonization produces LT/ST; eligible enterocytes choose transport; blue water follows completed capacity and finite reservoir accounting |
| EPEC | 24 local apical bacteria, 360 min | Contact-dependent attachment and brush-border/junction injury; local downstream sensing and cell responses |
| IBD-like innate injury | Focal junction lesion and reduced resolution, 360 min | Local microbial-product leakage, damage and innate feedback; not a complete chronic disease model |

Each scenario begins from a reset with independent state, ledgers and run ID.
ETEC does not inherit EPEC attaching-and-effacing lesions. Literature supports
ETEC adhesion/toxin delivery and cyclic-nucleotide-dependent secretion [1–3],
but this model collapses cAMP/cGMP pathways to local input/output proxies. CFTR,
PDE5, cyclic nucleotide pools and toxin subtype diversity are not explicitly
resolved. Jev-controlled transport onset is an engineering approximation; real
ion-channel biochemistry is not an AI decision.

EPEC contact injury is informed by human intestinal organ culture [4]. It is a
reduced mechanism and does not resolve each bacterial effector. IBD-like injury
is a perturbation experiment, not Crohn's disease, ulcerative colitis or a
patient-specific disease prediction. Duration defaults need not show every slow
outcome: adaptation takes days and death is conditional. Fixtures demonstrate
software behavior and the file format, not live-Jev biological validity.

## Reviewed pathways and limits

### Direct focal tissue injury input

The Studio **Tissue injury** input imposes an external epithelial wound, separate
from the four preset scenarios. Direct cell injury and junction disruption are
motivated by mechanical wounding experiments in intestinal epithelial monolayers
([Nusrat et al., 1992](https://www.jci.org/articles/view/115741)). This supports the
qualitative wound concept only; it does not calibrate the following settings or
implement the cell migration and restitution described in that study.

The executable contract is `tissues/ileum/pack.json` → `injury`. Within a normalized
horizontal half-width of 0.06 (18 µm), viable epithelial cells receive a target
damage of 0.8 in the central half-width 0.02 (6 µm), tapering linearly to zero at
the outer edge. Health becomes the lesser of existing health and
`100 * (1 - target_damage)`. Junction damage is at least 0.4 within the footprint
and at least the imposed cell damage. Cells outside that epithelial footprint,
vascular reserves and terminal cells receive no direct injury. Reapplying the
same wound cannot restore health or compound the initial dose beyond its target.

New health loss adds a local patch DAMP proxy at 0.3 times the added damage, which
then uses the existing basal release/transport. No cytokine, LT or ST is injected.
All these numbers and the spatial profile are proposed demonstration priors (P),
not measured human injury severity. The intervention records its profile and
affected cell IDs. Repair and conditional death retain the existing individual
manual decisions, gates and clocks; the wound does not kill cells immediately.

| Pathway | Release decision | Scientific reason |
| --- | --- | --- |
| NF-kB | No explicit NF-kB state or activation claim | Local alarm, TNF and output programs are coarse proxies. Epithelial NF-kB also protects integrity; a universal inflammation/death switch would be misleading [7]. |
| Inflammasome | No active handler or UI activation marker | Priming and activation are distinct. Mouse Salmonella epithelial expulsion cannot simply be assigned to ETEC/EPEC [8,9]. |
| IL1B / IL-1 beta | No mature IL-1 beta production; `IL1B_ACTIVE` is fixed at zero | Transcription, precursor storage, cleavage and release need separate verified mechanisms [8]. Broad reference actions stay blocked. |
| Type I interferon | Not simulated or advertised as an output | Context-dependent intestinal effects require appropriate sensing and IFNAR response models. Protection in a mouse colitis experiment is not a universal ETEC response [10]. |
| Cell death | Supported generic damage/commitment/execution | Severe-damage thresholds and clocks are proposed; subtype and extrusion remain unresolved. |
| Antigen presentation | Dendritic uptake/processing/display proxy | Actual acquisition is required. No adaptive immune activation is implied [5]. |

These omissions are intentional limits, not evidence that these processes are
absent from real intestine. New pathways need sourced predicates, distinct
inventories, physical handlers and mechanistic controls before being exposed.

## Recording, reproducibility and extension

Every episode contains the manual/pack fingerprint, seed, initial and final
states, sampled visual frames, all individual decision rounds with local snapshots,
menus, probabilities, selected actions, event clocks, receipts, failures and usage.
Visual frame sampling never samples away decisions. Playback loads data only and
cannot contact Jev or advance physiology. The checksum detects corruption, not
scientific validity or authorship. A seed reproduces fixture-driven physics in the
same runtime; it does not guarantee identical future live Jev responses.

The default per-experiment budget is 100 HTTP requests, including batches and
retries. The server also caps a session at 600 requests. These are request limits,
not prices or per-cell token limits. Recording stops at the declared memory limit,
retains the stopping round and labels partial files. Do not run paid examples
without choosing a budget and supplying your own local key.

To create liver, lung, skin, brain or another tissue, provide an independently
versioned manual and rules, explicit population, signals, inputs, host/renderer
adapter, physical action handlers, local-context tests, conservation tests and
fixture recordings. Geometry and biology must both change where needed; merely
renaming the gut pack is insufficient. See `docs/TISSUE_PACKS.md`.

## Primary literature

1. Smith et al. (2022). The role of CFA/I in adherence and toxin delivery by ETEC expressing multiple colonization factors in the human enteroid model. https://doi.org/10.1371/journal.pntd.0010638
2. Foulke-Abel et al. (2020). Phosphodiesterase 5 restricts intracellular cGMP accumulation during ETEC infection. Human jejunal enteroid study; transfer to this ileal depiction is T. https://doi.org/10.1080/19490976.2020.1752125
3. Pattison et al. (2016). Intestinal enteroids model guanylate cyclase C-dependent secretion induced by heat-stable enterotoxins. https://doi.org/10.1128/IAI.00639-16
4. Shaw et al. (2005). EPEC effector proteins, brush-border remodeling and attaching-and-effacing lesions in human intestinal organ culture. https://doi.org/10.1128/IAI.73.2.1243-1251.2005
5. Farache et al. (2013). Luminal bacteria recruit CD103+ dendritic cells into the intestinal epithelium to sample bacterial antigens for presentation. Mouse imaging study. https://doi.org/10.1016/j.immuni.2013.01.009
6. Bain et al. (2014). Constant replenishment from circulating monocytes maintains the macrophage pool in the intestine of adult mice. https://doi.org/10.1038/ni.2967
7. Nenci et al. (2007). Epithelial NEMO links innate immunity to chronic intestinal inflammation. Mouse conditional knockout study. https://doi.org/10.1038/nature05698
8. Bauernfeind et al. (2009). NF-kB-activating pattern recognition and cytokine receptors license NLRP3 inflammasome activation by regulating NLRP3 expression. https://doi.org/10.4049/jimmunol.0901363
9. Sellin et al. (2014). Epithelium-intrinsic NAIP/NLRC4 inflammasome drives infected enterocyte expulsion to restrict Salmonella replication. Mouse infection study. https://doi.org/10.1016/j.chom.2014.07.001
10. Katakura et al. (2005). Toll-like receptor 9-induced type I IFN protects mice from experimental colitis. https://doi.org/10.1172/JCI22996

Sources were checked during release review. They support the scoped qualitative
mechanisms above; none supplies the full numerical model or validates Jev choices.
