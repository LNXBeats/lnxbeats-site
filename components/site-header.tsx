"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { navigation } from "@/data/site";
import { Container } from "@/components/container";

const HEADER_COMPACT_SCROLL_THRESHOLD = 72;

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [compact, setCompact] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const desktopNavigationRef = useRef<HTMLElement>(null);
  const firstLinkRef = useRef<HTMLAnchorElement>(null);
  const lastLinkRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    let animationFrame = 0;
    const updateCompactState = () => {
      animationFrame = 0;
      setCompact(window.scrollY >= HEADER_COMPACT_SCROLL_THRESHOLD);
    };
    const handleScroll = () => {
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(updateCompactState);
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    const desktopMedia = window.matchMedia("(min-width: 821px)");
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        menuButtonRef.current?.focus();
        return;
      }

      if (event.key !== "Tab") return;

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
    const closeAfterHistoryNavigation = () => setOpen(false);
    const closeAtDesktopWidth = (event: MediaQueryListEvent) => {
      if (event.matches) setOpen(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("popstate", closeAfterHistoryNavigation);
    desktopMedia.addEventListener("change", closeAtDesktopWidth);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("popstate", closeAfterHistoryNavigation);
      desktopMedia.removeEventListener("change", closeAtDesktopWidth);
    };
  }, [open]);

  useEffect(() => {
    const navigationElement = desktopNavigationRef.current;
    if (!navigationElement) return;

    let animationFrame = 0;
    const updateIndicator = () => {
      animationFrame = 0;
      const activeLink = navigationElement.querySelector<HTMLElement>("[data-nav-active='true']");
      if (!activeLink) {
        navigationElement.style.setProperty("--active-nav-opacity", "0");
        return;
      }
      navigationElement.style.setProperty("--active-nav-left", `${activeLink.offsetLeft}px`);
      navigationElement.style.setProperty("--active-nav-width", `${activeLink.offsetWidth}px`);
      navigationElement.style.setProperty("--active-nav-opacity", "1");
    };
    const scheduleUpdate = () => {
      if (!animationFrame) animationFrame = window.requestAnimationFrame(updateIndicator);
    };

    scheduleUpdate();
    window.addEventListener("resize", scheduleUpdate, { passive: true });
    document.fonts?.ready.then(scheduleUpdate).catch(() => undefined);
    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [compact, pathname]);

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const toggleMenu = () => {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen) {
      window.requestAnimationFrame(() => firstLinkRef.current?.focus({ preventScroll: true }));
    }
  };

  if (pathname.startsWith("/admin")) return null;

  return (
    <header className={`site-header ${pathname === "/" ? "site-header--home" : ""} ${compact && !open ? "site-header--compact" : ""}`}>
      <Container className="site-header__inner">
        <Link className="brand" href="/" aria-label="LNX Beats — accueil" onClick={() => setOpen(false)}>
          <span className="brand__lnx">LNX</span>
          <span className="brand__beats">Beats</span>
        </Link>

        <nav ref={desktopNavigationRef} className="desktop-navigation" aria-label="Navigation principale">
          {navigation.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`${item.href === "/commander" ? "desktop-navigation__cta" : "desktop-navigation__link"} ${isActive(item.href) ? "is-active" : ""}`}
              aria-current={isActive(item.href) ? "page" : undefined}
              data-nav-active={isActive(item.href)}
            >
              {item.label}
            </Link>
          ))}
          <Link
            href="/compte"
            className={`desktop-navigation__account ${isActive("/connexion") || isActive("/compte") ? "is-active" : ""}`}
            aria-current={isActive("/connexion") || isActive("/compte") ? "page" : undefined}
            data-nav-active={isActive("/connexion") || isActive("/compte")}
          >
            Compte
          </Link>
          <span className="desktop-navigation__active-indicator" aria-hidden="true" />
        </nav>

        <button
          ref={menuButtonRef}
          className="menu-button"
          type="button"
          aria-label={open ? "Fermer le menu" : "Ouvrir le menu"}
          aria-expanded={open}
          aria-controls="mobile-navigation"
          onClick={toggleMenu}
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
        inert={!open}
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
                {item.label}
              </Link>
            ))}
            <Link
              ref={lastLinkRef}
              href="/compte"
              tabIndex={open ? 0 : -1}
              aria-current={isActive("/connexion") || isActive("/compte") ? "page" : undefined}
              onClick={() => {
                setOpen(false);
                menuButtonRef.current?.focus();
              }}
            >
              Compte
            </Link>
          </nav>
          <p>Chaque histoire mérite sa musique.</p>
        </Container>
      </div>
    </header>
  );
}
