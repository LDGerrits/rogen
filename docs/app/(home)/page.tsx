import { Agents } from "@/components/home/agents";
import { Cta } from "@/components/home/cta";
import { Features } from "@/components/home/features";
import { Footer } from "@/components/home/footer";
import { Hero } from "@/components/home/hero";
import { Routing } from "@/components/home/routing";
import { Testimonials } from "@/components/home/testimonials";

export default function HomePage() {
	return (
		<div className="relative min-h-screen w-full overflow-hidden bg-ink font-sans text-stone-300">
			<div className="grain" aria-hidden />
			<Hero />
			<Features />
			<Routing />
			<Agents />
			<Testimonials />
			<Cta />
			<Footer />
		</div>
	);
}
