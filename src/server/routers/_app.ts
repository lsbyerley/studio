import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { TRPC_ERROR_CODE_KEY } from "@trpc/server/rpc";
import { protectedProcedure, publicProcedure, router } from "@/server/trpc";
import { generateNonce, SiweErrorType, SiweMessage, SiweResponse } from "siwe";
import { getIronSession, IronSessionOptions } from "iron-session";
import { sessionOptions } from "@/lib/withSession";
import {
  createUserAndPersonalTeam,
  userAndPersonalTeamByAddress,
  teamBySlug,
  teamById,
  teamsByUserId,
  createTeamByUser,
} from "@/db/api";

export const appRouter = router({
  authenticated: publicProcedure.query(({ ctx }) => {
    return ctx.session.auth ? ctx.session.auth : false;
  }),
  nonce: publicProcedure.query(async ({ ctx }) => {
    ctx.session.nonce = generateNonce();
    await ctx.session.save();
    return ctx.session.nonce;
  }),
  login: publicProcedure
    .input(z.object({ message: z.string(), signature: z.string() }))
    .mutation(async ({ ctx, input: { message, signature } }) => {
      let fields: SiweResponse;
      try {
        const siweMessage = new SiweMessage(message);
        fields = await siweMessage.verify({
          signature,
          nonce: ctx.session.nonce || undefined,
          // TODO: do we want to verify domain and time here?
        });
      } catch (e: any) {
        ctx.session.auth = null;
        ctx.session.nonce = null;
        await ctx.session.save();
        let code: TRPC_ERROR_CODE_KEY;
        switch (e) {
          case SiweErrorType.EXPIRED_MESSAGE:
          case SiweErrorType.NOT_YET_VALID_MESSAGE: {
            code = "PRECONDITION_FAILED";
            break;
          }
          case SiweErrorType.INVALID_SIGNATURE:
          case SiweErrorType.DOMAIN_MISMATCH:
          case SiweErrorType.INVALID_ADDRESS:
          case SiweErrorType.INVALID_DOMAIN:
          case SiweErrorType.INVALID_MESSAGE_VERSION:
          case SiweErrorType.INVALID_NONCE:
          case SiweErrorType.INVALID_TIME_FORMAT:
          case SiweErrorType.INVALID_URI:
          case SiweErrorType.NONCE_MISMATCH:
          case SiweErrorType.UNABLE_TO_PARSE: {
            code = "UNPROCESSABLE_CONTENT";
            break;
          }
          default: {
            code = "INTERNAL_SERVER_ERROR";
            break;
          }
        }
        throw new TRPCError({
          code,
          cause: e,
          message: e.message,
        });
      }
      const finalOptions: IronSessionOptions = {
        ...sessionOptions,
        cookieOptions: {
          ...sessionOptions.cookieOptions,
          expires: fields.data.expirationTime
            ? new Date(fields.data.expirationTime)
            : sessionOptions.cookieOptions?.expires,
        },
      };
      let info = await userAndPersonalTeamByAddress(fields.data.address);
      if (!info) {
        info = await createUserAndPersonalTeam(fields.data.address);
      }
      const session = await getIronSession(ctx.req, ctx.res, finalOptions);
      session.auth = {
        siweFields: fields.data,
        userId: info.user.id,
        personalTeamId: info.personalTeam.id,
      };
      await session.save();
      return session.auth;
    }),
  logout: protectedProcedure.mutation(({ ctx }) => {
    ctx.session.destroy();
  }),
  teamByName: protectedProcedure
    .input(z.object({ name: z.string() }))
    .query(async ({ ctx, input: { name } }) => {
      const team = await teamBySlug(name);
      if (!team) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Team not found",
        });
      }
      return team;
    }),
  teamById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input: { id } }) => {
      const team = await teamById(id);
      if (!team) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Team not found",
        });
      }
      return team;
    }),
  teamsForUser: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input: { userId } }) => {
      const teams = await teamsByUserId(userId);
      const res: { label: string; teams: { id: string; name: string }[] }[] = [
        {
          label: "Personal Account",
          teams: [],
        },
        {
          label: "Teams",
          teams: [],
        },
      ];
      teams.forEach((team) => {
        if (team.personal) {
          res[0].teams.push({
            id: team.id,
            name: team.name || "Personal Team",
          });
        } else {
          res[1].teams.push({ id: team.id, name: team.name || "Missing" });
        }
      });
      return res;
    }),
  newTeam: protectedProcedure
    .input(z.object({ name: z.string() }))
    .mutation(async ({ ctx, input: { name } }) => {
      const team = await createTeamByUser(name, ctx.session.auth.userId);
      return team;
    }),
});

// export type definition of API
export type AppRouter = typeof appRouter;