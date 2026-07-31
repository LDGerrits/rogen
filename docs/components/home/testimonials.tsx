import { FaQuoteLeft } from "react-icons/fa";

export function Testimonials() {
	return (
		<section className="py-24 px-6 relative">
			<div className="max-w-6xl mx-auto relative z-10">
				<div className="absolute top-20 right-50 w-100 h-100 bg-white opacity-[0.05] blur-[80px] rounded-full pointer-events-none -z-10 translate-x-1/2 -translate-y-1/2" />

				<div className="flex flex-col items-end text-right mb-16">
					<h2 className="text-3xl md:text-5xl font-bold text-white mb-4 tracking-tight">
						Top developers use Rogen
					</h2>
					<p className="text-gray-400 max-w-xl tracking-tight text-lg">
						See what they have to say
					</p>
				</div>

				<div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full text-left">
					{[
						{
							quote: "It has been a game changer for my team and I",
							author: "Acecateer",
							role: "Technical Director, Wonder Works Studio",
						},
						{
							quote: "Spent the last couple days refactoring Lua Learning to use Rogen. I love it",
							author: "Zack (boatbomber) Williams",
							role: "CEO, Torpedo Software",
						},
					].map((testimonial, i) => (
						<div
							key={i}
							className="p-8 rounded-xl glass-card flex flex-col items-start justify-between border-l-2 hover:border-l-white border-l-transparent cursor-default"
						>
							<FaQuoteLeft className="text-white/10 text-xl mb-4" />
							<p className="text-gray-300 text-[15px] mb-8 leading-relaxed">
								&quot;{testimonial.quote}&quot;
							</p>
							<div>
								<div className="text-white font-medium text-sm">
									{testimonial.author}
								</div>
								<div className="text-gray-500 text-xs mt-1">
									{testimonial.role}
								</div>
							</div>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}
