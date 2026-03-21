/* eslint-disable */
/**
 * Generated `api` utility.
 * THIS CODE IS AUTOMATICALLY GENERATED.
 * @module
 */

import type * as track from "../track.js";
import type * as queries from "../queries.js";
import type * as config from "../config.js";
import type * as crons from "../crons.js";
import type * as api_ from "../api.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import { anyApi, componentsGeneric } from "convex/server";

const fullApi: ApiFromModules<{
  track: typeof track;
  queries: typeof queries;
  config: typeof config;
  crons: typeof crons;
  api: typeof api_;
}> = anyApi as any;

export const api: FilterApi<typeof fullApi, FunctionReference<any, "public">> =
  fullApi as any;
export const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
> = fullApi as any;

export const components: ReturnType<typeof componentsGeneric> =
  componentsGeneric() as any;
