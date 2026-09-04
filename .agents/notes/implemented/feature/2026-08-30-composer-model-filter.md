# Agent Note: Free-text filter on the composer model picker

Status: implemented

English | [中文](2026-08-30-composer-model-filter.zh.md)

## Problem

The composer model seat (`conversation.input.model`) renders every provider-grouped
model in one scrolling list. With many custom providers the list grows long, and the
two-level menu drifts the user into a provider group before they can narrow the
choices. Picking a known model by name — the common case — should not require scanning
or scrolling past unrelated providers.

## Decision

Add a single free-text filter row at the top of the model pane (the drilled-in list),
above the provider groups. It filters by model display name, model id, and provider
name, case-insensitively, and drops provider groups that contribute no match. An empty
query keeps the full catalog; a non-empty query with no match shows a dedicated
`empty.filter` message instead of the `empty.models` (catalog-empty) message.

The query is pane-local state: it resets when the menu closes, when Escape backs out
of the model pane to the root, and when the user drills into the model pane from the
root. The filter input carries `autoFocus` so keyboard users land in it on drill-in,
and the existing `ArrowUp`/`ArrowDown` roving handler moves focus into the filtered
model rows. A clear (`×`) button appears only while the query is non-empty.

The filter is presentation-only: it does not touch the shared `ModelDirectory` state or
the Host selection path, so a filtered-out current model stays selected and the trigger
label is unaffected. A provider-local model id still matches even when the catalog omits
a friendly name, because the id participates in the match.

Locale keys `filter.placeholder`, `filter.aria`, `filter.clear`, and `empty.filter` join
the `model` namespace dictionary (`zh` source of truth, `en` complete against it).

## Alternatives considered

**Filter from the root pane.** The root shows only the Model/Effort cells, not the list,
so a root-pane filter would have to switch panes to be useful. Placing the field on the
model pane keeps the search next to the rows it narrows.

**A provider-scoped dropdown plus text search.** Two controls multiply the decision
surface for a single intent (find a model). One text field over grouped rows covers both
"by provider" and "by model" queries through the name/id match.

## Consequences

The model pane gains one always-visible input and its keyboard entry point (`autoFocus`).
Because the filter is presentational and pane-local, it adds no session state, no Host
round-trip, and no change to the selection contract; the shared directory and selection
verbs are untouched. The `model` locale namespace grows by four keys, kept complete in
`en`. Component coverage stays at 100% via the three filter scenarios in
`tests/model-select.client.spec.tsx`.

