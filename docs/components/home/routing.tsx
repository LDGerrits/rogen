import Link from "next/link";

const CONFIG = `{
  "name": "Game",
  "routes": {
    "Server": "ServerScriptService",
    "Client": "StarterPlayer/StarterPlayerScripts",
    "Shared": "ReplicatedStorage/Shared",
    "*": "ReplicatedStorage/Shared"
  },
  "tree": { "$className": "DataModel" }
}`;

export function Routing() {
	return (
		<section id="routing" className="py-24 px-6 relative">
			<div className="max-w-6xl mx-auto relative z-10">
				<div className="absolute top-20 left-30 w-100 h-100 bg-white opacity-[0.05] blur-[80px] rounded-full pointer-events-none -z-10 -translate-x-1/2 -translate-y-1/2" />

				<div className="flex flex-col items-start text-left mb-16">
					<h2 className="text-3xl md:text-5xl font-bold text-white mb-4 tracking-tight">
						How routing works
					</h2>
					<p className="text-gray-400 max-w-xl tracking-tight text-lg">
						<code className="text-gray-300">
							default.rogen.json
						</code>{" "}
						is a Rojo project file with three more keys. Many
						projects need only{" "}
						<code className="text-gray-300">routes</code>.
					</p>
				</div>

				<div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6 text-left">
					<div className="bg-[#050505] rounded-xl border border-white/10 overflow-hidden flex flex-col shadow-2xl">
						<div className="bg-[#0a0a0a] px-4 py-3 border-b border-white/10">
							<span className="text-xs font-mono text-gray-400 tracking-wide">
								default.rogen.json
							</span>
						</div>
						<pre className="p-6 font-mono text-sm leading-7 text-gray-300 overflow-x-auto">
							{CONFIG}
						</pre>
					</div>

					<div className="flex flex-col justify-center gap-6 p-8 rounded-xl glass-card cursor-default">
						<p className="text-gray-300 leading-relaxed">
							A folder or an <code className="text-white">@</code>{" "}
							suffix named after a route sends its code there. The{" "}
							<code className="text-white">*</code> route takes
							every file that matches no other.
						</p>
						<p className="text-gray-400 leading-relaxed">
							The routes are yours to change. Add{" "}
							<code className="text-gray-300">
								&quot;Gui&quot;: &quot;StarterGui&quot;
							</code>
							, and a <code className="text-gray-300">Gui</code>{" "}
							folder or a{" "}
							<code className="text-gray-300">@Gui</code> suffix
							sends code to StarterGui.
						</p>
						<p className="text-gray-400 leading-relaxed">
							Rogen writes the{" "}
							<code className="text-gray-300">
								default.project.json
							</code>{" "}
							that Rojo reads from it.
						</p>
					</div>
				</div>

				<div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
					{[
						{
							title: "Routing Folders",
							desc: "Name a folder after a route and everything inside goes to its target. The folder itself disappears.",
							example: "Inventory/Server/InventoryService.luau",
							result: "ServerScriptService/Inventory/InventoryService",
						},
						{
							title: "The @ Sign",
							desc: "Add @ and a route to the end of a file's name to send just that file. A module stays a module.",
							example: "Inventory/Save@Server.luau",
							result: "ServerScriptService/Inventory/Save",
						},
						{
							title: "Marker Files",
							desc: "Put a file named after a route, with an @ in front, in a folder, and the whole folder goes there with its name.",
							example: "AntiCheat/@Server",
							result: "ServerScriptService/AntiCheat/…",
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
