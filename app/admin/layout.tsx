import type { Metadata } from "next";

import "./admin.css";

import { AdminNavigation } from "@/components/admin-navigation";
import { requireAdmin } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Administration", template: "%s — LNX Admin" },
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await requireAdmin();
  return (
    <div className="admin-shell">
      <AdminNavigation displayName={session.user.name} />
      {children}
    </div>
  );
}
