"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

export type ShopCartLine = Readonly<{ productId: string; quantity: number }>;

type ShopCartContextValue = Readonly<{
  lines: readonly ShopCartLine[];
  itemCount: number;
  ready: boolean;
  add(productId: string, quantity?: number): void;
  setQuantity(productId: string, quantity: number): void;
  remove(productId: string): void;
  clear(): void;
}>;

const STORAGE_KEY = "lnx-shop-cart-v1";
const MAX_QUANTITY = 20;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ShopCartContext = createContext<ShopCartContextValue | null>(null);

function parseStoredCart(value: string | null): ShopCartLine[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    const lines = new Map<string, number>();
    for (const entry of parsed) {
      if (
        !entry
        || typeof entry !== "object"
        || Array.isArray(entry)
        || Object.keys(entry).some((key) => key !== "productId" && key !== "quantity")
      ) continue;
      const productId = "productId" in entry ? entry.productId : null;
      const quantity = "quantity" in entry ? entry.quantity : null;
      if (typeof productId !== "string" || !UUID_PATTERN.test(productId)) continue;
      if (!Number.isSafeInteger(quantity) || Number(quantity) < 1 || Number(quantity) > MAX_QUANTITY) continue;
      lines.set(productId, Number(quantity));
    }
    return [...lines].slice(0, 20).map(([productId, quantity]) => ({ productId, quantity }));
  } catch {
    return [];
  }
}

export function ShopCartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<ShopCartLine[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      return parseStoredCart(window.localStorage.getItem(STORAGE_KEY));
    } catch {
      return [];
    }
  });
  const ready = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    } catch {
      // A browser refusing local storage leaves the in-memory cart usable.
    }
  }, [lines, ready]);

  const add = useCallback((productId: string, quantity = 1) => {
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) return;
    setLines((current) => {
      const existing = current.find((line) => line.productId === productId);
      if (!existing) return [...current, { productId, quantity }].slice(0, 20);
      return current.map((line) => line.productId === productId
        ? { ...line, quantity: Math.min(MAX_QUANTITY, line.quantity + quantity) }
        : line);
    });
  }, []);
  const setQuantity = useCallback((productId: string, quantity: number) => {
    if (!Number.isSafeInteger(quantity) || quantity < 1) {
      setLines((current) => current.filter((line) => line.productId !== productId));
      return;
    }
    setLines((current) => current.map((line) => line.productId === productId
      ? { ...line, quantity: Math.min(MAX_QUANTITY, quantity) }
      : line));
  }, []);
  const remove = useCallback((productId: string) => {
    setLines((current) => current.filter((line) => line.productId !== productId));
  }, []);
  const clear = useCallback(() => setLines([]), []);
  const value = useMemo<ShopCartContextValue>(() => ({
    lines,
    itemCount: lines.reduce((total, line) => total + line.quantity, 0),
    ready,
    add,
    setQuantity,
    remove,
    clear,
  }), [add, clear, lines, ready, remove, setQuantity]);

  return <ShopCartContext.Provider value={value}>{children}</ShopCartContext.Provider>;
}

export function useShopCart() {
  const context = useContext(ShopCartContext);
  if (!context) throw new Error("useShopCart must be used inside ShopCartProvider.");
  return context;
}
