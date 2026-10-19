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

Xiaoming preset configuration

public/assistant-preset.js is the source of the welcome message, suggested
questions and supplemental system prompt for 小铭, 新哲文院算法社's AI assistant.
In Chat administration click “填入小铭预设” to fill these three fields only. This
never changes the model or enabled state and never saves/publishes automatically.
Review the fields, click Save assistant configuration, import/review knowledge,
and publish a new release. Existing published answers do not change retroactively.

config-preset.json is a readable copy of those three configuration fields; it is
NOT a documents envelope and must NOT be selected in the knowledge JSON picker.
system-prompt.txt can be copied directly into the supplemental instructions field.
The knowledge import accepts seed.json. Rebuild/check the preset copies with
node tools/build-assistant-preset.mjs [--check].

The server also states the Xiaoming identity and fact/navigation boundaries in
its fixed policy. Updating that policy requires redeploying the generated chat
Dashboard bundle; changing drafts or static files alone does not update it.

Current-site audit and application steps: docs/assistant-validation/knowledge-refresh.md.
The review is of the current repository implementation, not a live production
crawl. Historical changelog text is not used as proof of current navigation.
