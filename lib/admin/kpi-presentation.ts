type AdminKpi = { count: number; tone: "attention" | "critical" | "neutral" };

function priority(item: AdminKpi) {
  if (item.count === 0) return 0;
  return item.tone === "attention" || item.tone === "critical" ? 2 : 1;
}

export function orderAdminKpis<T extends AdminKpi>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => priority(right) - priority(left));
}
