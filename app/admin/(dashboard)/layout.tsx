import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminShell } from "@/components/admin/admin-shell";
import { getAdminSession } from "@/lib/auth/admin";

// Per-request auth check; never prerendered.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Operator console", template: "%s · Operator console" },
  robots: { index: false, follow: false },
};

export default async function DashboardLayout({ children }: LayoutProps<"/admin">) {
  // Server-side check: the database validates the admin session token.
  const admin = await getAdminSession().catch((error) => {
    console.error("[admin layout] session check failed", error);
    return null;
  });
  if (!admin) redirect("/admin/login");
  return <AdminShell profile={admin.profile}>{children}</AdminShell>;
}
