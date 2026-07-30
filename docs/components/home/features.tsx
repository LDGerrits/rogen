import {
	FaFolder,
	FaMapSigns,
	FaFolderPlus,
	FaTags,
	FaCodeBranch,
	FaLayerGroup,
} from "react-icons/fa";

export function Features() {
	return (
		<section id="features" className="py-24 px-6 relative">
			<div className="max-w-6xl mx-auto relative z-10">
				<div className="absolute top-20 right-55 w-100 h-100 bg-white opacity-[0.05] blur-[80px] rounded-full pointer-events-none -z-10 translate-x-1/2 -translate-y-1/2" />

				<div className="flex flex-col items-end text-right mb-16">
					<h2 className="text-3xl md:text-5xl font-bold text-white mb-4 tracking-tight">
						Group files by feature
					</h2>
					<p className="text-gray-400 max-w-xl tracking-tight text-lg">
						Keep related code in one place
					</p>
				</div>

				<div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
					{[
						{
							title: "Feature Folders",
							desc: "Store related client, server and shared scripts inside a single folder",
							icon: <FaFolder className="text-white" />,
						},
						{
							title: "Auto-Routing",
							desc: "Route files to Roblox services automatically using Rojo or Argon",
							icon: <FaMapSigns className="text-white" />,
						},
						{
							title: "Multi-Place Support",
							desc: "Merge multiple source directories to share core systems across different places",
							icon: <FaFolderPlus className="text-white" />,
						},
						{
							title: "Environment Tags",
							desc: "Filter test files and inject mock files at build time using tags",
							icon: <FaTags className="text-white" />,
						},
						{
							title: "Custom Pathing",
							desc: "Control the final output structure using invisible folders and marker files",
							icon: <FaCodeBranch className="text-white" />,
						},
						{
							title: "Modern Tooling",
							desc: "Support Luau, roblox-ts, and Darklua pipelines out of the box",
							icon: <FaLayerGroup className="text-white" />,
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
				</div>
			</div>
		</section>
	);
}
