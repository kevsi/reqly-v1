import { Reveal } from "@/components/Reveal";

interface SectionHeaderProps {
  eyebrow: string;
  title: string;
  sub?: string;
}

/** En-tête de section unifié : eyebrow + titre + sous-titre centrés. */
export function SectionHeader({ eyebrow, title, sub }: SectionHeaderProps) {
  return (
    <Reveal className="mx-auto max-w-2xl text-center">
      <span className="text-xs font-semibold uppercase tracking-[0.2em] text-mint-400">
        {eyebrow}
      </span>
      <h2 className="mt-4 text-balance text-3xl font-bold tracking-tight text-white sm:text-4xl">
        {title}
      </h2>
      {sub && <p className="mt-4 text-pretty text-zinc-400">{sub}</p>}
    </Reveal>
  );
}
