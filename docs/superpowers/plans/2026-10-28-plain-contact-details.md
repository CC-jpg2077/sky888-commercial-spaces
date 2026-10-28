# Plain Public Contact Details Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render public contact phone and email values as plain text while preserving server sanitization, email validation, unchanged admin contact links, and clickable directions.

**Architecture:** Keep the existing public `renderSettings` flow and remove only the `tel:`/`mailto:` anchor construction for phone and email. Add a focused regression assertion against the public script while leaving the API and admin implementation unchanged.

**Tech Stack:** Node.js, vanilla browser JavaScript, `node:test`, Node `fs`.

**Spec:** Approved user request in the task prompt.

## Global Constraints

- Preserve server-side `field()` sanitization and `isEmail()` validation.
- Keep admin view and request-contact links unchanged.
- Change only public Location > Contact us phone and email rendering to plain text.
- Keep directions clickable.
- Make no schema or dependency changes.

## Review Focus

- Public phone rendering must not create a `tel:` link.
- Public email rendering must not create a `mailto:` link.
- Public directions must remain assigned as a clickable `href`.
- Admin request contact links must remain unchanged.
- Settings API validation and sanitization must remain covered by existing tests.

---

### Task 1: Render public contact details as text

**Files:**
- Modify: `public/js/site.js:92-115`
- Modify: `test/app.test.js` near the existing settings regression test

**Interfaces:**
- Consumes: Existing `renderSettings(st)` data from `/api/site`.
- Produces: Public contact lines containing text nodes for phone/email and a clickable `#directions` link.

- [x] **Step 1: Add the focused regression test**

Read `public/js/site.js` with the existing Node `fs` import and assert that phone/email are rendered without `tel:` or `mailto:` anchors, while the directions `href` assignment remains present.

- [x] **Step 2: Run the focused test and verify it fails**

Run: `node --test --test-name-pattern="public contact rendering" test/app.test.js`

Expected: FAIL because the current script still builds `tel:` and `mailto:` links.

- [x] **Step 3: Change `renderSettings`**

In `public/js/site.js`, keep the existing `line` helper and call it for phone/email without `href` arguments. Do not alter the directions assignment, office-hours behavior, or server routes.

- [x] **Step 4: Run the focused test and full suite**

Run: `node --test --test-name-pattern="public contact rendering" test/app.test.js`

Expected: PASS.

Run: `npm test`

Expected: All tests pass.

- [x] **Step 5: Review the diff**

Run: `git diff --check` and `git diff -- public/js/site.js test/app.test.js docs/superpowers/plans/2026-10-28-plain-contact-details.md`.

Expected: Only the requested plan, public rendering, and focused regression test changes are present; no admin, server validation, schema, or dependency changes.
