import { Store } from "@tableland/studio-store";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  protectedProcedure,
  publicProcedure,
  router,
  teamProcedure,
} from "../trpc";
import { SendInviteFunc } from "../utils/sendInvite";

export function teamsRouter(store: Store, sendInvite: SendInviteFunc) {
  return router({
    teamById: publicProcedure.input(z.string()).query(async ({ input }) => {
      const team = await store.teams.teamById(input);
      if (!team) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Team not found" });
      }
      return team;
    }),
    teamBySlug: publicProcedure.input(z.string()).query(async ({ input }) => {
      const team = await store.teams.teamBySlug(input);
      if (!team) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Team not found" });
      }
      return team;
    }),
    userTeams: protectedProcedure.input(z.void()).query(async ({ ctx }) => {
      const teams = await store.teams.teamsByMemberId(
        ctx.session.auth.user.teamId,
      );
      return teams;
    }),
    newTeam: protectedProcedure
      .input(z.object({ name: z.string(), emailInvites: z.array(z.string()) }))
      .mutation(async ({ ctx, input }) => {
        const { team, invites } = await store.teams.createTeamByPersonalTeam(
          input.name,
          ctx.session.auth.user.teamId,
          input.emailInvites,
        );
        await Promise.all(invites.map((invite) => sendInvite(invite)));
        return team;
      }),
    usersForTeam: teamProcedure(store).query(async ({ input }) => {
      const people = await store.teams.userTeamsForTeamId(input.teamId);
      return people;
    }),
  });
}