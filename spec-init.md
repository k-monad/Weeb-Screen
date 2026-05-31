# spec-init.md — Spec Authoring & Handoff Playbook

> A project-agnostic playbook for turning a **rough prompt** into (1) a finished
> **spec document** in the target project's house style and (2) a **kickoff prompt**
> an implementation agent can run.
>
> **How to use it:** paste this whole file to an agent that has access to the
> target repo, followed by your rough prompt (template at the end). The agent
> researches the codebase, writes the spec, and outputs the kickoff prompt. Nothing
> in here is tied to a specific project — adapt the filenames to whatever the target
> repo uses.

---

## 0. What this produces

Two artifacts, in this order:

1. **A spec document** written into the project's spec/design location, matching
   the style of the specs already there.
2. **A kickoff prompt** (printed in the final reply) that a separate implementation
   agent can paste-and-run to build the spec.

Optionally (only if the user asks for a "continuous build" or full handoff):
3. Ticket decomposition, ratified decision-log entries, and updated project state
   files.

By default, **produce the spec + kickoff prompt, then stop and summarize.** Do not
decompose into tickets, edit the decision log, or write code unless asked.

---

## 1. Operating principles (the part that makes specs good)

These are the habits that separate a useful spec from a plausible-sounding one:

- **Ground every contract in the real codebase — do not invent APIs.** Before you
  commit to a function signature, schema, event, route, or component, open the
  actual source and confirm it exists and behaves as you assume. Inventing a method
  that isn't there is the most common spec failure. (Example from practice: a spec
  assumed a "read image" service method existed; the real service only had "save
  image" — the spec had to design around it.)
- **Match the house style.** Read 2–3 existing specs and mirror their structure,
  headings, voice, and conventions. A spec that looks foreign won't be trusted.
- **Make decisions, with a recommendation.** When the design has an open A/B
  choice, pick one, state why, and note the alternative. Don't hand the
  implementer an unresolved fork.
- **Be honest about gaps.** If something is under-defined or unverified against the
  code, say so explicitly. Never claim completeness you didn't verify.
- **Respect file ownership.** Many projects assign files/areas to specs or tickets.
  Flag every cross-boundary edit and every shared-type/schema change as an explicit
  decision or escalation rather than crossing silently.
- **Flag security-sensitive surfaces.** Auth/sessions, migrations, subprocess
  execution, filesystem writes, new secrets/env vars, and cost-affecting changes
  always deserve a human read before deploy — call them out.
- **Keep user-facing principles intact.** If the project has product rules (e.g.
  "hide implementation jargon in the UI", "mobile-first at width X"), the spec must
  honor them and restate the relevant ones.

---

## 2. Process

### Phase A — Learn the project's conventions

Locate and read (names vary by project — these are the common shapes):

- **The spec/design index** — e.g. `specs/README.md`, `docs/rfcs/`, `adr/`,
  `design/`. Learn the numbering and naming convention and where new specs go.
- **The architecture / conventions doc** — e.g. `ARCHITECTURE.md`,
  `specs/00-*.md`, `CONTRIBUTING.md`, `docs/architecture.md`. Note the shared
  mental model, coding conventions, shared types, and any "hard rules".
- **The process / workflow doc** — e.g. `WORKFLOW.md`, `CONTRIBUTING.md`. Note how
  specs become tickets, review tiers, ownership rules, and escalation paths.
- **The decision log** — e.g. `DECISIONS.md`, `adr/`, `CHANGELOG`. Note the format
  and the **highest decision number already used** (see §5 on collisions).
- **State files** — e.g. `PROGRESS.md`, `STATUS.md`, a project board. Note current
  status and anything in flight.
- **Any root agent-instructions file** — e.g. `CLAUDE.md`, `AGENTS.md`,
  `.cursorrules`. Follow it; it overrides defaults.

If the project has none of these, infer conventions from the code layout and say so
in your summary.

### Phase B — Ground the design in real code

Read the actual source the spec will touch or depend on. At minimum inspect:

- The modules/contracts the feature extends (routers/controllers, services, data
  models/schema, shared types, event/queue plumbing).
- The UI components/pages it changes, and any shared component patterns.
- Anything the rough prompt names explicitly.

For each contract you plan to reference, verify it exists. If a needed capability is
missing, **design around it or flag adding it** — do not assume it exists.

