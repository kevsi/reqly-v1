import { Navbar } from "@/components/Navbar";
import { Hero } from "@/components/Hero";
import { Integrations } from "@/components/Integrations";
import { Features } from "@/components/Features";
import { AiSection } from "@/components/AiSection";
import { Ecosystem } from "@/components/Ecosystem";
import { Cta } from "@/components/Cta";
import { Footer } from "@/components/Footer";

export default function Home() {
  return (
    <>
      <Navbar />
      <main id="contenu">
        <Hero />
        <Integrations />
        <Features />
        <AiSection />
        <Ecosystem />
        <Cta />
      </main>
      <Footer />
    </>
  );
}
