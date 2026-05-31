# Idea Draft Prompt Builder

Use this document when a user has a rough idea and wants an agent to turn it into a detailed planning prompt for another agent. The output should be project-agnostic, but repo-aware after exploration. It should help the next agent create a spec, implementation plan, ticket, design brief, research prompt, or other planning artifact in the same verbose, grounded style.

The goal is not to solve the feature immediately. The goal is to convert a fuzzy idea into a high-quality prompt that another agent can use to create the real plan or spec.

## Core Behavior

When the user gives a rough idea:

1. Ground yourself in the actual project first.
2. Read or search relevant files before asking questions.
3. Preserve the user's intent, vocabulary, and priorities.
4. Expand the idea into a clear, decision-shaping prompt.
5. Include a context index of files another agent should read.
6. Verify file paths before including them.
7. Keep the prompt project-specific, but keep this guide itself project-neutral.

The final result should be a reusable prompt the user can give to another agent.

## Exploration First

Before drafting the prompt, inspect the project enough to avoid generic advice.

Recommended first pass:

- List top-level project files and folders.
- Find existing specs, docs, tickets, architecture notes, design docs, or README files.
- Search for the feature area using likely keywords from the user's rough idea.
- Open the most relevant files and summarize the current state.
- Check if a similar spec, ticket, or feature already exists.
- Verify all file paths that will be named in the final prompt.

Useful command patterns:

```powershell
rg -n "keyword|related term|feature name" .
rg --files
Get-ChildItem -Path .
Test-Path -LiteralPath "C:\path\to\file.md"
```

Do not ask the user where files are if the repo can answer that. Ask only about product intent, tradeoffs, naming preferences, or scope choices that cannot be discovered from the project.

## What To Produce

Create a polished prompt that starts with a direct instruction, for example:

```text
Help me design a new spec file for this project, in the same style as the existing specs.
```

Then expand the user's rough idea into sections like these:

1. Context
2. Goal
3. Important product principles
4. User-facing behavior
5. Backend or data behavior
6. UI behavior
7. Data/API design
8. Tests and acceptance criteria
9. Further context index
10. Relevant implementation files to inspect

Use only the sections that fit the request. Rename sections to match the project and the artifact being requested.

## Style Rules For The Generated Prompt

The generated prompt should be detailed enough that another agent can act without guessing, but it should still read like a prompt, not the final spec.

Use this style:

- Clear, direct, and specific.
- Bulleted requirements grouped by topic.
- Project-aware references based on files you verified.
- Explicit preservation of existing behavior that should not regress.
- Explicit callouts for known conflicts, sequencing, or adjacent work.
- User-facing language separated from technical implementation language.
- No unnecessary jargon unless the project already uses it.
- No invented facts. If something is inferred, say so.

Avoid this:

- Generic templates with no repo context.
- Pretending a path exists without checking it.
- Solving the implementation in too much detail before a spec exists.
- Leaving major decisions implicit.
- Losing the user's original product intent.

## Handling Rough Ideas

When a user gives a rough idea, extract these pieces:

- What they want to change.
- Who the change is for.
- What the current experience seems to be.
- What the desired experience should feel like.
- What should remain unchanged.
- What should be hidden, simplified, renamed, or made explicit.
- What existing features might be affected.
- What needs a spec, plan, ticket, or implementation prompt.

If the user's idea includes screenshots, use them as product evidence. Mention the current visible UI state in the generated prompt only when useful.

## Path Verification

Before the final answer, verify every path in the context index and implementation-file list.

If a path exists, include it normally.

If a path does not exist:

- Do not include it as a verified path.
- Either remove it, or include it under a clearly labeled "possible files to search for" section.
- Prefer verified files over guessed files.

A good final note is:

```text
All referenced paths below were verified.
```

If not all paths could be verified, say exactly which ones were not verified.

## Context Index Pattern

The context index should tell another agent what to read and why. It should be ordered from broad context to narrow implementation detail.

Example structure:

```text
Further context index
If more context is needed while creating the spec, read these files in this order:

- `ABSOLUTE_OR_PROJECT_RELATIVE_PATH`
  - Why this file matters.

- `ABSOLUTE_OR_PROJECT_RELATIVE_PATH`
  - Why this file matters.
```

