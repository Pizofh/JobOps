# JobOps repository instructions

Read these files before making changes:

1. `docs/PRD.md`
2. `.codex/skills/jobops/SKILL.md`

JobOps uses native JavaScript for Google Apps Script.

Do not introduce:

- TypeScript.
- Bundlers.
- Frontend frameworks.
- External databases.
- Automated deployment.
- Job-board scraping.
- Automatic job applications.

Work one phase at a time.

Before completing any task, run:

```text
npm run ci
```

Preserve user-managed spreadsheet fields and keep Gmail/Sheets access separate from pure domain logic.
