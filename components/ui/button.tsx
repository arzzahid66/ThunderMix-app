import { forwardRef, type ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const base =
  "inline-flex items-center justify-center gap-2 rounded-sm border font-mono uppercase tracking-wider " +
  "transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45 select-none whitespace-nowrap";

const variants: Record<Variant, string> = {
  primary:
    "border-neon/60 bg-neon/10 text-neon hover:bg-neon/20 hover:border-neon active:bg-neon/25 shadow-[0_0_18px_-8px_var(--color-neon)]",
  secondary: "border-cyan/40 bg-cyan/5 text-cyan hover:bg-cyan/15 hover:border-cyan/80",
  ghost: "border-transparent text-muted hover:text-ink hover:bg-white/5",
  danger: "border-danger/50 bg-danger/10 text-danger hover:bg-danger/20 hover:border-danger",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-2.5 text-[11px]",
  md: "h-10 px-4 text-xs",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", className = "", type = "button", ...props },
  ref,
) {
  return <button ref={ref} type={type} className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...props} />;
});
