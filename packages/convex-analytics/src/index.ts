/**
 * convex-analytics — Full-featured API-first analytics engine for Convex
 *
 * @example
 * ```typescript
 * // Untyped (zero friction):
 * const analytics = new ConvexAnalytics(components.analytics);
 *
 * // Typed (compile-time safety):
 * const analytics = new ConvexAnalytics<MyEvents>(components.analytics);
 * ```
 */

export { ConvexAnalytics } from "./client.js";
export type {
  ConvexAnalyticsConfig,
  TrackMetadata,
  Dimension,
  DefaultEventMap,
} from "./client.js";
