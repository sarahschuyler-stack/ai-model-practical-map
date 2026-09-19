# Working in this repository

- Merge and rebase conflicts are yours to resolve, never a question for the user. Follow `.claude/skills/resolve-conflicts/SKILL.md`: keep both sides where both added something, keep the new structure and update references where one side renamed, run `npm test`, commit the merge and push.
- `npm test` is the whole safety net (Node 22, no browser, no network). Run it before every push.
- The golden test in `test/chooser.test.mjs` pins preset picks; a tuning change must update it deliberately.
