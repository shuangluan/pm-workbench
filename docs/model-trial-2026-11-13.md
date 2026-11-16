# Model trial, 2026-11-13

First manual run against a real model. One synthetic scenario, so this is a smoke test, not an evaluation.

**Setup:** Anthropic Messages, `claude-opus-5-5`, default settings (16,000 output tokens, 120 s timeout). Scenario "Self-serve refunds": three requests (Support wants instant refunds up to $500; Finance requires manager approval above $100 and a ledger entry for every refund; Risk requires refunds to the original payment method), a refund policy document, and a chat screenshot in which Sales asks for partial refunds per line item.

## Results

| Task | Attempts | Input / output tokens | Time | Estimated cost | Outcome |
| --- | --- | --- | --- | --- | --- |
| Connection test | 1 | not recorded | — | — | Connected |
| Screenshot reading | 1 | 518 / 70 | 2.9 s | $0.0035 | Verbatim transcript, speakers and "Me" correct |
| Request split (model) | 1 | 655 / 202 | 4.6 s | $0.0067 | Text kept verbatim, passed the quoting check; three relevant follow-up questions |
| Abstraction, template v2 | 1 | 2,283 / 4,412 | 43.9 s | $0.0974 | Passed validation first time |
| Abstraction, template v3 | 1 | 2,359 / 5,348 | — | — | Passed validation first time |

Costs use $4 / $20 per million input / output tokens.

**What the abstraction got right:** the planted $100–$500 conflict between Support and Finance; the less obvious conflict between Risk sign-off and the policy's "customer written consent" for store credit; the ledger export not supporting partial refunds; the "a manager" versus "a finance manager" ambiguity. It refused to turn approval or payment-destination rules into settings, and labelled facts, inferences and suggestions honestly. It also raised a risk not planted: splitting a refund into line items could stay under the approval threshold.

## Problems found and fixed

- **Evidence handles in prose.** Template v2 output wrote handles such as "E10 allows…" into claim text. Handles are internal and renumbered per report, so readers would be pointed at the wrong source. Template v3 forbids them in prose, and saving now replaces any that slip through with the source name. The v3 run contained none.
- **Input estimate too low.** The estimate was 1,340 tokens against 2,283 actual, because the schema and structured-output overhead were not counted. The estimate now includes the schema plus a fixed overhead calibrated on this call; the v3 run estimated 2,427 against 2,359 actual.

## Still open

- Coverage handling was too generous in the v2 run (a request whose core ask was not covered was marked as shared capability). The v3 run marked it correctly; one sample is not enough to call this fixed.
- The connection test is not recorded in the usage table.
- No evaluation set: quality is judged from one scenario by the person who wrote it.
