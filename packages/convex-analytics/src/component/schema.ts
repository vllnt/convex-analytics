import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { propsValidator, granularityValidator } from "./validators.js";

/**
 * Generic, domain-neutral analytics schema. Zero hardcoded web fields, zero `v.any()`.
 *
 * - `events` — raw event log (TTL-pruned).
 * - `rollups` — rollup-on-write counts per (scope, name, granularity, bucket, dim, val).
 * - `subjects` — per-subject lifecycle for uniques/retention.
 * - `sessions` — optional generic session aggregates for idle-close + session reads.
 * - `config` — cron-relevant config (retention/sampling) keyed by scope.
 */
export default defineSchema({
  events: defineTable({
    scope: v.string(),
    name: v.string(),
    subjectRef: v.optional(v.string()),
    sessionRef: v.optional(v.string()),
    props: propsValidator,
    ts: v.number(),
    seq: v.number(),
    dedupeKey: v.optional(v.string()),
  })
    .index("by_scope_name_ts", ["scope", "name", "ts"])
    .index("by_scope_subject_ts", ["scope", "subjectRef", "ts"])
    .index("by_scope_session_ts", ["scope", "sessionRef", "ts"])
    .index("by_dedupe", ["scope", "dedupeKey"]),

  rollups: defineTable({
    scope: v.string(),
    name: v.string(),
    granularity: granularityValidator,
    bucket: v.number(),
    dim: v.string(),
    val: v.string(),
    count: v.number(),
  })
    .index("by_scope_name_gran_bucket_dim", [
      "scope",
      "name",
      "granularity",
      "bucket",
      "dim",
      "val",
    ])
    .index("by_scope_name_dim_val", ["scope", "name", "dim", "val"]),

  subjects: defineTable({
    scope: v.string(),
    subjectRef: v.string(),
    firstSeen: v.number(),
    lastSeen: v.number(),
    eventCount: v.number(),
  })
    .index("by_scope_subject", ["scope", "subjectRef"])
    .index("by_scope_firstSeen", ["scope", "firstSeen"]),

  sessions: defineTable({
    scope: v.string(),
    sessionRef: v.string(),
    subjectRef: v.optional(v.string()),
    startTs: v.number(),
    endTs: v.optional(v.number()),
    lastTs: v.number(),
    eventCount: v.number(),
  })
    .index("by_scope_session", ["scope", "sessionRef"])
    .index("by_scope_lastTs", ["scope", "lastTs"]),

  config: defineTable({
    scope: v.string(),
    key: v.string(),
    value: v.string(),
  }).index("by_scope_key", ["scope", "key"]),
});
