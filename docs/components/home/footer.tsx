import Image from "next/image";
import Link from "next/link";

export function Footer() {
	return (
		<footer className="py-12 px-6 border-t border-white/5 relative z-10">
			<div className="max-w-6xl mx-auto">
				<div className="grid grid-cols-1 md:grid-cols-4 gap-12 md:gap-8">
					<div className="md:col-span-2 flex flex-col h-full">
						<div className="flex items-center gap-2">
							<Image
								src="/icon.png"
								alt="Rogen Icon"
								width={20}
								height={20}
								className="w-5 h-5 object-contain"
							/>
							<span className="text-xl font-bold text-white tracking-tighter">
								Rogen
							</span>
						</div>
						<div className="mt-auto pt-6">
							<p className="text-gray-600 text-xs">
								{new Date().getFullYear()} L.D. Gerrits
							</p>
						</div>
					</div>

					<div>
						<h4 className="text-white font-medium mb-4 text-sm">
							Resources
						</h4>
						<ul className="space-y-3 text-sm">
							<li>
								<Link
									href="/docs/v1/introduction"
									className="text-gray-500 hover:text-white transition-colors"
								>
									Docs (Latest)
								</Link>
							</li>
							<li>
								<Link
									href="/docs/v1/installation"
									className="text-gray-500 hover:text-white transition-colors"
								>
									Quick Start
								</Link>
							</li>
							<li>
								<Link
									href="/docs/v2/introduction"
									className="text-gray-500 hover:text-white transition-colors"
								>
									Rogen v2 Docs
								</Link>
							</li>
						</ul>
					</div>

					<div>
						<h4 className="text-white font-medium mb-4 text-sm">
							Links
						</h4>
						<ul className="space-y-3 text-sm">
							<li>
								<a
									href="https://github.com/LDGerrits/rogen"
									target="_blank"
									rel="noopener noreferrer"
									className="text-gray-500 hover:text-white transition-colors"
								>
									GitHub
								</a>
							</li>
							<li>
								<a
									href="https://discord.gg/your-invite"
									target="_blank"
									rel="noopener noreferrer"
									className="text-gray-500 hover:text-white transition-colors"
								>
									Discord
								</a>
							</li>
							<li>
								<a
									href="https://devforum.roblox.com/"
									target="_blank"
									rel="noopener noreferrer"
									className="text-gray-500 hover:text-white transition-colors"
								>
									DevForum
								</a>
							</li>
						</ul>
					</div>
				</div>
			</div>
		</footer>
	);
}
