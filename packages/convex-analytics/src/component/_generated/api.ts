/* eslint-disable */
/**
 * Generated `api` utility.
 * THIS CODE IS AUTOMATICALLY GENERATED.
 * @module
 */

import type * as mutations from "../mutations.js";
import type * as queries from "../queries.js";
import type * as internal_mutations from "../internal_mutations.js";
import type * as http from "../http.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import { anyApi, componentsGeneric } from "convex/server";

const fullApi: ApiFromModules<{
  mutations: typeof mutations;
  queries: typeof queries;
  internal_mutations: typeof internal_mutations;
  http: typeof http;
}> = anyApi as any;

export const api: FilterApi<typeof fullApi, FunctionReference<any, "public">> =
  fullApi as any;
export const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
> = fullApi as any;

export const components: ReturnType<typeof componentsGeneric> =
  componentsGeneric() as any;
