import {
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from "http";
import { type CookieSerializeOptions } from "cookie";
import { type Store } from "@tableland/studio-store";
import { TRPCError, initTRPC } from "@trpc/server";
import superjson from "superjson";
import { ZodError, z } from "zod";
import { getIronSession } from "iron-session";
import { type SessionData, sessionOptions } from "./session-data";

// TODO: the types and interfaces below are from iron-session, but they aren't exported.
//      maybe we can open a PR to export them, or maybe there's a better way to get them?

/**
 * {@link https://wicg.github.io/cookie-store/#dictdef-cookielistitem CookieListItem}
 * as specified by W3C.
 */
interface CookieListItem
  extends Pick<
    CookieSerializeOptions,
    "domain" | "path" | "sameSite" | "secure"
  > {
  /** A string with the name of a cookie. */
  name: string;
  /** A string containing the value of the cookie. */
  value: string;
  /** A number of milliseconds or Date interface containing the expires of the cookie. */
  expires?: CookieSerializeOptions["expires"] | number;
}
/**
 * Superset of {@link CookieListItem} extending it with
 * the `httpOnly`, `maxAge` and `priority` properties.
 */
type ResponseCookie = CookieListItem &
  Pick<CookieSerializeOptions, "httpOnly" | "maxAge" | "priority">;
/**
 * The high-level type definition of the .get() and .set() methods
 * of { cookies() } from "next/headers"
 */
interface CookieStore {
  get: (name: string) =>
    | {
        name: string;
        value: string;
      }
    | undefined;
  set: {
    (name: string, value: string, cookie?: Partial<ResponseCookie>): void;
    (options: ResponseCookie): void;
  };
}

// To get the session we want to allow callers to provided cookies or a
// req+res set. This allows flexibility in TRPC adapter usage.
export interface GetSessionArgs {
  headers?: Headers | IncomingHttpHeaders;
  cookies?: CookieStore;
  req?: IncomingMessage | Request;
  res?: Response | ServerResponse;
}
/**
 * 1. CONTEXT
 *
 * This section defines the "contexts" that are available in the backend API.
 *
 * These allow you to access things when processing a request, like the database, the session, etc.
 *
 * This helper generates the "internals" for a tRPC context. The API handler and RSC clients each
 * wrap this and provides the required context.
 *
 * @see https://trpc.io/docs/server/context
 */

export const createTRPCContext = async (args: GetSessionArgs) => {
  const session = await getSession(args);

  logTrpcSource(args.headers, session);

  return { session };
};

// Determine if caller has given cookies or req+res set, then return session.
export const getSession = async function ({
  cookies,
  req,
  res,
}: GetSessionArgs) {
  if (typeof cookies !== "undefined") {
    return await getIronSession<SessionData>(cookies, sessionOptions);
  }

  if (typeof req !== "undefined" && typeof res !== "undefined") {
    return await getIronSession<SessionData>(req, res, sessionOptions);
  }

  throw new Error(
    "cannot get session from context must supply cookies or req and res",
  );
};

// get a header from either of the accepted header types
const getSourceHeader = function (headers: unknown) {
  if (typeof headers === "undefined" || headers === null) return "";
  if (headers instanceof Headers) return headers.get("x-trpc-source");

  if (hasTrpcSource(headers)) {
    return headers["x-trpc-source"];
  }

  return "";
};

const logTrpcSource = function (
  headers: IncomingHttpHeaders | Headers | undefined,
  session: SessionData,
) {
  if (typeof headers === "undefined") return;

  const source = getSourceHeader(headers);

  console.log(
    ">>> tRPC Request from",
    source,
    "by",
    session?.auth?.user.address ?? "unauthenticated user",
  );
};

interface SourceHeader {
  "x-trpc-source": string;
}
const hasTrpcSource = function (headers: unknown): headers is SourceHeader {
  return (
    (headers as SourceHeader)?.["x-trpc-source"] !== undefined &&
    typeof (headers as SourceHeader)["x-trpc-source"] === "string"
  );
};

/**
 * 2. INITIALIZATION
 *
 * This is where the trpc api is initialized, connecting the context and
 * transformer
 */
const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
  errorFormatter: ({ shape, error }) => ({
    ...shape,
    data: {
      ...shape.data,
      zodError: error.cause instanceof ZodError ? error.cause.flatten() : null,
    },
  }),
});

