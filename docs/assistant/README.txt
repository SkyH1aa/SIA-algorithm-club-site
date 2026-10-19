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
The ECA schedule is explicitly bound to join.html's static wording; it is not a
confirmation of this week's schedule. The assistant page is an implementation
draft, so this seed does not establish deployment or current availability.

source_path values use repository-root URLs: /index.html or /public/*.html.
The JSON envelope is {"documents":[...]}. The seed is well below the backend's
200-document and 2,000,000-content-byte corpus bounds. Validate current public copy
and permissions before importing or publishing.

Sign in to Chat administration as a server-authorized super-admin, open Assistant
knowledge, and press Refresh to load the shared version. Pick seed.json, inspect
the plain-text preview, then explicitly submit JSON import. This saves drafts only.
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
