# Comprehensive Code Review Checklist

## Security
- [ ] No hardcoded secrets (API keys, passwords).
- [ ] No SQL injection vulnerabilities (use parameterized queries).
- [ ] No XSS vulnerabilities (escape user input).
- [ ] Authentication/Authorization checks are present.

## Performance
- [ ] No N+1 query problems.
- [ ] Proper indexing on database queries.
- [ ] Minimize re-renders in React components (useMemo, useCallback).
- [ ] Lazy loading used for large modules/components.

## Testing
- [ ] Unit tests cover critical paths.
- [ ] Edge cases are tested.
- [ ] Tests are readable and maintainable.
