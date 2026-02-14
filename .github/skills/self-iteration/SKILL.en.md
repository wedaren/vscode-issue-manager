# Self-Iteration Skill

## Summary
This skill provides a concise, reusable short-loop iteration workflow (Plan → Act → Observe → Reflect → Improve) and templates to help the assistant improve quality and produce traceable outputs while working on tasks.

## When to Use
- For multi-step tasks that require verification or carry rollback risk.  
- When you want to produce a reproducible iteration record or turn procedures into reusable templates.

## Five-step Workflow
1. Plan: define goal, inputs, success criteria and risks.  
2. Act: make changes or run commands, record key commands and modified files.  
3. Observe: run tests/checks and collect failures or evidence.  
4. Reflect: compare expected vs actual, find root causes and improvements.  
5. Improve: apply fixes and start the next short loop or finalize and archive learnings.

## Suggested Template
- Goal: one-line objective.  
- Inputs: files/configs/resources to work from.  
- Actions: summary of commands/edits.  
- Validation: how to verify success (tests, manual checks, lint).  
- Risks & Rollback: potential failure modes and how to revert.  
- Output Location: where to save artifacts (e.g. `.github/skills/`, `issue-notes/`).

## Output Expectations
- A short SKILL.md describing the workflow, one or more iteration notes in `issue-notes/`, and TODO tracking entries via `manage_todo_list`.

## Quick Example
1. Plan: fix `foo()` boundary in `src/` with tests passing.  
2. Act: edit `src/foo.ts`, run `npm test`.  
3. Observe: capture failing test logs showing null case.  
4. Reflect: expand tests and add input validation.  
5. Improve: add tests, refactor, update PR with iteration summary.

If you want, I can also: (A) add an example script that scaffolds iteration notes, or (B) create a minimal CI check that ensures each PR has a short iteration summary.
