import Link from "next/link";
import type { ReactNode } from "react";

type ButtonLinkProps = {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "quiet";
  external?: boolean;
  className?: string;
};

export function ButtonLink({
  href,
  children,
  variant = "primary",
  external = false,
  className = "",
}: ButtonLinkProps) {
  const classes = `button button--${variant} ${className}`;

  if (external) {
    const opensNewTab = !href.startsWith("mailto:");

    return (
      <a
        className={classes}
        href={href}
        target={opensNewTab ? "_blank" : undefined}
        rel={opensNewTab ? "noopener noreferrer" : undefined}
      >
        <span>
          {children}
          {opensNewTab ? <span className="visually-hidden"> — nouvel onglet</span> : null}
        </span>
        <span aria-hidden="true">{opensNewTab ? "↗" : "→"}</span>
      </a>
    );
  }

  return (
    <Link className={classes} href={href}>
      <span>{children}</span>
      <span aria-hidden="true">→</span>
    </Link>
  );
}
