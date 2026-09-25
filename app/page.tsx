import { EntryTerminal } from "@/components/terminal/entry-terminal";

// Every tab asks for the private key; nothing is resumed automatically.
export default function HomePage() {
  return <EntryTerminal />;
}
