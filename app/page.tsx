import { EntryTerminal } from "@/components/terminal/entry-terminal";
import { getVisitorProfile } from "@/lib/auth/visitor";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const visitor = await getVisitorProfile().catch((error) => {
    console.error("[home] identity check failed", error);
    return null;
  });
  return <EntryTerminal existingName={visitor?.profile.name ?? null} />;
}
