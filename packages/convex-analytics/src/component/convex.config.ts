import { defineComponent } from "convex/server";
import aggregate from "@convex-dev/aggregate/convex.config";
import shardedCounter from "@convex-dev/sharded-counter/convex.config";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";

const component = defineComponent("analytics");

component.use(aggregate);
component.use(shardedCounter);
component.use(rateLimiter);

export default component;
