import Link from "next/link";
import { Reveal } from "./reveal";

const points = [
	{
		title: "One feature, one folder",
		desc: "When an agent works on a feature, everything it needs is in one folder, from server to client. It spends its context on your task instead of searching the codebase.",
	},
	{
		title: "Several agents at once",
		desc: "Give each agent a feature. A lint rule catches any agent that makes one feature require another, and they never fight over a shared project file.",
	},
];

export function Agents() {
	return (
		<section id="agents" className="px-6 py-24 lg:py-32">
			<div className="mx-auto grid max-w-6xl gap-14 lg:grid-cols-12 lg:gap-8">
				<Reveal className="flex flex-col items-end text-right lg:order-2 lg:col-span-5 lg:col-start-8">
					<h2 className="text-4xl leading-[1] font-bold tracking-[-0.04em] text-paper md:text-6xl">
						Built for agents
					</h2>
					<p className="mt-5 max-w-sm text-lg leading-relaxed text-stone-400">
						Coding agents find their way around a feature folder as
						easily as you do.
					</p>
					<Link
						href="/docs/v2/agents"
						className="group mt-8 inline-flex items-center gap-1.5 text-sm font-medium text-stone-300 underline decoration-transparent underline-offset-4 transition-colors duration-200 hover:text-paper hover:decoration-stone-500"
					>
						Working with agents
						<span className="transition-transform duration-300 ease-out-expo group-hover:translate-x-0.5">
							→
						</span>
					</Link>
				</Reveal>

				<Reveal className="lg:order-1 lg:col-span-6">
					<ul>
						{points.map((point) => (
							<li
								key={point.title}
								className="border-t border-rule py-8 last:border-b"
							>
								<h3 className="text-xl font-semibold tracking-[-0.02em] text-paper md:text-2xl">
									{point.title}
								</h3>
								<p className="mt-3 max-w-[52ch] text-[15px] leading-relaxed text-stone-400">
									{point.desc}
								</p>
							</li>
						))}
					</ul>
				</Reveal>
			</div>
		</section>
	);
}