### Phase C — Choose the spec's number/name

Use the project's index/convention to pick the next number and a clear,
kebab-case (or local-style) filename. Propose a better name than the user's
suggestion only if the convention implies one.

### Phase D — Write the spec

Mirror the existing specs' structure. A strong spec usually contains:

1. **Title + one-paragraph summary** (a blockquote of what changes and why).
2. **Read first / Depends on / Blocks** header.
3. **Goal** — what "done" looks like in plain terms.
4. **Product principles / constraints** the spec must honor.
5. **Files Owned** — every file created or modified, each marked new vs MODIFY,
   with cross-boundary edits and shared-type/schema changes flagged.
6. **Data model / schema** sketches.
7. **API / contracts** (functions, endpoints, events) with exact signatures.
8. **UI flows** (mobile behavior if relevant; honor jargon-hiding rules).
9. **Behavioral semantics** — for anything stateful, define exactly what stays
   stable, what changes, and how existing references are preserved.
10. **How affected subsystems respond** to the new behavior.
11. **Acceptance criteria** — checkable gates.
12. **Tests** — the surfaces that need coverage.
13. **Decisions** — ADR-lite entries with recommendations (see §4).
14. **Out of scope.**

Write the file to the project's spec location and add it to the index.

### Phase E — Readiness self-check

Re-read your spec against the real code. Flag any under-defined behavior or contract
gap. Resolve it or note it honestly. Confirm the file matches house style and the
index is updated.

### Phase F — Produce the kickoff prompt

Output a kickoff prompt for the implementation agent (templates in §6). Then stop
and summarize what you created and any decisions a human still needs to confirm.

### Phase G — (Only if asked) Full handoff / continuous build

If the user asks to run it straight through:
- Decompose the spec into right-sized tickets (one ticket ≈ one focused work
  session; schema first, then contracts, then UI, then end-to-end).
- Ratify the spec's decisions into the decision log (mind collisions, §5).
- Update the state files (status + active tickets).
- Add a "continuous build" decision that waives per-ticket pauses but **keeps**
  human reviews for security-sensitive diffs.
- Use the continuous-build kickoff variant (§6).

---

## 3. Spec file skeleton (generic)

```markdown
# NN — <Title>

> One paragraph: what this changes and the core principle behind it.

**Read first:** <conventions doc>, <related specs>.
**Depends on:** <specs/modules that must exist first>.
**Blocks:** <what this unblocks, or "nothing">.

---

## 1. Goal
Plain-terms description of done.

## 2. Principles / Constraints
Project rules this spec honors.

## 3. Files Owned
```
path/to/new-file.ext          # NEW: purpose
path/to/existing.ext          # MODIFY (owned by X): what + why  ← flag crossings
```
### Cross-spec / shared-type touch points
List each boundary crossing and how it's authorized (decision/escalation).

## 4. Data model / schema
## 5. API / contracts
## 6. UI flows (+ mobile)
## 7. Behavioral semantics (exact)
## 8. Subsystem interactions
## 9. Acceptance criteria
## 10. Tests
## 11. Decisions (see §4 of the playbook)
## 12. Out of scope
```

---

## 4. Decision (ADR-lite) entry template

Match the project's existing format if it has one. Otherwise:

```markdown
## D-NNN (YYYY-MM-DD) - <Imperative title>
**Context:** What forced this decision.
**Decision:** What was decided. Be specific.
**Impact:** Which files/areas/behaviors change.
**Decided by:** human / agent / consensus.
**Alternatives considered:** Brief note on what was rejected and why.
```

In the spec, list decisions as "proposed" until a human ratifies them; once ratified
(or if the user pre-approves), record them in the decision log and mark them
recorded in the spec.

---

## 5. Collision & concurrency cautions

