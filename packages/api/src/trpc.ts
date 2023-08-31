import { Store } from "@tableland/studio-store";
import { TRPCError, initTRPC } from "@trpc/server";
import superjson from "superjson";
import { z } from "zod";
import { Context } from "./context";

const t = initTRPC.context<Context>().create({ transformer: superjson });

export const middleware = t.middleware;
export const router = t.router;
export const publicProcedure = t.procedure;
export const protectedProcedure = publicProcedure.use((opts) => {
  const { session } = opts.ctx;
  if (!session.auth) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
    });
  }

  type FullSession = typeof session & {
    auth: NonNullable<(typeof session)["auth"]>;
    nonce: NonNullable<(typeof session)["nonce"]>;
  };
  return opts.next({
    ctx: {
      // Infers the `session` as non-nullable
      session: session as FullSession,
    },
  });
});
export const teamProcedure = (store: Store) =>
  protectedProcedure
    .input(z.object({ teamId: z.string().nonempty() }))
    .use(async (opts) => {
      const membership = await store.teams.isAuthorizedForTeam(
        opts.ctx.session.auth.user.teamId,
        opts.input.teamId,
      );
      if (!membership) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "not authorized for team",
        });
      }
      return opts.next({
        ctx: { teamAuthorization: membership },
      });
    });
export const teamAdminProcedure = (store: Store) =>
  teamProcedure(store).use(async (opts) => {
    if (!opts.ctx.teamAuthorization.isOwner) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "not authorized as team admin",
      });
    }
    return opts.next();
  });