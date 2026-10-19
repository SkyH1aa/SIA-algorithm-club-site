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

The approved assistant flow uses exactly two model requests for a normally
completed question. Request 1 uses an ordinary prompt containing fixed policy,
the published supplemental prompt and the known read definitions (names, purposes
and JSON parameter schemas). It returns only a JSON plan: query with 1..2 fixed
reads, clarify, or answer without a live read. The server strictly validates the
entire plan and all arguments before any read. Request 2 receives the validated,
bounded evidence or no-read/clarification outcome and produces the final answer.
The final answer retains the full bounded static passages selected by retrieval,
not just source cards or a planner summary. The two-stage runtime is connected to
Chat. It cannot request another read or another planning round. Failed validation,
insufficient budget, timeout or cancellation can end early; there is no planning
retry or third model request. Static knowledge retains bounded keyword retrieval;
live read selection is semantic. Current facts require fresh successful evidence,
even if history or a summary contains an older answer.

Native function/tool support and provider-specific JSON modes are not required.
The configured Responses, Claude Messages or Chat Completions endpoint must support
ordinary SSE, and the planner must return a valid JSON plan. Unknown fields, reads,
invalid argument types/ranges and more than two reads are rejected server-side;
prompt instructions alone do not enforce these boundaries. No arbitrary URLs,
tables, SQL, RPCs, authentication headers or business write actions are exposed.
Do not fake a successful read or switch keys/providers on an invalid plan.

The preset describes all three tools:
- read_member_points: public member_name/points only. Required order_by
  (points/member_name), direction, page, page_size; optional exact member_name and
  min_points/max_points. Highest points: points, desc, page 1, page_size 1.
- read_game_leaderboard: required board, board-valid order_by, direction, page,
  page_size; optional exact name and min_score/max_score decimal strings. Boards:
  gomoku, tetris, tetris_versus, snake, snake_versus, platformer. Lowest Gomoku
  cumulative score: gomoku, total_score, asc, page 1, page_size 1.
- read_published_content: required kind (announcements/events), order_by (default,
  created_at/updated_at/starts_at/ends_at), direction, page, page_size. Optional id,
  literal title_contains, category, events-only status, date_field with after/before
  timestamps. Full schema constraints are injected by the server.

For every tool direction is asc/desc, page 1..100 and page_size 1..50. Highest and
lowest values require the requested metric's desc/asc database order on page 1,
respectively. Fetch only the bounded pages needed for the question; never traverse
all pages or promise full unbounded access. Normal/versus mode must be clarified
when unspecified. Exact member names must be explicitly supplied, not extracted
from a query phrase; duplicate names cannot be resolved by guessing a class.

Live source cards retain time/status/scope and show validated order, page, returned
count and whether more results are available. Page order is not a global rank;
counts and has_more are not a population count. Source headers contain metadata,
never rows or raw filters. Read results retain the adapter's bounded rows/filters
for model evidence; all such content is untrusted data, never instructions. Static
sources are at most 4/<4000 encoded characters, each live source <=980; at most
2 live sources plus static references fit the 12000-character header budget.
Unavailable, paused, empty or ambiguous results do not prove current values or
global absence. No live reads occur during catalog or compaction. The frontend
stays generating while the server collects the final answer before normalized
Responses SSE delivery. Planning JSON, text/analysis and internal parameters are
hidden from the frontend and browser history; only the final answer and sources
are retained. This does not stream planning tokens to the user.

Planning, reads and answering share one 120-second overall deadline, subject to
shorter platform/provider limits. Cancellation aborts model and data requests.
Existing limits remain: each read <=5 seconds, raw response <=64 KiB, result
envelope <=6000 bytes; page 1..100, page_size 1..50, model request <=12 MiB and
upstream SSE <=2 MiB per request. At most two reads produce aggregate serialized
evidence <=16000 bytes; each read still meets its individual 6000-byte limit.
The JSON plan is <=8192 bytes. No recursive planning or full traversal is allowed.

Both model requests share one request_id, one admission, one lease, one audit
record and one total output budget. Reserve both inputs and bounded plan/evidence
context; planner output consumes the shared budget and must leave room for the
final answer. Combine actual usage for settlement and UI accounting. Missing
complete usage or failure/cancellation after upstream starts retains conservative
accounting; a partial first-stage usage is not a basis for refunding the rest.
Only a database-confirmed not-started request can receive the existing safe refund.
The planner strips reasoning/include, and Claude Messages planning explicitly
disables thinking. The answer retains the model's configured thinking/reasoning
within the remaining shared output budget. Reserve Claude enabled thinking's
minimum only for the answer, not a second thinking minimum for planning.
Insufficient budget fails instead of changing saved configuration or adding a request.
Daily admission uses the current UTC day bucket (08:00 Beijing reset), not the
90-day usage report. Raising a quota does not clear usage or unsettled reservations.
Existing quota/audit writes remain generation accounting, not business mutations.

Audit error_code contains only a safe category, never raw plans, arguments/results,
provider response bodies, authentication headers or keys:
- assistant_plan_json / assistant_plan_invalid / assistant_plan_arguments /
  assistant_plan_size: JSON parsing, plan structure, read arguments or plan size.
- assistant_plan_http / assistant_plan_network / assistant_plan_stream /
  assistant_plan_usage: planner HTTP/SSE, network, stream or missing output usage.
- assistant_answer_http / assistant_answer_network / assistant_answer_stream:
  final-answer HTTP/SSE, network or stream failure.
- assistant_output_budget / assistant_context / assistant_request_size /
  assistant_evidence_size: output, context, request or aggregate evidence limits.
- assistant_plan_failed: safe fallback for otherwise unclassified failures.
Existing cancellation/database/auth/quota/protocol categories remain in use. A
category alone does not prove a successful read or entitlement to a refund.

The two-stage switch changes no SQL and performs no SQL execution or deployment.
For an existing current assistant whose club-drive already has assistant_read_query,
only replace the complete chat index.ts with chat-dashboard-index.ts after checking
the deployment artifact. No club-drive/proxy redeployment, frontend/file-bundle
publication, preset/seed change or knowledge republish is required just for this
backend switch. The current model configuration can stay. A club-drive without the
query action needs the separate earlier live-read upgrade; first installation and
prior math/static updates have their own instructions in docs/chat-deployment/README.md.
Preserve other club-drive actions and existing authentication.

Offline validation passed: 187 real-handler mock integration cases, 115 plan/SSE
cases, fixed-read boundaries, retained protocol regressions, Chat core and knowledge
checks. Type checks and Dashboard bundle/source consistency checks passed. These
checks do not establish live provider semantics, endpoint permissions or deployment.

Explicitly check Supabase Dashboard > Edge Functions > Secrets for the exact name
CLUB_SERVICE_ROLE_KEY before a later deployment. club-drive still reads this name;
no code fallback to SUPABASE_SERVICE_ROLE_KEY or another name was added. A platform
SUPABASE_SERVICE_ROLE_KEY alone does not satisfy this check. If absent, an admin
must configure it securely in Secrets. Never put any key value in documentation,
source, frontend, model configuration or validation records. The flow introduces
no new key type or model administrator privilege. No live data read or paid
provider call was performed. See docs/assistant-validation/semantic-read-tools.md
for the runtime contract, safe error categories and validation record.

Current-site audit and application steps: docs/assistant-validation/knowledge-refresh.md.
The review is of the current repository implementation, not a live production
crawl. Historical changelog text is not used as proof of current navigation.
