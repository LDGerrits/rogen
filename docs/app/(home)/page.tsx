import { Cta } from "@/components/home/cta";
import { Features } from "@/components/home/features";
import { Footer } from "@/components/home/footer";
import { Hero } from "@/components/home/hero";
import { Preview } from "@/components/home/preview";
import { Rules } from "@/components/home/rules";
import { Testimonials } from "@/components/home/testimonials";

export default function HomePage() {
	return (
		<div className="min-h-screen w-full relative bg-[#030303] overflow-hidden font-sans text-gray-300 selection:bg-white/30 selection:text-white">
			<style>{`
                .glass-card {
                    background: rgba(10, 10, 10, 0.6);
                    backdrop-filter: blur(12px);
                    border: 1px solid rgba(255, 255, 255, 0.08);
                    transition: border-color 0.2s ease, transform 0.2s ease;
                }
                .glass-card:hover {
                    border-color: rgba(255, 255, 255, 0.2);
                    transform: translateY(-2px);
                }
            `}</style>

			<div className="relative z-20">
				<Hero />
				<Preview />
				<Features />
				<Rules />
				<Testimonials />
				<Cta />
				<Footer />
			</div>
		</div>
	);
}
