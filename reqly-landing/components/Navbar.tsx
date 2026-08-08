"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Menu, Sparkles, X, Zap } from "lucide-react";
import { LINKS } from "@/lib/links";

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
  const [logoHovered, setLogoHovered] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      setScrolled(y > 16);
      const doc = document.documentElement;
      const max = doc.scrollHeight - doc.clientHeight;
      setScrollProgress(max > 0 ? Math.min(y / max, 1) : 0);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

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

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-colors duration-200 ${
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
          onMouseEnter={() => setLogoHovered(true)}
          onMouseLeave={() => setLogoHovered(false)}
        >
          <span className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-mint-500/15 ring-1 ring-mint-500/30 transition group-hover:bg-mint-500/25 group-hover:ring-mint-500/50">
            <Zap
              className={`h-4.5 w-4.5 text-mint-400 transition-transform duration-300 ${
                logoHovered ? "scale-110" : "scale-100"
              }`}
              strokeWidth={2.5}
            />
            <span
              aria-hidden="true"
              className={`pointer-events-none absolute -right-1.5 -top-1.5 transition-all duration-300 ${
                logoHovered ? "opacity-100 scale-100" : "opacity-0 scale-50"
              }`}
            >
              <Sparkles className="h-3 w-3 text-mint-300 animate-sparkle-spin" strokeWidth={2} />
            </span>
          </span>
          <span className="text-lg font-semibold tracking-tight text-white">Reqly</span>
          <span className="relative overflow-hidden rounded-full border border-ink-600 bg-ink-850 px-2 py-0.5 font-mono text-[10px] text-zinc-500">
            <span
              aria-hidden="true"
              className={`animate-shimmer pointer-events-none absolute inset-0 transition-opacity duration-300 ${
                logoHovered ? "opacity-100" : "opacity-0"
              }`}
            />
            v1
          </span>
        </a>

        <div className="hidden items-center gap-7 md:flex">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className={`relative py-1 text-sm transition-colors ${
                active === l.href ? "text-mint-300" : "text-zinc-400 hover:text-white"
              }`}
            >
              {l.label}
              <span
                aria-hidden="true"
                className="absolute -bottom-0.5 left-0 h-px w-full origin-left bg-gradient-to-r from-mint-400 to-mint-300 transition-transform duration-300"
                style={{ transform: active === l.href ? "scaleX(1)" : "scaleX(0)" }}
              />
            </a>
          ))}
        </div>

        <div className="hidden items-center gap-3 md:flex">
          <a
            href={LINKS.github}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-300 transition hover:text-white"
          >
            GitHub
          </a>
          <a
            href="#cta"
            className="group relative inline-flex items-center gap-1.5 overflow-hidden rounded-lg bg-mint-500 px-4 py-2 text-sm font-semibold text-ink-950 shadow-[0_8px_24px_-8px_rgba(16,185,129,0.7)] transition hover:bg-mint-400"
          >
            <span
              aria-hidden="true"
              className="animate-shimmer pointer-events-none absolute inset-0"
            />
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
              className={`block rounded-lg px-3 py-2.5 text-sm transition hover:bg-ink-800 ${
                active === l.href ? "text-mint-300" : "text-zinc-300 hover:text-mint-300"
              }`}
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

      {/* Barre de progression de lecture */}
      <div aria-hidden="true" className="absolute bottom-0 left-0 h-px w-full bg-transparent">
        <div
          className="h-full origin-left bg-gradient-to-r from-mint-400 to-mint-300 transition-transform duration-150 ease-out"
          style={{ transform: `scaleX(${scrollProgress})` }}
        />
      </div>
    </header>
  );
}
