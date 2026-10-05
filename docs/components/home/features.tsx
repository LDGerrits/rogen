import Link from "next/link";
import {
	FaFolder,
	FaMapSigns,
	FaFolderPlus,
	FaClone,
	FaSyncAlt,
	FaLayerGroup,
	FaSitemap,
} from "react-icons/fa";

export function Features() {
	return (
		<section id="features" className="py-24 px-6 relative">
			<div className="max-w-6xl mx-auto relative z-10">
				<div className="absolute top-20 right-55 w-100 h-100 bg-white opacity-[0.05] blur-[80px] rounded-full pointer-events-none -z-10 translate-x-1/2 -translate-y-1/2" />

				<div className="flex flex-col items-end text-right mb-16">
					<h2 className="text-3xl md:text-5xl font-bold text-white mb-4 tracking-tight">
						Organize code by feature
					</h2>
					<p className="text-gray-400 max-w-xl tracking-tight text-lg">
						Everything about one part of your game, in one place.
					</p>
				</div>

				<div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
					{[
						{
							title: "Feature Folders",
							desc: "Everything a feature needs sits in one folder, named after what it does in your game.",
							icon: <FaFolder className="text-white" />,
						},
						{
							title: "Declared Routes",
							desc: "A short map in your config says where each route goes, so Rogen never has to guess.",
							icon: <FaMapSigns className="text-white" />,
						},
						{
							title: "Variants",
							desc: "Swap in a mock or dev version of a file at build time, without touching a single require.",
							icon: <FaClone className="text-white" />,
						},
						{
							title: "Several Places",
							desc: "Share code between places. Each place is a small config that extends a common one.",
							icon: <FaFolderPlus className="text-white" />,
						},
						{
							title: "Luau, roblox-ts and Darklua",
							desc: "rogen init detects your toolchain and writes a config to match.",
							icon: <FaLayerGroup className="text-white" />,
						},
						{
							title: "Watch and Diagnostics",
							desc: "Rogen rebuilds as you work, picks up config edits on the fly, and points every error at a file and line.",
							icon: <FaSyncAlt className="text-white" />,
						},
					].map((feature, i) => (
						<div
							key={i}
							className="glass-card flex flex-col items-start p-8 rounded-xl cursor-default"
						>
							<div className="mb-6 h-6 flex items-center justify-start text-xl w-full">
								{feature.icon}
							</div>
							<h3 className="text-base font-semibold text-white mb-2">
								{feature.title}
							</h3>
							<p className="text-gray-400 text-sm leading-relaxed">
								{feature.desc}
							</p>
						</div>
					))}

					<Link
						href="/docs/v2/architectures"
						className="glass-card md:col-span-3 flex flex-col md:flex-row md:items-center gap-6 p-8 rounded-xl"
					>
						<div className="h-6 flex items-center text-xl">
							<FaSitemap className="text-white" />
						</div>
						<div className="grow">
							<h3 className="text-base font-semibold text-white mb-2">
								Any Architecture
							</h3>
							<p className="text-gray-400 text-sm leading-relaxed">
								Feature folders, VS Code-style layers, or ECS
								with Jecs or Matter. Pick the layout that suits
								your game and let a linter keep its import rules
								honest.
							</p>
						</div>
						<span className="text-gray-400 text-sm font-medium flex items-center gap-1">
							Compare architectures{" "}
							<span className="font-serif">→</span>
						</span>
					</Link>
				</div>
			</div>
		</section>
	);
}
