"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import type { OrderDraftInput } from "@/lib/orders/domain";

export type OrderJourneyMemory = {
  form: OrderDraftInput;
  step: number;
  pendingFiles: File[];
  photoRightsConfirmed: boolean;
};

type OrderJourneyContextValue = {
  memory: OrderJourneyMemory | null;
  preserve(memory: OrderJourneyMemory): void;
  clear(): void;
};

const OrderJourneyContext = createContext<OrderJourneyContextValue | null>(null);

export function OrderJourneyProvider({ children }: { children: ReactNode }) {
  const [memory, setMemory] = useState<OrderJourneyMemory | null>(null);
  const value = useMemo<OrderJourneyContextValue>(() => ({ memory, preserve: setMemory, clear: () => setMemory(null) }), [memory]);
  return <OrderJourneyContext.Provider value={value}>{children}</OrderJourneyContext.Provider>;
}

export function useOrderJourneyMemory() {
  const context = useContext(OrderJourneyContext);
  if (!context) throw new Error("OrderJourneyProvider is missing.");
  return context;
}
