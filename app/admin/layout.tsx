import type { Metadata } from "next";

import "./admin.css";

import { AdminNavigation } from "@/components/admin-navigation";
import { getAdminActionSummary } from "@/lib/admin/cockpit";
import { requireAdmin } from "@/lib/auth/session";
import { qaAccessAvailable } from "@/lib/auth/qa-access";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Administration", template: "%s — LNX Admin" },
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await requireAdmin();
  const actionSummary = await getAdminActionSummary();
  const qaProfileSwitchAvailable = qaAccessAvailable();
  return (
    <div className="admin-shell">
      <AdminNavigation
        displayName={session.user.name}
        qaProfileSwitchAvailable={qaProfileSwitchAvailable}
        actionRequiredCounts={actionSummary.actionRequiredCounts}
        criticalActionRequiredCounts={actionSummary.criticalActionRequiredCounts}
      />
      {children}
    </div>
  );
}
