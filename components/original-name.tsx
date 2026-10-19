import type { ReactNode } from "react";

/** Literal catalog/artist identity: never send it to the UI dictionary. */
export function OriginalName({ children }: { children: ReactNode }) {
  return <span translate="no" className="notranslate" data-original-name>{children}</span>;
}
