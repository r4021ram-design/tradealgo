---
name: reviewing-code
description: Performs a comprehensive code review on specified files or changesets. Use when the user asks for a code review, quality check, or analysis of specific files.
---

# Code Reviewer

## When to use this skill
- User asks for a "code review" or "quality check".
- User wants to know if code follows best practices.
- User asks to find potential bugs or security issues in existing code.

## Workflow

1.  **Context Gathering**: Identify which files need review (Ask user if ambiguous).
2.  **Automated Analysis**: Run provided scripts to get objective metrics.
3.  **Manual Heuristic Review**: Apply expert judgement on design and readability.
4.  **Reporting**: Output a structured report.

## Instructions

### 1. Automated Analysis
First, run the complexity analysis script on the target files to identify "hotspots" that need extra attention.

```bash
# Usage: node .agent/skills/reviewing-code/scripts/analyze_complexity.js <file_path>
node .agent/skills/reviewing-code/scripts/analyze_complexity.js src/App.tsx
```

### 2. Heuristic Review
Use the `view_file` tool to read the code. Compare against the checklist below.

#### Critical Checks (Safety & Correctness)
- [ ] **Input Validation**: Are external inputs validated/sanitized?
- [ ] **Error Handling**: Are try/catch blocks used appropriately? Are errors logged?
- [ ] **State Management**: Is state mutated directly? (Anti-pattern in React/Redux).
- [ ] **Async/Await**: Is there potential for race conditions? Missing `await`?

#### Quality Checks (Maintainability)
- [ ] **Naming**: do variable names reveal intent? (e.g., `isUserLoggedIn` vs `flag`).
- [ ] **DRY (Don't Repeat Yourself)**: Can repeated logic be extracted to a helper?
- [ ] **Composability**: Are functions/components too large? (> 200 lines).

### 3. Reporting Results
Present findings in this format:

```markdown
## Code Review Report for `[filename]`

### 🚨 Critical Issues
- [Line X]: Description of bugs or security risks.

### ⚠️ Improvement Opportunities
- [Line Y]: Suggestions for cleaner code or performance.

### 📈 Complexity Metrics
- Cyclomatic Complexity: [High/Medium/Low]
- Maintainability Index: [Score]
```

## Resources
- [Full Review Checklist](resources/review_checklist.md)
