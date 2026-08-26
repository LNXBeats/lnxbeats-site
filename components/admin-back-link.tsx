import Link from "next/link";
import type { ReactNode } from "react";

import { ArrowLeftIcon } from "@/components/link-icons";

type AdminBackLinkProps = {
  href: "/admin" | `/admin/${string}`;
  children: ReactNode;
};

export function AdminBackLink({ href, children }: AdminBackLinkProps) {
  return (
    <Link className="admin-back-link" href={href}>
      <ArrowLeftIcon />
      <span>{children}</span>
    </Link>
  );
}
