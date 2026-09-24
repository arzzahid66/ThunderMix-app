import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-void bg-grid p-6">
      <div className="terminal-frame w-full max-w-md rounded-md p-6 text-sm">
        <p className="text-danger">[ ERROR 404 ] Route not found.</p>
        <p className="text-muted">[ SYSTEM ] The requested node does not exist.</p>
        <Link href="/" className="mt-5 inline-block text-neon underline-offset-4 hover:underline">
          &gt; return to portal
        </Link>
      </div>
    </main>
  );
}
