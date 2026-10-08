import Link from "next/link";

export function Agents() {
	return (
		<section id="agents" className="py-24 px-6 relative">
			<div className="max-w-6xl mx-auto relative z-10">
				<div className="absolute top-20 left-30 w-100 h-100 bg-white opacity-[0.05] blur-[80px] rounded-full pointer-events-none -z-10 -translate-x-1/2 -translate-y-1/2" />

				<div className="flex flex-col items-start text-left mb-16">
					<h2 className="text-3xl md:text-5xl font-bold text-white mb-4 tracking-tight">
						Built for you and your agents
					</h2>
					<p className="text-gray-400 max-w-xl tracking-tight text-lg">
						People and coding agents read the layout the same way.
					</p>
				</div>

				<div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
					{[
						{
							title: "One folder, one feature",
							desc: "Point an agent at a feature folder and it has all the context it needs.",
						},
						{
							title: "A small blast radius",
							desc: "A change inside one feature can only break that feature, and the file list tells you which one.",
						},
						{
							title: "Boundaries a linter checks",
							desc: "Rules like “features don't require each other” are rules about paths, so a linter can enforce them.",
						},
						{
							title: "Placement is declared",
							desc: "Where a file ends up comes from a short routes map, not a convention the agent has to guess.",
						},
						{
							title: "No generated file to break",
							desc: "Rogen rewrites the project file on every build, so nobody, human or agent, edits it by hand.",
						},
						{
							title: "It checks its own work",
							desc: "rogen where shows where a file lands and why, and rogen check says what to fix.",
						},
					].map((point, i) => (
						<div
							key={i}
							className="glass-card flex flex-col items-start p-8 rounded-xl cursor-default"
						>
							<h3 className="text-base font-semibold text-white mb-2">
								{point.title}
							</h3>
							<p className="text-gray-400 text-sm leading-relaxed">
								{point.desc}
							</p>
						</div>
					))}
				</div>

				<Link
					href="/docs/v2/agents"
					className="mt-10 text-gray-400 hover:text-white transition-colors text-sm font-medium inline-flex items-center gap-1"
				>
					Working with agents <span className="font-serif">→</span>
				</Link>
			</div>
		</section>
	);
}
