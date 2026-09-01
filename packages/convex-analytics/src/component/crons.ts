import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "analytics:close-sessions",
  { minutes: 30 },
  internal.internal_mutations.closeSessions,
  {},
);
crons.interval(
  "analytics:prune-events",
  { hours: 24 },
  internal.internal_mutations.prune,
  {},
);

export default crons;