- **Decision numbers:** before assigning `D-NNN`, grep the decision log for the
  **current highest number**, including entries other agents may have added
  concurrently. Two agents working in parallel can both grab the same next number —
  if you discover a clash, renumber **your** entries to the next free numbers and
  fix every reference (the other agent's committed/earlier-dated entries win).
- **Ticket numbers:** same rule — check the highest existing ticket before
  numbering new ones.
- **File ownership:** if your spec must modify files owned elsewhere, that's a
  deliberate crossing to flag, not a silent edit.

---

## 6. Kickoff prompt templates

### 6a. Per-ticket (default cadence)

```
You are picking up <spec id/name> on the <project> project.

Read these files in order before doing anything:
1. <workflow/process doc> (full read)
2. <architecture/conventions doc>
3. <related specs the work depends on>
4. <the new spec> (full read)
5. <state files: status + decision log (recent entries)>
6. <the source files the spec lists> (read before changing)

Implement <spec id> per its acceptance criteria, one ticket-sized PR at a time on a
feature branch. Write tests for every public surface you add. Self-check the spec's
acceptance criteria before marking done. Record new choices in <decision log> and
blockers in <blockers file>.

Guardrails (restate the spec's hard rules here, e.g.):
- <source-of-truth / no-schema-change / determinism / jargon-hiding / mobile rules>
- Do not modify files outside the ticket's owned set; flag cross-boundary edits.

Hard gates before merge: <typecheck>, <tests>, <lint>, <build> pass; acceptance
criteria checked; security-sensitive diffs (auth/migrations/subprocess/secrets)
flagged for a human read.

Escalate (stop and write a blocker) if: a spec contract contradicts the code, a
required dependency/env var is missing, or you'd need to change a shared type/owned
file not authorized by the spec.

When finished, push the branch and open a PR. Do not merge or start the next ticket.
```

### 6b. Continuous build (only when the user asks for it)

Same as 6a, plus:

```
Run this as a CONTINUOUS build: work the tickets in dependency order, and when a
ticket's acceptance criteria pass, self-merge it and proceed to the next WITHOUT
waiting for per-ticket approval — keeping branch/PR/test/ownership discipline.

This waives the per-ticket pause, NOT the human review of security-sensitive diffs.
Flag these for review before deploy: <list the specific risky diffs, e.g. shared
libraries, auth boundaries, migrations>.

Build order (dependencies): <T-a → T-b → ...>.
When all tickets are merged, mark the spec complete in <state file>. The next free
decision number is D-NNN.
```

---

## 7. Ticket template (only used in full handoff)

```markdown
---
id: T-NN
spec: <spec id>
title: "<imperative title>"
status: open
branch: <branch>
---

# T-NN — <title>
**Spec:** <spec id>  **Depends on:** <merged tickets>  **Blocks:** <tickets>

## Goal
One paragraph.

## Required reads (in order)
<workflow, conventions, the spec sections, state files, this ticket>

## Files this ticket owns
## Files this ticket may read but not modify
## Out of scope
## Acceptance criteria
- [ ] ... (end with: typecheck/tests/lint pass; no out-of-scope edits; PR template)

## Escalate (don't proceed) if
- <conditions that require stopping>
```

---

## 8. Pre-deploy checklist (hand to the user)

When the user asks "am I good to deploy", give a clear verdict, not a yes:

- **What does deploying actually ship?** If the new spec isn't implemented yet, say
  so plainly — planning artifacts are not deployable code.
- **Gates:** build passes; tests/lint/typecheck green on the target branch;
  migrations (if any) apply cleanly on a fresh DB; security-sensitive diffs have had
  a human read; a smoke test of the new behavior on a realistic environment.
- **What's NOT needed** (state it to shrink their checklist): if the spec adds no
  env vars, no migration, no secrets, no new deps — say so.

---

## 9. The rough-prompt template (what the USER fills and sends with this file)

```
Help me design a new spec for <PROJECT>, in the same style as the existing specs.
Suggested filename: <NN-name.ext> (use a better name if the index implies one).

## What it's about
<one line>

## Context
<background; why it matters; any product principles it must respect>

## Goal
<what 'done' looks like>

## The spec must cover
<thorough bullet list: access/visibility, data model, API/contracts, UI flows,
how it interacts with existing subsystems, edge cases, tests, acceptance criteria,
and any product decisions you want made with a recommendation>

## Further context to read (in order)
<the most relevant specs/docs/source files; if unsure, tell the agent to find them>

## How to work
Follow spec-init.md: read the project's conventions, GROUND THE DESIGN IN REAL CODE
(don't invent APIs), write the spec in house style, make decisions with
recommendations, flag cross-boundary/shared-type/security touch points, update the
spec index, then output a kickoff prompt. Produce the spec + kickoff prompt, then
stop and summarize — do NOT decompose into tickets or write code unless I say
"continuous build" / "full handoff".
```
```
