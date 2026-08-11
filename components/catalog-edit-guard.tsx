"use client";

import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

export function CatalogSubmitButton({ children, pendingLabel = "Enregistrement…", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" {...props} disabled={pending || props.disabled}>{pending ? pendingLabel : children}</button>;
}

export function CatalogEditGuard({ action, children }: { action: (formData: FormData) => void | Promise<void>; children: ReactNode }) {
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const warnInternalNavigation = (event: MouseEvent) => {
      if (!dirty || !(event.target instanceof Element)) return;
      const link = event.target.closest("a[href]");
      if (link && !window.confirm("Des modifications ne sont pas enregistrées. Quitter cette fiche ?")) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", warnInternalNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", warnInternalNavigation, true);
    };
  }, [dirty]);
  return (
    <form className="admin-catalogue-form" action={action} onChange={() => setDirty(true)} onSubmit={() => setDirty(false)}>
      {children}
      <span className="admin-dirty-state" role="status" aria-live="polite">{dirty ? "Modifications non enregistrées" : "Aucune modification en attente"}</span>
    </form>
  );
}
