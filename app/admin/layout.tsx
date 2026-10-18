import type { Metadata } from "next";

import "./admin.css";

import { AdminNavigation } from "@/components/admin-navigation";
import { AdminTopbar } from "@/components/admin-topbar";
import { getAdminActionSummary } from "@/lib/admin/cockpit";
import { getCreationWorkQueue } from "@/lib/admin/creation-work";
import { deadlineGauge } from "@/lib/admin/creation-work-policy";
import { requireAdmin } from "@/lib/auth/session";
import { qaAccessAvailable } from "@/lib/auth/qa-access";
import { digitalEnabled } from "@/lib/digital/domain";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Administration", template: "%s — LNX Admin" },
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await requireAdmin();
  const [actionSummary, work] = await Promise.all([getAdminActionSummary(), getCreationWorkQueue()]);
  const creationCritical = work.items.filter(item => ["critical", "overdue"].includes(deadlineGauge(item.startedAt, item.dueAt, Date.parse(work.now)).tone)).length;
  const qaProfileSwitchAvailable = qaAccessAvailable();
  return (
    <div className="admin-shell">
      <AdminNavigation
        displayName={session.user.name}
        qaProfileSwitchAvailable={qaProfileSwitchAvailable}
        digitalMusicAvailable={digitalEnabled()}
        actionRequiredCounts={{ ...actionSummary.actionRequiredCounts, "/admin/commandes": work.items.length, "/admin": actionSummary.total - actionSummary.counts.commander + work.items.length }}
        criticalActionRequiredCounts={{ ...actionSummary.criticalActionRequiredCounts, "/admin/commandes": creationCritical, "/admin": Object.entries(actionSummary.criticalActionRequiredCounts).filter(([path]) => path !== "/admin" && path !== "/admin/commandes").reduce((sum, [, count]) => sum + count, 0) + creationCritical }}
      />
      <div className="admin-workspace">
        <AdminTopbar displayName={session.user.name} notificationCount={actionSummary.counts.notifications} />
        {children}
      </div>
    </div>
  );
}
