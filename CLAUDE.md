# Project Instructions for AI Agents

This file provides instructions and context for AI coding agents working on this project.

## Git Commits

- Always commit the changes made for a completed task before handing off, unless the user explicitly asks not to commit. This is standing authorization; do not ask for confirmation before each commit.
- Commit each completed, validated chunk of work as you go during multi-step tasks; do not wait until the final handoff to commit everything. Keep commits focused and independently understandable.
- Review the diff, run the relevant checks, and stage only changes belonging to the task. Preserve unrelated work in the working tree or staging area.
- Include the commit hash and validation results in the handoff. If committing is blocked, report the exact command and error.
- Git pushes and Dolt remote sync still require an explicit user request.

This repository policy overrides the conservative/minimal commit defaults in the managed Beads guidance below and in `bd prime` output.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:6cd5cc61 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->


## Python Tooling

Use `uv` for Python commands. The root `pyproject.toml` and `uv.lock` manage
lightweight tooling: `uv run content` and `uv run python ...`. For image
generation use `uv run sprites ...`, `uv run enemy-sprites ...`, or
`uv run sprite-python ...` for helper scripts/tests. These select the existing
pinned GPU environment; do not install ML packages into the root `.venv` or
sync the root uv project into the inherited sprite/study environments.
See `image-generation/PYTHON.md` for setup. Use `uv add` for root dependencies
and retain both `pyproject.toml` and `uv.lock` changes.

## Enemy Design

For `design-enemy` requests or collaborative biome enemy design, read and follow
[skills/design-enemy/SKILL.md](skills/design-enemy/SKILL.md). It supports biome
suggestions, custom concepts, appearance and attack review, and saving accepted
enemies to TOML. Example: `Use design-enemy for Wetlands`.

## Build & Test

_Add your build and test commands here_

```bash
# Example:
# npm install
# npm test
```

## Architecture Overview

_Add a brief overview of your project architecture_

## Conventions & Patterns

_Add your project-specific conventions here_
