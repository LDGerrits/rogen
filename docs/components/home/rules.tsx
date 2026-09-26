export function Rules() {
	return (
		<section className="py-24 px-6 relative">
			<div className="max-w-6xl mx-auto relative z-10">
				<div className="absolute top-20 left-30 w-100 h-100 bg-white opacity-[0.05] blur-[80px] rounded-full pointer-events-none -z-10 -translate-x-1/2 -translate-y-1/2" />

				<div className="flex flex-col items-start text-left mb-16">
					<h2 className="text-3xl md:text-5xl font-bold text-white mb-4 tracking-tight">
						Simple routing rules
					</h2>
					<p className="text-gray-400 max-w-xl tracking-tight text-lg">
						Control exactly where your code goes in Roblox Studio
					</p>
				</div>

				<div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
					{[
						{
							title: "Folder Names",
							desc: "Name a folder 'client' or 'ReplicatedFirst' to send files to that exact service",
							example: "src/combat/client/...",
						},
						{
							title: "File Names",
							desc: "Add target words to the start or end of a file name",
							example: "InputClient.luau",
						},
						{
							title: "Marker Files",
							desc: "Place a blank '.server' file in a folder to set its target",
							example: "anti-cheat/.server",
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
							<div className="mt-auto flex justify-start w-full">
								<code className="inline-block text-xs text-gray-400 bg-[#0a0a0a] border border-white/10 px-4 py-3 rounded-md font-mono">
									{rule.example}
								</code>
							</div>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}
