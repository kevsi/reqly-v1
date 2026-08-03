"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Menu, X, Zap } from "lucide-react";

const links = [
  { href: "#features", label: "Fonctionnalités" },
  { href: "#ai", label: "Assistant IA" },
  { href: "#ecosystem", label: "Écosystème" },
  { href: "#open-source", label: "Open source" },
];

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string>("");

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Scrollspy : met en évidence la section visible (la plus haute si plusieurs).
  useEffect(() => {
    const ids = links.map((l) => l.href.slice(1));
    const sections = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0 || typeof IntersectionObserver === "undefined") return;

    const visible = new Set<string>();
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        const first = ids.find((id) => visible.has(id));
        setActive(first ? `#${first}` : "");
      },
      { rootMargin: "-45% 0px -50% 0px", threshold: 0 },
    );
    sections.forEach((s) => obs.observe(s));
    return () => obs.disconnect();
  }, []);

  // Échap ferme le menu mobile.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled
          ? "border-b border-ink-700/70 bg-ink-950/85 backdrop-blur-xl"
          : "border-b border-transparent bg-transparent"
      }`}
    >
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <a
          href="#contenu"
          className="group flex items-center gap-2.5"
          aria-label="Reqly — accueil"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-mint-500/15 ring-1 ring-mint-500/30 transition group-hover:bg-mint-500/25 group-hover:ring-mint-500/50">
            <Zap className="h-4.5 w-4.5 text-mint-400" strokeWidth={2.5} />
          </span>
          <span className="text-lg font-semibold tracking-tight text-white">
            Reqly
          </span>
          <span className="rounded-full border border-ink-600 bg-ink-850 px-2 py-0.5 font-mono text-[10px] text-zinc-500">
            v1
          </span>
        </a>

        <div className="hidden items-center gap-7 md:flex">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className={`relative text-sm transition-colors ${
                active === l.href ? "text-mint-300" : "text-zinc-400 hover:text-white"
              }`}
            >
              {l.label}
              <span
                className={`absolute -bottom-1.5 left-0 h-px bg-mint-400 transition-all duration-300 ${
                  active === l.href ? "w-full" : "w-0"
                }`}
              />
            </a>
          ))}
        </div>

        <div className="hidden items-center gap-3 md:flex">
          <a
            href="#open-source"
            className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-300 transition hover:text-white"
          >
            GitHub
          </a>
          <a
            href="#cta"
            className="group inline-flex items-center gap-1.5 rounded-lg bg-mint-500 px-4 py-2 text-sm font-semibold text-ink-950 shadow-[0_8px_24px_-8px_rgba(16,185,129,0.7)] transition hover:bg-mint-400"
          >
            Lancer Reqly
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </a>
        </div>

        <button
          className="rounded-lg p-2 text-zinc-300 transition hover:bg-ink-800 md:hidden"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Fermer le menu" : "Ouvrir le menu"}
          aria-expanded={open}
          aria-controls="menu-mobile"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </nav>

      {open && (
        <div
          id="menu-mobile"
          className="border-t border-ink-700/70 bg-ink-950/95 px-5 pb-5 pt-3 backdrop-blur-xl md:hidden"
        >
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="block rounded-lg px-3 py-2.5 text-sm text-zinc-300 transition hover:bg-ink-800 hover:text-mint-300"
            >
              {l.label}
            </a>
          ))}
          <a
            href="#cta"
            onClick={() => setOpen(false)}
            className="mt-3 flex items-center justify-center gap-2 rounded-lg bg-mint-500 px-4 py-2.5 text-sm font-semibold text-ink-950 transition hover:bg-mint-400"
          >
            Lancer Reqly
            <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      )}
    </header>
  );
}
