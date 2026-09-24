import type { Metadata } from "next";
import { ConversationView } from "@/components/admin/conversation-view";

export const metadata: Metadata = { title: "Conversation" };

export default async function AdminConversationPage(props: PageProps<"/admin/sessions/[id]">) {
  const { id } = await props.params;
  return <ConversationView id={id} />;
}
