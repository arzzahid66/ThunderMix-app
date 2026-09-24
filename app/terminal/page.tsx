import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { TerminalApp } from "@/components/terminal/terminal-app";
import { getVisitorProfile } from "@/lib/auth/visitor";

// Per-request auth check; never prerendered.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Terminal" };

export default async function TerminalPage() {
  // The token is verified by the database; no identity → back to the entry screen.
  const visitor = await getVisitorProfile().catch(() => null);
  if (!visitor) redirect("/");
  return <TerminalApp />;
}
