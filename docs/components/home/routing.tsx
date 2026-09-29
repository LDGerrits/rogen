import Link from "next/link";

export function Routing() {
	return (
		<section className="py-24 px-6 relative">
			<div className="max-w-6xl mx-auto relative z-10">
				<div className="absolute top-20 left-30 w-100 h-100 bg-white opacity-[0.05] blur-[80px] rounded-full pointer-events-none -z-10 -translate-x-1/2 -translate-y-1/2" />

				<div className="flex flex-col items-start text-left mb-16">
					<h2 className="text-3xl md:text-5xl font-bold text-white mb-4 tracking-tight">
						How routing works
					</h2>
					<p className="text-gray-400 max-w-xl tracking-tight text-lg">
						Your config declares the routes. A file follows one in
						three ways
					</p>
				</div>

				<div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
					{[
						{
							title: "Routing Folders",
							desc: "Name a folder after a route. Everything inside goes to its service, and the folder itself disappears",
							example: "Inventory/Server/Save.luau",
							result: "ServerScriptService/Inventory/Save",
						},
						{
							title: "Marker Files",
							desc: "Put an empty file named after a route in a folder. The folder keeps its name",
							example: "AntiCheat/.server",
							result: "ServerScriptService/AntiCheat/…",
						},
						{
							title: "Suffixes",
							desc: "End a file name with a route to send just that file",
							example: "Combat/CombatServiceServer.luau",
							result: "ServerScriptService/Combat/CombatService",
						},
					].map((rule, i) => (
						<div
							key={i}
							className="flex flex-col items-start h-full p-8 rounded-xl glass-card cursor-default"
						>
							<h3 className="text-base font-semibold text-white mb-2">
								{rule.title}
							</h3>
							<p className="text-gray-400 text-sm mb-8 grow leading-relaxed">
								{rule.desc}
							</p>
							<div className="mt-auto flex flex-col items-start gap-2 w-full font-mono text-xs">
								<code className="inline-block text-gray-300 bg-[#0a0a0a] border border-white/10 px-4 py-3 rounded-md">
									{rule.example}
								</code>
								<code className="inline-block text-gray-500 px-4">
									→ {rule.result}
								</code>
							</div>
						</div>
					))}
				</div>

				<Link
					href="/docs/v2/core-concepts/routing"
					className="mt-10 text-gray-400 hover:text-white transition-colors text-sm font-medium inline-flex items-center gap-1"
				>
					Read how routing works <span className="font-serif">→</span>
				</Link>
			</div>
		</section>
	);
}
