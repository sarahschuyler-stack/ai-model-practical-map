import { test } from "node:test";
import assert from "node:assert/strict";
import { load, presets } from "./harness.mjs";

// The example job from the September 2026 review, in the requester's own words. The brief it produces is the quality bar.
const GATE_JOB = "i want a prompt to have a required login field that is just someones email address no password required, and then tracking on usage for a repo i made public online so I can see how often it is accessed, by who and for how long.";
const G = { role: "a senior engineer", style: "Work carefully." };

function brief(p, job, answers = {}, target = "balanced") {
  p.el("task").value = job;
  p.el("recommend").onclick();
  Object.assign(p.pb.answers, answers);
  return p.buildPrompt(p.pb.rec[target], G);
}
const headings = out => out.split("\n").filter(l => l.startsWith("# ")).map(l => l.slice(2));
const phases = out => out.split("\n").filter(l => /^Phase \d+ — /.test(l)).map(l => l.replace(/^Phase \d+ — /, ""));

test("the email-gate job produces the full brief: gate UX, security distinction, data model, active time, admin dashboard, secrets, phases, tests", () => {
  const p = load();
  const out = brief(p, GATE_JOB);
  const j = p.analyzeJob(GATE_JOB);
  assert.equal(j.kinds.primary, "code");
  assert.ok(j.passwordless, "detects the no-password wording");
  assert.ok(j.public, "detects the public repository");
  assert.deepEqual(p.jobHints(j), ["Email or login gate", "Usage analytics", "Admin view", "Database and migrations", "Public repository"]);

  for (const h of ["Role", "Goal", "Repository Assessment", "Identity Gate: User Experience", "Security Distinction", "Data Model: Users",
    "Data Model: Sessions and Events", "Session Duration", "Events", "Privacy", "Admin Access", "Admin Analytics Dashboard",
    "Database Rules", "Public Repository Considerations", "Deliverable", "Constraints", "Implementation Process", "Testing", "Final Deliverable", "Working Rules"])
    assert.ok(headings(out).includes(h), "missing section: " + h);
  assert.deepEqual(phases(out), ["Repository assessment", "Identity gate", "Analytics engine", "Admin dashboard", "Security review", "Documentation"]);

  assert.match(out, /working inside an existing public repository/);
  assert.match(out, /> i want a prompt to have a required login field/, "the job is quoted verbatim");
  assert.match(out, /1\. A required login field that is just someones email address no password required/, "the 'I want a prompt to' lead-in is stripped from the requirement");
  assert.match(out, /Explicitly ruled out[\s\S]*- No password required/);
  assert.match(out, /No password, no account creation, no username/);
  assert.match(out, /not real authentication/);
  assert.match(out, /magic-link/);
  assert.match(out, /normalized_email \(unique\)/);
  assert.match(out, /last page load minus first page load/);
  assert.match(out, /navigator\.sendBeacon\(\)/);
  assert.match(out, /trackEvent\('report_opened'\)/);
  assert.match(out, /\/admin\/usage/);
  assert.match(out, /ADMIN_EMAILS=/);
  assert.match(out, /Never commit secrets/);
  assert.match(out, /Row Level Security/);
  assert.match(out, /Do not merely describe the implementation\. Implement it in the repository\./);
  assert.match(out, /Test at minimum:\n1\. Existing application functionality still works/, "numbered test list starts with the baseline");
  assert.match(out, /\n\d+\. A search of the diff and new files finds no keys/, "public-repo test is in the numbered list");
  assert.ok(out.length > 12000, "a full engineering brief, got " + out.length + " chars");
  assert.doesNotMatch(out, /undefined|\[object|NaN/);
});

test("wizard answers layer onto the description-driven brief", () => {
  const p = load();
  const out = brief(p, GATE_JOB, {
    outcome: "A merged PR with a working gate and a usage page I can open.",
    context: "The app is a static Vite site on Netlify with Supabase already configured.",
    constraints: "TypeScript only. No new paid services.",
    tools: ["The full repository", "Ability to run code and tests"],
    verify: "npm test and a manual walk through the gate in two browsers.",
    format: "Code changes with explanation",
    depth: "Exhaustive: leave nothing unexamined",
    pushback: "Yes, push back and propose alternatives",
    audience: "Me, a solo maintainer.",
  });
  assert.match(out, /Definition of done: A merged PR with a working gate/);
  assert.match(out, /# Context\nThe app is a static Vite site on Netlify/);
  assert.match(out, /You have access to: the full repository, ability to run code and tests\./);
  assert.match(out, /# Constraints\n- TypeScript only\. No new paid services\./);
  assert.match(out, /1\. Requester's verification requirement: npm test and a manual walk/);
  assert.match(out, /Format: Code changes with explanation\./);
  assert.match(out, /Thoroughness: be exhaustive/);
  assert.match(out, /Audience and tone: Me, a solo maintainer\./);
  assert.match(out, /say so plainly and propose an alternative/);
  // Skipping every question still yields the default rules, not blanks.
  const bare = brief(load(), GATE_JOB);
  assert.match(bare, /Definition of done: The work is implemented in the repository/);
  assert.match(bare, /If you disagree with an approach in this brief, say so in one paragraph/);
  assert.match(bare, /Format: Code changes in the repository/);
  assert.doesNotMatch(bare, /# Context/);
});

test("requirements and exclusions are read from the description", () => {
  const p = load();
  assert.deepEqual(p.extractRequirements(presets()["Deep coding"]), [
    "Read a very large codebase", "Find the root cause of an intermittent accounting bug", "Challenge the architecture", "Implement a safe fix and verify it with tests",
  ]);
  assert.deepEqual(p.extractRequirements(presets()["Executive analysis"]), [
    "Analyze a board-level financial problem with incomplete data", "Generate competing hypotheses", "Research missing facts", "Create a polished decision memo",
  ]);
  assert.deepEqual(p.extractRequirements("Write me a prompt that will add dark mode, then update the docs"), ["Add dark mode", "Update the docs"]);
  assert.deepEqual(p.extractRequirements("- add a login page\n- track usage\n- show me a dashboard"), ["Add a login page", "Track usage", "Show me a dashboard"]);
  assert.deepEqual(p.extractExclusions("Build the importer without a UI, and do not touch the billing tables. Products I do not know about are fine."),
    ["Without a UI", "Do not touch the billing tables"], "'do not know about' is not an exclusion");
  assert.deepEqual(p.extractExclusions(presets()["Wide research"]), []);
});

test("kind detection: presets land on the right kind of brief and short words match whole words only", () => {
  const p = load();
  const pr = presets();
  const kind = t => p.analyzeJob(t).kinds.primary;
  assert.equal(kind(pr["Wide research"]), "research");
  assert.equal(kind(pr["Deep coding"]), "code");
  assert.equal(kind(pr["Huge document set"]), "documents", "'report' must not read as 'repo'");
  assert.equal(kind(pr["Routine build"]), "code");
  assert.equal(kind(pr["Executive analysis"]), "analysis");
  assert.equal(kind(pr["Agent orchestration"]), "agents");
  assert.equal(kind("write a birthday poem for my mother"), "writing");
  assert.equal(kind("produce a concise report in markdown format"), "general", "'format' must not read as 'form' and fire the UI playbook");
  assert.equal(kind("test the hypothesis that our churn is seasonal"), "analysis", "a lone 'test' is not a coding job");
  const hints = t => p.jobHints(p.analyzeJob(t));
  assert.deepEqual(hints(pr["Wide research"]), ["Market or competitor research"]);
  assert.deepEqual(hints(pr["Huge document set"]), ["Document set review"]);
  assert.deepEqual(hints(pr["Agent orchestration"]), ["Agent orchestration"]);
  assert.deepEqual(hints("add stripe checkout to my nextjs app and send a welcome email after"), ["Payments", "Sending email"]);
  assert.deepEqual(hints("write a birthday poem"), ["Writing"]);
  assert.deepEqual(hints("plan a picnic"), [], "a general task fires no specialist playbook");
});

test("non-code briefs use the right framing and never include repository sections", () => {
  const p = load();
  const research = brief(p, presets()["Wide research"]);
  assert.match(research, /# Role\nYou are a senior engineer with live web access\./);
  assert.match(research, /Before you begin:/);
  assert.match(research, /# Source Plan/);
  assert.match(research, /Format: A comparison matrix plus a narrative synthesis/);
  assert.deepEqual(phases(research), ["Scope and source plan", "Gather", "Verify and deduplicate", "Synthesize"]);
  assert.doesNotMatch(research, /Repository Assessment|feature branch|# Testing/);
  assert.match(research, /# Verification\nVerify at minimum:/);
  assert.match(research, /Deliver the finished work, not a plan for doing it/);

  const memo = brief(p, presets()["Executive analysis"]);
  assert.match(memo, /# Framing[\s\S]*# Hypotheses and Tests[\s\S]*# Assumptions and Sensitivity[\s\S]*# Recommendation/);
  assert.match(memo, /Format: A one-page memo with a detailed appendix\./);

  const poem = brief(p, "write a birthday poem for my mother who loves gardening");
  assert.match(poem, /# Voice and Structure/);
  assert.doesNotMatch(poem, /Repository|database|Phase \d+ — Security review/);
  assert.match(poem, /Definition of done: A publishable draft/);

  const general = brief(p, "plan a picnic for twelve people next Saturday");
  for (const h of ["Role", "Goal", "Deliverable", "Approach", "Verification", "Final Deliverable", "Working Rules"]) assert.ok(headings(general).includes(h), h);
  assert.deepEqual(phases(general), ["Understand", "Do the work", "Check and deliver"]);
  assert.match(general, /Check your own work against the Goal, the requirements list and the definition of done/);
});

test("every preset yields a well-formed brief for every target model", () => {
  const p = load();
  for (const [name, text] of Object.entries(presets())) {
    for (const target of ["cheap", "premium", "balanced"]) {
      const out = brief(p, text, {}, target);
      assert.ok(out.startsWith("# Role\n"), name);
      assert.match(out, /# Goal\nThe job, in the requester's words:\n> /, name);
      assert.ok(out.includes(text.split("\n")[0]), name + ": job text quoted");
      assert.ok(headings(out).includes("Working Rules"), name);
      assert.doesNotMatch(out, /\n{3,}/, name + ": no triple blank lines");
      assert.doesNotMatch(out, /undefined|\[object|NaN/, name);
      assert.ok(out.length > 3000, name + " " + target + " is " + out.length + " chars");
    }
  }
});

test("a long, already-structured description is quoted as the requirements instead of being re-split", () => {
  const p = load();
  const long = "Add an email gate and usage analytics.\n\n* No password.\n* No account creation.\n* A simple email field and Continue button.\n\n" + "Then build an admin dashboard at /admin/usage with charts. ".repeat(30);
  const out = brief(p, long);
  const j = p.analyzeJob(long);
  assert.ok(j.long && j.structured);
  assert.match(out, /Treat every line of it as a requirement/);
  assert.doesNotMatch(out, /Requirements taken from that description/);
  assert.match(out, /> \* No password\./);
  assert.match(p.el("found").innerHTML, /quotes it as the requirements/);
});

test("the Step 2 strip reports what was read from the description", () => {
  const p = load();
  brief(p, GATE_JOB);
  const strip = p.el("found").innerHTML;
  assert.match(strip, /a software change with 3 requirements and 1 explicit exclusion/);
  assert.match(strip, /Email or login gate/);
  brief(p, "plan a picnic for twelve people next Saturday");
  assert.match(p.el("found").innerHTML, /No specialist playbook matched/);
});

test("playbook table is well-formed: unique ids, labels, and every implied id exists", () => {
  const p = load();
  const ids = p.playbooks.map(x => x.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate playbook id");
  for (const pb of p.playbooks) {
    assert.ok(pb.label && pb.kind, pb.id);
    assert.ok(Array.isArray(pb.strong) && Array.isArray(pb.weak), pb.id);
    for (const dep of pb.implies || []) assert.ok(ids.includes(dep), pb.id + " implies unknown " + dep);
  }
  assert.equal(ids[0], "code_core", "code_core leads so its assessment phase comes first");
});
