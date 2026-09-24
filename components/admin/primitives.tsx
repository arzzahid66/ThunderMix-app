import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line px-4 py-5 sm:px-8">
      <div>
        <h1 className="text-base tracking-[0.12em] text-ink sm:text-lg">
          <span className="text-neon">&gt;</span> {title}
        </h1>
        {subtitle && <p className="mt-1 text-xs text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ title, children, className = "", actions }: { title?: string; children: React.ReactNode; className?: string; actions?: React.ReactNode }) {
  return (
    <section className={`rounded-sm border border-line bg-panel ${className}`} aria-label={title}>
      {title && (
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted">{title}</h2>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function LoadingRow({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 px-4 py-10 text-sm text-muted" role="status">
      <Spinner /> {label}…
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="px-4 py-12 text-center">
      <p className="text-sm text-muted">[ EMPTY ] {title}</p>
      {hint && <p className="mt-1 text-xs text-faint">{hint}</p>}
    </div>
  );
}

export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="m-4 rounded-sm border border-danger/40 bg-danger/5 px-4 py-3 text-sm text-danger">
      [ ERROR ] {message}
      {onRetry && (
        <button type="button" onClick={onRetry} className="ml-3 underline underline-offset-2 hover:text-ink">
          Retry
        </button>
      )}
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  hrefFor,
}: {
  page: number;
  pageSize: number;
  total: number;
  hrefFor: (page: number) => string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  const linkCls =
    "inline-flex h-8 items-center gap-1 rounded-sm border border-line px-2.5 text-[11px] uppercase tracking-wider text-muted hover:border-cyan/50 hover:text-cyan";
  const disabledCls = "inline-flex h-8 items-center gap-1 rounded-sm border border-line/50 px-2.5 text-[11px] uppercase tracking-wider text-faint/60";
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-xs text-muted">
      <span>
        {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link className={linkCls} href={hrefFor(page - 1)} aria-label="Previous page">
            <ChevronLeft className="size-3.5" aria-hidden="true" /> Prev
          </Link>
        ) : (
          <span className={disabledCls} aria-disabled="true">
            <ChevronLeft className="size-3.5" aria-hidden="true" /> Prev
          </span>
        )}
        <span className="px-1">
          {page}/{pages}
        </span>
        {page < pages ? (
          <Link className={linkCls} href={hrefFor(page + 1)} aria-label="Next page">
            Next <ChevronRight className="size-3.5" aria-hidden="true" />
          </Link>
        ) : (
          <span className={disabledCls} aria-disabled="true">
            Next <ChevronRight className="size-3.5" aria-hidden="true" />
          </span>
        )}
      </div>
    </nav>
  );
}

export const inputCls =
  "h-9 rounded-sm border border-line-strong bg-void px-3 text-[13px] text-ink outline-none placeholder:text-faint focus:border-cyan/70";

export const thCls = "whitespace-nowrap px-4 py-2.5 text-left text-[10px] font-normal uppercase tracking-[0.18em] text-faint";
export const tdCls = "whitespace-nowrap px-4 py-3 align-middle";
