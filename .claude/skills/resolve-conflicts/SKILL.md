---
name: resolve-conflicts
description: Resolve git merge and rebase conflicts on your own in any repository, without asking the user to pick "current", "incoming" or "both". Use this whenever a merge, pull, rebase or cherry-pick reports CONFLICT, whenever a pull request shows as un-mergeable or "This branch has conflicts", whenever the user pastes conflict markers (the seven-character HEAD, separator and incoming lines) or a screenshot of an editor's conflict view and asks which side to choose, and whenever main has moved ahead of a feature branch you are driving. The user has said they never want to be handed a conflict; the deliverable is a resolved, tested, pushed merge, not a question.
---

# Resolve conflicts on your own

The person you work for does not want to be asked "current, incoming or both?" in any of their repositories.
When a conflict appears, resolve it, prove the result with the test suite, commit and push,
then explain what you chose and why. They can read the diff afterwards; what they cannot
do easily is pick between two hunks they did not write.

## Why this is safe

Almost every conflict is two people adding to the same place: a row to a table in the
README, a name to an export list, a function next to another function. The right answer
in those cases is "both", tidied so nothing is duplicated. The repository's own checks
(its test suite, lint, type check and build, whatever a contributor runs before pushing)
are the safety net: if a merged file is wrong, a check fails and you fix it before anyone
sees it. Find those commands in the README, `package.json`, `Makefile` or CI workflow
before you start, so you know what "proven" means for this repo.

## Procedure

1. **Bring the base in with a merge, not a rebase.** On a branch other people may have
   checked out, never rewrite history (no rebase, amend or force-push). From the feature
   branch:

   ```bash
   git fetch origin main
   git merge --no-edit origin/main
   git diff --name-only --diff-filter=U     # the conflicted files
   ```

2. **Read both sides before touching anything.** For each conflicted file, look at what
   the branch changed and what main changed, and what each was trying to do:

   ```bash
   git log --oneline HEAD..origin/main      # what main gained
   git diff HEAD...origin/main -- <file>    # main's version of the change
   ```

3. **Classify each hunk and resolve it:**
   - *Both sides added different things* (table rows, list entries, new functions, new
     tests): keep both. Remove any row or entry that now appears twice, keeping the fuller
     wording. Check ordering conventions (a playbook or export list may have a required
     first entry).
   - *One side renamed or restructured something the other side still references*
     (a heading a test asserts on, a function a new caller uses): keep the new structure
     and update the reference. This is the case that looks like a "pick one" but is really
     "pick one, then fix the other side's dependency".
   - *Both sides changed the same logic*: prefer a resolution that keeps both behaviours.
     If that is genuinely impossible, keep the side that serves the branch's purpose,
     say so plainly in the commit message and the reply, and point at the exact lines so
     the user can reverse the call. Do not stop and ask; a resolution they can review beats
     a question they have to research.
   - *Generated or lock files*: never hand-merge. Take either side, then regenerate with
     the repo's tooling.

4. **Remove every marker and prove it:**

   ```bash
   git diff --check                          # flags leftover conflict markers
   grep -rn "^<<<<<<< \|^>>>>>>> " --include=* . --exclude-dir=.git | head   # must print nothing
   <the repo's test / lint / build commands>
   ```

   Run the fast checks; run the full suite if the fast ones pass. A failing test after a
   clean-looking merge usually means a rename case you missed
   (main added a test for the old shape of something the branch changed). Update the
   test to the new shape when the branch's change was intentional; fix the code when it
   was not.

5. **Commit and push.** Stage the resolved files, commit with a message that says what
   the conflict was and how each hunk was resolved, and push to the branch's own remote
   branch. If a pull request exists for the branch, the push clears its conflict state.
   If the repository's contributing rules say to rebase branches you created yourself,
   follow them for your own branches only; a branch someone else has checked out is
   always merged.

6. **Report briefly.** Tell the user which files conflicted, the rule applied to each
   (kept both, kept new structure and updated the reference, chose a side and why), and
   the test result. If they have a half-finished local merge open in their editor, tell
   them to discard it and pull rather than finish it by hand.

## Worked example (from the ai-model-practical-map repository)

Main added `ui.test.mjs` and `storage.test.mjs` rows to the README table while the branch
added a `prompt.test.mjs` row; both sides reworded the `chooser` and `recheck` rows.
Resolution: keep all five rows, taking main's fuller wording for the two shared ones.
The harness `EXPORTS` list conflicted the same way: keep main's `hasWord` and the branch's
analyzer exports. One of main's new UI tests then failed because it asserted the old
`# Task` heading that the branch had renamed to `# Goal`; the rename was the point of the
branch, so the test was updated. Suite green, merge committed, pushed; the PR's conflict
banner cleared.
