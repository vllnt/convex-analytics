import { defineApp } from "convex/server";
import analytics from "@vllnt/convex-analytics/convex.config";

const app = defineApp();
app.use(analytics);
export default app;
