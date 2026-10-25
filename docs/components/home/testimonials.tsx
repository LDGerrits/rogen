import { Reveal } from "./reveal";

interface Testimonial {
	readonly quote: string;
	readonly author: string;
	readonly role: string;
	readonly company: string;
	readonly url: string;
}

const featured: Testimonial = {
	quote: "It has been a game changer for my team and I",
	author: "Acecateer",
	role: "Technical Director",
	company: "Wonder Works Studio",
	url: "https://wonderworks.gg",
};

const secondary: Testimonial = {
	quote: "Spent the last couple days refactoring Lua Learning to use Rogen. I love it",
	author: "Zack (boatbomber) Williams",
	role: "CEO",
	company: "Torpedo Software",
	url: "https://www.torpedosoftware.llc",
};

function Attribution({ testimonial }: { testimonial: Testimonial }) {
	return (
		<figcaption className="mt-8 text-sm">
			<div className="font-medium text-paper">{testimonial.author}</div>
			<div className="mt-1 text-stone-500">
				{testimonial.role},{" "}
				<a
					href={testimonial.url}
					target="_blank"
					rel="noopener noreferrer"
					className="underline decoration-white/20 underline-offset-4 transition-colors duration-300 hover:text-paper hover:decoration-brand"
				>
					{testimonial.company}
				</a>
			</div>
		</figcaption>
	);
}

export function Testimonials() {
	return (
		<section className="relative px-6 pt-8 pb-24 lg:pt-12 lg:pb-32">
			<div className="mx-auto max-w-6xl">
				<Reveal className="mb-14 flex flex-col items-start text-left">
					<h2 className="font-mono text-xs uppercase tracking-[0.18em] text-stone-500">
						Top developers use Rogen
					</h2>
				</Reveal>

				<div className="grid gap-14 lg:grid-cols-12 lg:items-end lg:gap-8">
					<Reveal className="lg:col-span-8">
						<figure>
							<blockquote className="text-3xl font-medium leading-[1.15] tracking-[-0.03em] text-paper md:text-5xl">
								<span className="text-brand">“</span>
								{featured.quote}
								<span className="text-brand">”</span>
							</blockquote>
							<Attribution testimonial={featured} />
						</figure>
					</Reveal>

					<Reveal className="lg:col-span-4" delay={0.1}>
						<figure className="border-l border-white/10 pl-8">
							<blockquote className="text-xl leading-snug tracking-[-0.015em] text-stone-300">
								“{secondary.quote}”
							</blockquote>
							<Attribution testimonial={secondary} />
						</figure>
					</Reveal>
				</div>
			</div>
		</section>
	);
}
