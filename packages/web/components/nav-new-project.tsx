"use client";

import { api } from "@/trpc/react";
import { useParams } from "next/navigation";
import Crumb from "./crumb";

export default function NavNewProject({
  className,
}: React.HTMLAttributes<HTMLElement> & {}) {
  const { team: teamSlug } = useParams<{ team: string }>();
  const team = api.teams.teamBySlug.useQuery({ slug: teamSlug });

  if (!team.data) {
    return null;
  }

  return (
    <div className={className}>
      <Crumb
        title="New Project"
        items={[{ label: team.data.name, href: `/${team.data.slug}` }]}
      />
    </div>
  );
}
