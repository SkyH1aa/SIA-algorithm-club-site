Assistant knowledge seed (manual draft)

seed.json contains 14 Chinese draft documents covering the club overview, navigation,
resources, labs, joining, login/binding, Chat local history/attachments/quota,
assistant privacy/source checking, check-in, activities, points, store and unknown/contact FAQ.

source-manifest.json records the concrete repository files, HTML selectors,
translation keys, claim scope and freshness boundary for every document. Review
means source-code review of static user-facing copy, not live operational verification.
Member-gated pages contribute gate labels; general usage facts come from public
member-center, guide and club-features copy. No authenticated API data was read.
No member records, admin-only instructions, actual invite/check-in codes, keys,
private messages, live events, balances, rankings, prices or inventory are included.
Specific ECA times and attendance frequency have been removed from the seed:
join.html's static wording is not confirmation of this week's schedule. The
assistant page and seed do not establish deployment or current availability.

source_path values use repository-root URLs: /index.html or /public/*.html.
The JSON envelope is {"documents":[...]}. The seed is well below the backend's
200-document and 2,000,000-content-byte corpus bounds. Validate current public copy
and permissions before importing or publishing.

Sign in to Chat administration as a server-authorized super-admin. Assistant data
loads automatically after authorization; opening Assistant knowledge reuses that
loaded version and does not overwrite unsaved edits. Refresh explicitly to retry
a failed read or resolve a version conflict. Pick seed.json, inspect the plain-text
preview, then explicitly submit JSON import. This saves drafts only. Importing the
same 14 slugs updates the existing drafts; unrelated custom documents stay intact.
Review drafts and model configuration before separately confirming Publish.
The Markdown/text picker fills one document editor; finish metadata and save it.
File pickers allow 4 MB maximum; document content is at most 50,000 characters.
Backend total corpus limits include archived documents and remain authoritative.

On a version conflict, unsaved forms and staged JSON remain visible but writes are
blocked. Refresh explicitly to review current configuration/version; document
editor text and staged JSON are retained for comparison before resubmission.
Archive excludes a draft from new releases; saving/importing its slug restores it.
Publishing snapshots saved configuration and active documents into an immutable
release. Rollback changes the active release pointer and preserves current drafts.
The enabled switch is a live availability control when saved, even if a release
already exists; disabling it stops assistant runtime availability. Draft imports
alone never publish, enable or deploy anything.

Bru preset configuration

public/assistant-preset.js is the source of the welcome message, suggested
questions and supplemental system prompt for 小Bru, 新哲文院算法社's AI assistant.
In Chat administration click “填入小Bru预设” to fill these three fields only. This
never changes the model or enabled state and never saves/publishes automatically.
Review the fields, click Save assistant configuration, import/review knowledge,
and publish a new release. Existing published answers do not change retroactively.

config-preset.json is a readable copy of those three configuration fields; it is
NOT a documents envelope and must NOT be selected in the knowledge JSON picker.
system-prompt.txt can be copied directly into the supplemental instructions field.
The knowledge import accepts seed.json. Rebuild/check the preset copies with
node tools/build-assistant-preset.mjs [--check].

The server also states the 小Bru identity and fact/navigation boundaries in
its fixed policy. Updating that policy requires redeploying the generated chat
Dashboard bundle; changing drafts or static files alone does not update it.

Math rendering and member-level live reads (2026-10-19)

Normal Chat and the assistant share pinned local KaTeX 0.19.0 through chat-math.js.
Publish the entire public/vendor/chat/katex directory with its fonts and LICENSE.
Raw message history, copying and exports preserve the original Markdown/TeX.

The new assistant prompt distinguishes published static knowledge from current,
bounded read-only evidence. The seed describes this capability but contains no
actual member or ranking data. Only published announcements/events, names and
points, and the six existing public game leaderboards are supported. No admin
records, bindings, emails, classes or user UUIDs enter model evidence. Admin users
receive the same member-level projection. Duplicate member names require clarification.
Tetris/Snake ordinary and versus boards stay separate; versus high scores may be
negative player-minus-AI differences. These are not model-strength rankings.

Single-board reads default to 20 rows, at most 50; all six boards use at most 10
rows each. Live evidence includes query time, status and truncation. Unavailable,
paused, empty or ambiguous results do not prove current facts or global absence.
This is deterministic intent routing, not unrestricted natural-language tools.
No live reads occur during catalog or compaction. Existing quota/audit writes stay
part of generation accounting; no new business mutation actions are exposed.

For an existing current assistant installation, this update requires no SQL.
Replace the complete generated chat Dashboard index.ts in the web editor, publish
the listed static assets, and review/save/publish the new preset and seed through
the existing administration flow. No new secret or administrator privilege is
required. No actual deployment, live data read or paid provider call was performed.
See docs/chat-deployment/README.md and
 docs/assistant-validation/markdown-live-query.md for limits and verification.

Current-site audit and application steps: docs/assistant-validation/knowledge-refresh.md.
The review is of the current repository implementation, not a live production
crawl. Historical changelog text is not used as proof of current navigation.
