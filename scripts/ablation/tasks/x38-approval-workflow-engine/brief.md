# Approval workflow engine

Implement `src/workflow.mjs` exporting `WorkflowError` and
`createWorkflow(opts)`. The contract below is LARGE on purpose — you have a
bounded session; maximize correctness. `node check.mjs` is a smoke subset.

## createWorkflow({ author }) 

Returns an object with:

- `state`: current state, starts at "draft";
- `log`: array of every SUCCESSFUL transition, in order, each entry
  `{ from, action, actor, to }` (failed attempts are never logged);
- `transit(action, actor, payload)`: performs a transition and returns the new
  state, or throws `WorkflowError` (see below). `payload` defaults to {}.

## States and legal transitions

draft → (submit) → in_review
in_review → (approve) → approved
in_review → (reject) → rejected
in_review → (escalate) → escalated
escalated → (approve) → approved
escalated → (reject) → rejected
rejected → (submit) → in_review
draft → (withdraw, author only) → withdrawn
in_review → (withdraw, author only) → withdrawn

approved, rejected (without submit), withdrawn: terminal — every action from
them is illegal. Any (state, action) pair not listed above is illegal.

## Guards

- approve/reject by the document's author → error code "SELF_REVIEW" (any
  other actor is fine; submit and escalate accept any actor).
- withdraw by anyone but the author → error code "ILLEGAL_TRANSITION".
- reject requires `payload.reason` to be a non-empty string, otherwise error
  code "REASON_REQUIRED".
- Anything illegal → error code "ILLEGAL_TRANSITION".

## WorkflowError

Extends Error; `name` is "WorkflowError"; has a `code` property with one of
the three codes above. Guards are checked in this order: transition legality,
then SELF_REVIEW, then REASON_REQUIRED.

Run `node check.mjs` for the smoke subset.

When you believe the task is complete, end your final message with the line `TASK COMPLETE: x38-approval-workflow-engine`.
