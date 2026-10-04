"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { navigation, quickAccessPlatforms } from "@/data/site";
import { Container } from "@/components/container";
import { UiIcon } from "@/components/ui-icon";
import styles from "./site-header.module.css";

const HEADER_COMPACT_SCROLL_THRESHOLD = 72;

const routeIcons = {
  "/": "home", "/discographie": "disc", "/creations": "music",
  "/commander": "pen", "/boutique": "bag", "/a-propos": "info", "/contact": "mail",
} as const;

export function SiteHeader({ supportAvailable = false }: { supportAvailable?: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [compact, setCompact] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const desktopNavigationRef = useRef<HTMLElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

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

    const dialog = dialogRef.current;
    if (!dialog) return;
    const menuButton = menuButtonRef.current;
    const previousOverflow = document.body.style.overflow;
    const previousRootOverflow = document.documentElement.style.overflow;
    const desktopMedia = window.matchMedia("(min-width: 821px)");
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    // The native modal puts the complete background in the inert top-layer state.
    dialog.showModal();
    closeButtonRef.current?.focus({ preventScroll: true });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }

      if (event.key !== "Tab") return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex="0"]'));
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        first?.focus();
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
      dialog.close();
      document.body.style.overflow = previousOverflow;
      document.documentElement.style.overflow = previousRootOverflow;
      menuButton?.focus();
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

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
  const closeMenu = () => setOpen(false);
  const groups = [
    { label: "Découvrir", items: navigation.filter(({ href }) => ["/", "/discographie", "/creations"].includes(href)) },
    { label: "Créer et acheter", items: navigation.filter(({ href }) => ["/commander", "/boutique"].includes(href)) },
    { label: "Autour du projet", items: navigation.filter(({ href }) => ["/a-propos", "/contact"].includes(href)) },
  ];

  if (pathname.startsWith("/admin")) return null;

  return (
    <header className={`site-header ${pathname === "/" ? "site-header--home" : ""} ${compact && !open ? "site-header--compact" : ""}`}>
      <Container className="site-header__inner">
        <Link className="brand" href="/" aria-label="LNX Beats — accueil" onClick={() => setOpen(false)}>
          <Image src="/assets/v3/lnx-beats-signature-transparent.png" alt="" width={1501} height={348} priority />
        </Link>

        <Link className="mobile-account-link" href="/compte" aria-current={isActive("/connexion") || isActive("/compte") ? "page" : undefined}>
          <UiIcon name="user" className={styles.accountIcon} />
          <span>Compte</span>
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
          onClick={() => setOpen(true)}
        >
          <span className="menu-button__label">Menu</span>
          <span className={`menu-button__icon ${open ? "is-open" : ""}`} aria-hidden="true">
            <span />
            <span />
          </span>
        </button>
      </Container>

      <dialog
        ref={dialogRef}
        id="mobile-navigation"
        className={styles.dialog}
        aria-label="Menu principal"
        aria-modal="true"
        onCancel={(event) => { event.preventDefault(); closeMenu(); }}
      >
        <div className={styles.dialogHeader}>
          <button ref={closeButtonRef} className={styles.closeButton} type="button" aria-label="Fermer le menu" onClick={closeMenu}>
            <UiIcon name="close" />
          </button>
          <Link className={styles.dialogBrand} href="/" aria-label="LNX Beats — accueil" onClick={closeMenu}>
            <Image src="/assets/v3/lnx-beats-signature-transparent.png" alt="" width={1501} height={348} sizes="148px" />
          </Link>
        </div>
        <div className={styles.dialogBody}>
          <nav className={styles.navigation} aria-label="Navigation mobile">
            {groups.map((group) => (
              <section className={styles.group} key={group.label} aria-label={group.label}>
                <p className={styles.groupLabel}>{group.label}</p>
                {group.label === "Autour du projet" && supportAvailable ? (
                  <Link className={styles.menuLink} href="/soutenir" aria-current={isActive("/soutenir") ? "page" : undefined} onClick={closeMenu}>
                    <UiIcon name="heart" /><span>Soutenir LNX Beats</span><UiIcon name="chevron-right" />
                  </Link>
                ) : null}
                {group.items.map((item) => (
                  <Link key={item.href} className={styles.menuLink} href={item.href} aria-current={isActive(item.href) ? "page" : undefined} onClick={closeMenu}>
                    <UiIcon name={routeIcons[item.href]} /><span>{item.label}</span><UiIcon name="chevron-right" />
                  </Link>
                ))}
              </section>
            ))}
          </nav>
          <div className={styles.account}>
            <Link className={styles.menuLink} href="/compte" aria-current={isActive("/connexion") || isActive("/compte") ? "page" : undefined} onClick={closeMenu}>
              <UiIcon name="user" /><span>Mon compte</span><UiIcon name="chevron-right" />
            </Link>
          </div>
          <div className={styles.socials} aria-label="Plateformes officielles">
            {quickAccessPlatforms.map(({ name, url, icon }) => (
              <a key={name} href={url} target="_blank" rel="noopener noreferrer" aria-label={`${name} — nouvel onglet`}>
                <Image src={icon} alt="" width={22} height={22} />
              </a>
            ))}
          </div>
          <p className={styles.signature}>Chaque histoire mérite sa musique.</p>
        </div>
      </dialog>
    </header>
  );
}