Use absolute paths when the user works locally and wants exact file references. Use repo-relative paths if that is the project's convention or the agent will run from repo root.

Good context-index candidates:

- README or project overview.
- Architecture/conventions docs.
- Existing specs similar to the requested change.
- Existing tickets or plans for adjacent work.
- Docs for deployment, operations, security, or testing if relevant.
- Current implementation files for the affected surfaces.
- Test files that define expected behavior.

## Prompt Template

Use this as a starting point and adapt it to the project.

```text
Help me design [artifact type] for [project name], in the same style as the existing [specs/docs/tickets/plans]. The likely file should be `[candidate path]`, unless the existing index suggests a better name.

Context:
[Explain what the project currently does. Mention existing architecture, UI, data model, or workflows discovered from the repo. Keep it factual.]

Current state:
[Describe the current user or system experience that needs to change. Reference screenshots or files if useful.]

Goal:
[State the desired outcome in direct product language.]

Important principles:
- [Principle that should guide the design.]
- [Existing behavior that must remain true.]
- [Vocabulary or UX constraints.]
- [Technical constraints from the current project.]

The spec/prompt should cover:

1. [Area One]
- [Requirement.]
- [Requirement.]
- [Requirement.]

2. [Area Two]
- [Requirement.]
- [Requirement.]
- [Requirement.]

3. UI behavior
- [Primary user flow.]
- [Mobile/responsive expectations.]
- [Empty/error/loading states if relevant.]
- [Copy/naming requirements.]

4. Data/API/architecture design
- [Data shape or schema expectations.]
- [API/procedure/interface changes.]
- [Side effects and integrations.]
- [Migration/backward compatibility constraints.]

5. Tests and acceptance criteria
- [User-visible behavior test.]
- [API/unit/integration test.]
- [Regression test for existing behavior.]
- [Accessibility/responsive/performance criteria if relevant.]

6. Further context index
If more context is needed while creating the spec, read these files in this order:

- `[verified path]`
  - [Why this file matters.]

- `[verified path]`
  - [Why this file matters.]

Relevant implementation files to inspect:
- `[verified path]`
- `[verified path]`
```

## Things To Add When Relevant

Add these sections only when they matter.

### Existing Work Coordination

Use when a related spec, ticket, branch, or feature already exists.

```text
Existing work coordination:
- `[file or ticket]` already covers [scope]. This new prompt should not redo that work.
- This new work must coordinate with [existing flow] because [reason].
- If there is a conflict, the spec should call it out and propose sequencing.
```

### Migration And Backward Compatibility

Use when existing data or old files must keep working.

```text
Migration/backward compatibility:
- Existing [records/files/configs] must continue to load.
- New behavior should be additive unless the spec explicitly says otherwise.
- Define how old data is interpreted, upgraded, or left alone.
```

### Non-Goals

Use when the rough idea could sprawl.

```text
Non-goals:
- Do not redesign [unrelated area].
- Do not change [existing behavior] except as required for this feature.
- Do not introduce [technology/pattern] unless the spec justifies it.
```

### Open Decisions

Use when a decision is important and cannot be inferred.

```text
Open decisions the spec should resolve:
- [Decision]: choose between [option A] and [option B], with a recommendation.
- [Decision]: define whether [scope] is included now or deferred.
```

## Quality Checklist

Before giving the user the final prompt, check:

- The prompt preserves the user's rough idea.
- The prompt is not tied to any unrelated project.
- The prompt names current project facts discovered from files.
- The prompt does not invent APIs, paths, or constraints without saying they are proposals.
- The prompt separates user-facing behavior from backend implementation.
- The prompt includes tests and acceptance criteria.
- The prompt includes a context index with verified paths.
- The prompt calls out adjacent work and likely conflicts.
- The prompt is detailed enough for another agent to create the next artifact.

## Final Response Format

When answering the user, keep it simple:

1. Say whether paths were verified.
2. Provide the finished prompt in a fenced code block.
3. Briefly mention any important discovery, such as an existing spec number or related ticket.

Example:

```markdown
All referenced paths below were verified. One important note: an existing spec already covers part of this, so I included a coordination section.

```text
[finished prompt]
```
```