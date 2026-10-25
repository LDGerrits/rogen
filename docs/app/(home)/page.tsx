import { Agents } from "@/components/home/agents";
import { Cta } from "@/components/home/cta";
import { Features } from "@/components/home/features";
import { Footer } from "@/components/home/footer";
import { Hero } from "@/components/home/hero";
import { Reveals } from "@/components/home/reveals";
import { Routing } from "@/components/home/routing";
import { Testimonials } from "@/components/home/testimonials";

export default function HomePage() {
	return (
		<>
			<main>
				<Hero />
				<Features />
				<Routing />
				<Agents />
				<Testimonials />
				<Cta />
			</main>
			<Footer />
			<Reveals />
		</>
	);
}
