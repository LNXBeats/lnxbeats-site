"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { navigation } from "@/data/site";
import { Container } from "@/components/container";

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const firstLinkRef = useRef<HTMLAnchorElement>(null);
  const lastLinkRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && open) {
        setOpen(false);
        menuButtonRef.current?.focus();
        return;
      }

      if (event.key !== "Tab" || !open) return;

      const button = menuButtonRef.current;
      const firstLink = firstLinkRef.current;
      const lastLink = lastLinkRef.current;

      if (!button || !firstLink || !lastLink) return;

      if (event.shiftKey && document.activeElement === firstLink) {
        event.preventDefault();
        button.focus();
      } else if (event.shiftKey && document.activeElement === button) {
        event.preventDefault();
        lastLink.focus();
      } else if (!event.shiftKey && document.activeElement === lastLink) {
        event.preventDefault();
        button.focus();
      } else if (!event.shiftKey && document.activeElement === button) {
        event.preventDefault();
        firstLink.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <header className="site-header">
      <Container className="site-header__inner">
        <Link className="brand" href="/" aria-label="LNX Beats — accueil">
          <span className="brand__lnx">LNX</span>
          <span className="brand__beats">Beats</span>
        </Link>

        <nav className="desktop-navigation" aria-label="Navigation principale">
          {navigation.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`${item.href === "/commander" ? "desktop-navigation__cta" : "desktop-navigation__link"} ${isActive(item.href) ? "is-active" : ""}`}
              aria-current={isActive(item.href) ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
          <Link
            href="/connexion"
            className={`desktop-navigation__account ${isActive("/connexion") || isActive("/compte") ? "is-active" : ""}`}
            aria-current={isActive("/connexion") || isActive("/compte") ? "page" : undefined}
          >
            {isActive("/compte") ? "Mon compte" : "Connexion"}
          </Link>
        </nav>

        <button
          ref={menuButtonRef}
          className="menu-button"
          type="button"
          aria-label={open ? "Fermer le menu" : "Ouvrir le menu"}
          aria-expanded={open}
          aria-controls="mobile-navigation"
          onClick={() => setOpen((current) => !current)}
        >
          <span className="menu-button__label">Menu</span>
          <span className={`menu-button__icon ${open ? "is-open" : ""}`} aria-hidden="true">
            <span />
            <span />
          </span>
        </button>
      </Container>

      <div
        id="mobile-navigation"
        className={`mobile-navigation ${open ? "is-open" : ""}`}
        aria-hidden={!open}
      >
        <Container className="mobile-navigation__inner">
          <nav aria-label="Navigation mobile">
            {navigation.map((item, index) => (
              <Link
                key={item.href}
                ref={index === 0 ? firstLinkRef : undefined}
                href={item.href}
                tabIndex={open ? 0 : -1}
                aria-current={isActive(item.href) ? "page" : undefined}
                onClick={() => {
                  setOpen(false);
                  menuButtonRef.current?.focus();
                }}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                {item.label}
              </Link>
            ))}
            <Link
              ref={lastLinkRef}
              href="/connexion"
              tabIndex={open ? 0 : -1}
              aria-current={isActive("/connexion") || isActive("/compte") ? "page" : undefined}
              onClick={() => {
                setOpen(false);
                menuButtonRef.current?.focus();
              }}
            >
              <span>{String(navigation.length + 1).padStart(2, "0")}</span>
              {isActive("/compte") ? "Mon compte" : "Connexion"}
            </Link>
          </nav>
          <p>Chaque histoire mérite sa musique.</p>
        </Container>
      </div>
    </header>
  );
}