/**
 * Create a server-side caller
 * @see https://trpc.io/docs/server/server-side-calls
 */
export const createCallerFactory = t.createCallerFactory;

/**
 * 3. ROUTER & PROCEDURE (THE IMPORTANT BIT)
 *
 * These are the pieces you use to build your tRPC API. You should import these
 * a lot in the /src/server/api/routers folder
 */

/**
 * This is how you create new routers and subrouters in your tRPC API
 * @see https://trpc.io/docs/router
 */
export const createTRPCRouter = t.router;

/**
 * Public (unauthed) procedure
 *
 * This is the base piece you use to build new queries and mutations on your
 * tRPC API. It does not guarantee that a user querying is authorized, but you
 * can still access user session data if they are logged in
 */
export const publicProcedure = t.procedure;

/**
 * Protected (authenticated) procedure
 *
 * If you want a query or mutation to ONLY be accessible to logged in users, use this. It verifies
 * the session is valid and guarantees `ctx.session.user` is not null.
 *
 * @see https://trpc.io/docs/procedures
 */
export const protectedProcedure = publicProcedure.use(async ({ ctx, next }) => {
  if (!ctx.session.auth) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  // infers the `session.auth` as non-nullable
  type AuthedSession = typeof ctx.session & {
    auth: NonNullable<typeof ctx.session.auth>;
  };
  return await next({
    ctx: {
      session: ctx.session as AuthedSession,
    },
  });
});

export const teamProcedure = (store: Store) =>
  protectedProcedure
    .input(z.object({ teamId: z.string().trim().nonempty().optional() }))
    .use(async ({ ctx, input, next }) => {
      // we want to check for null, undefined, and ""
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      const teamId = input.teamId || ctx.session.auth.user.teamId;
      const membership = await store.teams.isAuthorizedForTeam(
        ctx.session.auth.user.teamId,
        teamId,
      );
      if (!membership) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "not authorized for team",
        });
      }
      input.teamId = teamId;
      return await next({
        ctx: {
          ...ctx,
          session: ctx.session,
          teamAuthorization: membership,
          teamId,
        },
      });
    });

export const teamAdminProcedure = (store: Store) =>
  teamProcedure(store).use(async ({ ctx, next }) => {
    if (!ctx.teamAuthorization.isOwner) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "not authorized as team admin",
      });
    }
    return await next({ ctx });
  });

export const projectProcedure = (store: Store) =>
  protectedProcedure
    .input(z.object({ projectId: z.string().trim().nonempty() }))
    .use(async ({ ctx, input, next }) => {
      const team = await store.projects.projectTeamByProjectId(input.projectId);
      if (!team) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "no team for project id found",
        });
      }
      const membership = await store.teams.isAuthorizedForTeam(
        ctx.session.auth.user.teamId,
        team.id,
      );
      if (!membership) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "not authorized for team",
        });
      }
      return await next({
        ctx: { ...ctx, session: ctx.session, teamAuthorization: membership },
      });
    });

export const projectAdminProcedure = (store: Store) =>
  projectProcedure(store).use(async ({ ctx, next }) => {
    if (!ctx.teamAuthorization.isOwner) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "not authorized as project admin",
      });
    }
    return await next({ ctx });
  });

export const defProcedure = (store: Store) =>
  protectedProcedure
    .input(z.object({ defId: z.string().trim().uuid() }))
    .use(async ({ ctx, input, next }) => {
      const team = await store.defs.defTeam(input.defId);
      if (!team) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "no team for def id found",
        });
      }
      const membership = await store.teams.isAuthorizedForTeam(
        ctx.session.auth.user.teamId,
        team.id,
      );
      if (!membership) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "not authorized for team",
        });
      }
      return await next({
        ctx: { ...ctx, session: ctx.session, teamAuthorization: membership },
      });
    });
