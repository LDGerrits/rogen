import { Agents } from "@/components/home/agents";
import { Cta } from "@/components/home/cta";
import { Features } from "@/components/home/features";
import { Footer } from "@/components/home/footer";
import { Hero } from "@/components/home/hero";
import { Reveals } from "@/components/home/reveals";
import { Routing } from "@/components/home/routing";
import { Testimonials } from "@/components/home/testimonials";
import { siteDescription, siteUrl, socials } from "@/lib/shared";

const jsonLd = {
	"@context": "https://schema.org",
	"@type": "SoftwareApplication",
	name: "Rogen",
	description: siteDescription,
	url: siteUrl,
	applicationCategory: "DeveloperApplication",
	operatingSystem: "Windows, macOS, Linux",
	license: "https://opensource.org/licenses/MIT",
	offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
	sameAs: [socials.github, socials.devforum],
};

export default function HomePage() {
	return (
		<>
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
			/>
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
