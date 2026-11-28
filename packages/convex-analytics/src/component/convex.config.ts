import { defineComponent } from "convex/server";
import aggregate from "@convex-dev/aggregate/convex.config";
import shardedCounter from "@convex-dev/sharded-counter/convex.config";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";

/** The analytics component definition. Mount it with `app.use(analytics)` in `convex/convex.config.ts`. */
const component = defineComponent("analytics");

component.use(aggregate);
component.use(shardedCounter);
component.use(rateLimiter);

export default component;
