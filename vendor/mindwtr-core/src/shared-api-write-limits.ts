// Single home for two numeric limits that apps/cloud (the self-hosted REST API) and
// apps/mcp-server (the MCP write surface) each hand-maintained independently and had
// drifted apart (2026-07-30 deepening).
//
// AREA_NAME_MAX_LENGTH: cloud used to reuse MAX_TASK_TITLE_LENGTH (500) for area names; aligned
// to MCP's stricter 200 (nothing user-visible depended on the looser 500).
//
// LIST_PAGE_MAX_LIMIT: MCP capped page size at 500 while cloud's documented/deployed value was
// 1000 (post-review correction, 2026-07-31: widening MCP up to cloud's value, not the reverse —
// a paging client already sending `limit=1000` against cloud was silently getting half its
// collection back under a 500 clamp; nobody is hurt by MCP allowing what cloud already did).
//
// Zero external dependencies, so this stays safe to import from anywhere.
export const AREA_NAME_MAX_LENGTH = 200;
export const LIST_PAGE_MAX_LIMIT = 1000;
