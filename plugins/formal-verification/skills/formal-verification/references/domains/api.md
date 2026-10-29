# Domain: API and backend logic

## What to extract from the code

Every entry point: routes/handlers, RPC methods, CLI commands, cron jobs, queue consumers, webhook receivers. For each, record the request shape, the validation rules, the authorization check, the state transitions, the response shape (including error envelopes), and the side effects (writes, mails, events, external calls).

## How to model it

One action per endpoint-operation pair: `createTodoValid`, `createTodoInvalid`, `createTodoUnauthorized`, `createTodoOversized`. The model state tracks the resource store, the response code of the last operation, and any idempotency-key registry. Include actions for malformed input, unknown fields, over-limit bodies, and wrong-method requests — the model must show these rejected before any state change.

## Invariants (adapt names to the system)

- `unknownKeysRejected` — requests with unknown mutation keys never change state.
- `errorsCarryNoPartialState` — every error response leaves the store exactly as it was.
- `idempotentReplaySafe` — repeating a request with the same idempotency key returns the original receipt without re-executing effects.
- `authCheckedFirst` — no state-changing action fires for an unauthenticated or unauthorized actor.

## Negative controls (must FAIL in isolation)

- A malformed payload that the model accepts (proves validation is modeled — if this passes, validation is missing from the model).
- A replayed idempotent request that executes effects twice.
- An unauthorized request that changes state.

## Conformance checks to generate

Drive the real API through the model's traces: valid → invalid → unauthorized → oversized → replay. Compare status codes, error envelopes, and resulting state against the model after each step. Any divergence is a bug in one of the two — resolve explicitly.
