import Link from "next/link";
import type { ReactNode } from "react";
import { FaFolder, FaShieldAlt, FaClone, FaTerminal } from "react-icons/fa";

interface Reason {
	readonly title: string;
	readonly desc: string;
	readonly icon: ReactNode;
	readonly link?: { readonly href: string; readonly text: string };
}

const reasons: readonly Reason[] = [
	{
		title: "Organize by feature",
		desc: "Group all code, UI, and assets for a specific feature in one place. This gives you high cohesion, better scalability, fewer merge conflicts, and features that are simple to maintain or delete.",
		icon: <FaFolder className="text-white" />,
		link: { href: "/docs/v2/architectures", text: "Compare architectures" },
	},
	{
		title: "Enforce boundaries",
		desc: "Keep coupling low with a linter. Every path names its feature, so a lint rule can stop one feature from requiring another.",
		icon: <FaShieldAlt className="text-white" />,
		link: {
			href: "/docs/v2/architectures#enforcing-the-rules",
			text: "See the lint rule",
		},
	},
	{
		title: "Multi-place games",
		desc: "Write shared code once and use it in every place. When one place needs something different, add a file with the same name to that place's folder, and it overwrites the shared one there.",
		icon: <FaClone className="text-white" />,
		link: { href: "/docs/v2/setups/places", text: "Set up places" },
	},
	{
		title: "Still Rojo",
		desc: "Rogen runs the Rojo commands you use, with the same flags. One tool, and nothing to relearn.",
		icon: <FaTerminal className="text-white" />,
		link: { href: "/docs/v2/coming-from-rojo", text: "Coming from Rojo" },
	},
];

export function Features() {
	return (
		<section id="features" className="py-24 px-6 relative">
			<div className="max-w-6xl mx-auto relative z-10">
				<div className="absolute top-20 right-55 w-100 h-100 bg-white opacity-[0.05] blur-[80px] rounded-full pointer-events-none -z-10 translate-x-1/2 -translate-y-1/2" />

				<div className="flex flex-col items-end text-right mb-16">
					<h2 className="text-3xl md:text-5xl font-bold text-white tracking-tight">
						Why Rogen?
					</h2>
				</div>

				<div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left">
					{reasons.map((reason, i) => (
						<div
							key={i}
							className="glass-card flex flex-col items-start p-8 rounded-xl cursor-default"
						>
							<div className="mb-6 h-6 flex items-center justify-start text-xl w-full">
								{reason.icon}
							</div>
							<h3 className="text-base font-semibold text-white mb-2">
								{reason.title}
							</h3>
							<p className="text-gray-400 text-sm leading-relaxed grow">
								{reason.desc}
							</p>
							{reason.link && (
								<Link
									href={reason.link.href}
									className="mt-6 text-gray-400 hover:text-white transition-colors text-sm font-medium inline-flex items-center gap-1"
								>
									{reason.link.text}{" "}
									<span className="font-serif">→</span>
								</Link>
							)}
						</div>
					))}
				</div>
			</div>
		</section>
	);
}
