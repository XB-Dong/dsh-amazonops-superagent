# P1 native followup context map

Baseline bb3b1bbaa32aab5a423039f10b0a71f9cdfbecf9. Reviewed before edits.

Files: host/source, agent-tools, privacy and new followup-native modules integrate the existing Followups domain with native Engine/Source. Upstream operations, app runtime/sessions and executor tool schema expose narrowly scoped assessment and waiting. No core files change. Parent owns HTTP wiring, contracts, domain, client and release.

Dependencies: native Ticket/Mandate/Assignment, Source admission, policy observe/auto, DSH tools/Session, durable domain outbox and current risk/expiry/source guards. Tests: controlled host ports plus actual native DSH/SSE fixture. P0 tests remain regressions, not P1 proof.

Risks: machine input must not become new authority; delivered event remains valid for current-policy revalidation; no ended/blocked/attention wake; waiting is not a result; actual answer/attention/final result use native outbox. Model-free domain processing and original core hashes remain intact.

Follow-up diagnosis: current event authorization and historical read provenance must be separate. A later risk transition invalidates old draft authority but does not erase a valid earlier source. Trigger reads check immutable same-scope source/event identity, text, actor and complete nondeleted lineage; current assessment and draft execution still recheck the latest domain risk/rule/expiry. Deleting earlier consumed sources continues to retire the native context.

Wake gating uses the native ticketStage person category as its single rule, including failed delivery, answer, review, blocked and failed; it does not duplicate only a subset of those conditions. This keeps all human handoffs quiet until actual human/native recovery changes the stage.
