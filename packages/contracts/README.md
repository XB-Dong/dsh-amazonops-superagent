# Transport contracts

Pure TypeScript DTO declarations. Adapted from the existing ccagent MIT domain schemas at the recorded baseline; no database, server, model or React runtime dependencies. The client imports this package instead of implementation classes. InventoryProjection is explicit data, not ReturnType of a business function. Work DTOs project native SuperAgent/DSH state; they do not establish a second authoritative conversation store.
