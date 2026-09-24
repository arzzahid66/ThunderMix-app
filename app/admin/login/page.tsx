import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/admin/login-form";
import { getAdminSession } from "@/lib/auth/admin";

// Per-request auth check; never prerendered.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Operator sign in",
  robots: { index: false, follow: false },
};

export default async function AdminLoginPage(props: PageProps<"/admin/login">) {
  const admin = await getAdminSession().catch(() => null);
  const { next } = await props.searchParams;
  const target = typeof next === "string" && next.startsWith("/admin") && !next.startsWith("//") ? next : "/admin";
  if (admin) redirect(target);
  return <LoginForm next={target} />;
}
