import { TRPCError } from "@trpc/server";
import { z } from "zod";

import db from "@/db/api";
import { protectedProcedure, publicProcedure, router } from "@/server/trpc";
import { sendInvite } from "@/utils/send";
import { unsealData } from "iron-session";

export const teamsRouter = router({
  teamByName: protectedProcedure
    .input(z.object({ name: z.string() }))
    .query(async ({ ctx, input: { name } }) => {
      const team = await db.teams.teamBySlug(name);
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
      const team = await db.teams.teamById(id);
      if (!team) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Team not found",
        });
      }
      return team;
    }),
  teamsForPersonalTeam: protectedProcedure
    .input(z.object({ personalTeamId: z.string() }))
    .query(async ({ ctx, input: { personalTeamId } }) => {
      const teams = await db.teams.teamsByMemberTeamId(personalTeamId);
      return teams;
    }),
  newTeam: protectedProcedure
    .input(
      z.object({
        name: z
          .string()
          .regex(
            new RegExp("[A-Za-z]"),
            "Team name must include at least one letter"
          ),
        emailInvites: z.array(z.string()),
      })
    )
    .mutation(async ({ ctx, input: { name, emailInvites } }) => {
      const { team, invites } = await db.teams.createTeamByPersonalTeam(
        name,
        ctx.session.auth.user.teamId,
        emailInvites
      );
      await Promise.all(invites.map((invite) => sendInvite(invite)));
      return team;
    }),
  inviteEmails: protectedProcedure
    .input(
      z.object({ teamId: z.string(), emails: z.array(z.string().email()) })
    )
    .mutation(async ({ ctx, input: { teamId, emails } }) => {
      if (
        !(await db.teams.isAuthorizedForTeam(
          ctx.session.auth.user.teamId,
          teamId
        ))
      ) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You are not authorized for this team",
        });
      }
      const invites = await db.invites.inviteEmailsToTeam(
        teamId,
        ctx.session.auth.user.teamId,
        emails
      );
      await Promise.all(invites.map((invite) => sendInvite(invite)));
    }),
  acceptInvite: protectedProcedure
    .input(z.object({ seal: z.string() }))
    .mutation(async ({ ctx, input: { seal } }) => {
      const { inviteId } = await unsealData(seal, {
        password: process.env.DATA_SEAL_PASS as string,
      });
      const invite = await db.invites.inviteById(inviteId as string);
      if (!invite) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found" });
      }
      if (invite.claimedAt || invite.claimedByTeamId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Invite has already been claimed",
        });
      }
      await db.invites.acceptInvite(invite, ctx.session.auth.personalTeam);
    }),
  ignoreInvite: publicProcedure
    .input(z.object({ seal: z.string() }))
    .mutation(async ({ input: { seal } }) => {
      const { inviteId } = await unsealData(seal, {
        password: process.env.DATA_SEAL_PASS as string,
      });
      const invite = await db.invites.inviteById(inviteId as string);
      if (!invite) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found" });
      }
      if (invite.claimedAt || invite.claimedByTeamId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Invite has already been claimed",
        });
      }
      await db.invites.deleteInvite(inviteId as string);
    }),
});

// export type definition of API
export type TeamsRouter = typeof teamsRouter;
