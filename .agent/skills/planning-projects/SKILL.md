---
name: planning-projects
description: Use when you have a spec or requirements for a multi-step task, before touching code. Generates detailed step-by-step implementation plans.
---

# Writing Implementation Plans

## Overview

Write comprehensive implementation plans assuming the engineer has zero context for our codebase. Document everything they need to know: which files to touch for each task, code, testing, docs they might need to check, and how to test it.

**Context:** This should be run after brainstorming and design approval.
**Save plans to:** `docs/plans/YYYY-MM-DD-<feature-name>.md`

## The Process

1.  **Analyze Request**: Understand the goal, architecture, and tech stack.
2.  **Break Down Tasks**: Create bite-sized tasks (2-5 mins each).
3.  **Create Plan**: Use the template below to generate the plan file.

## Plan Template

Use the template at [`resources/plan-template.md`](resources/plan-template.md) for the plan structure.

## Bite-Sized Task Granularity

Each step in the plan should be one atomic action:
- "Write the failing test"
- "Run it to make sure it fails"
- "Implement the minimal code to make the test pass"
- "Run the tests and make sure they pass"
- "Commit"

## Key Principles

- **Exact file paths always**
- **Complete code in plan** (not "add validation", show the code)
- **Exact commands** with expected output
- **DRY, YAGNI, TDD**
- **Frequent commits**

