import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingRow } from "@/components/admin/primitives";
import { SessionsView } from "@/components/admin/sessions-view";

export const metadata: Metadata = { title: "Sessions" };

export default function AdminSessionsPage() {
  return (
    <Suspense fallback={<LoadingRow />}>
      <SessionsView />
    </Suspense>
  );
}
