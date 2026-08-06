import { I18nProvider } from "fumadocs-ui/contexts/i18n";
import { i18n, isLang } from "@/lib/i18n";
import { notFound } from "next/navigation";

export default async function LangLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();

  return <I18nProvider {...i18n.provider(lang)}>{children}</I18nProvider>;
}
