import Link from "next/link";
import { Reveal } from "./reveal";

const points = [
	{
		title: "One feature, one folder",
		desc: "When an agent works on a feature, everything it needs is in one folder, from server to client. It spends its context on your task instead of searching the codebase.",
	},
	{
		title: "Several agents at once",
		desc: "Give each agent a feature. A lint rule catches any agent that makes one feature require another, and there's no shared project file to conflict on.",
	},
];

export function Agents() {
	return (
		<section id="agents" className="relative px-6 py-24 lg:py-32">
			<div className="mx-auto grid max-w-6xl gap-14 lg:grid-cols-12 lg:gap-8">
				<Reveal className="flex flex-col items-end text-right lg:order-2 lg:col-span-5 lg:col-start-8">
					<h2 className="text-3xl font-semibold tracking-[-0.03em] text-paper md:text-5xl">
						Built for agents
					</h2>
					<p className="mt-5 max-w-sm text-lg leading-relaxed text-stone-400">
						People and coding agents read the layout the same way.
					</p>
					<Link
						href="/docs/v2/agents"
						className="group mt-8 inline-flex items-center gap-1.5 text-sm font-medium text-stone-400 transition-colors duration-300 hover:text-paper"
					>
						Working with agents
						<span className="transition-transform duration-500 ease-out-expo group-hover:translate-x-1">
							→
						</span>
					</Link>
				</Reveal>

				<Reveal className="lg:order-1 lg:col-span-6">
					<ol>
						{points.map((point, i) => (
							<li
								key={point.title}
								className="grid grid-cols-[3rem_1fr] gap-4 border-t border-white/[0.08] py-8 last:border-b"
							>
								<span className="pt-1 font-mono text-xs tracking-[0.14em] text-brand">
									{String(i + 1).padStart(2, "0")}
								</span>
								<div>
									<h3 className="text-xl font-semibold tracking-[-0.02em] text-paper">
										{point.title}
									</h3>
									<p className="mt-3 max-w-[52ch] text-[15px] leading-relaxed text-stone-400">
										{point.desc}
									</p>
								</div>
							</li>
						))}
					</ol>
				</Reveal>
			</div>
		</section>
	);
}
