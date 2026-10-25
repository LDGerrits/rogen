import Image from "next/image";
import Link from "next/link";

export function Footer() {
	return (
		<footer className="border-t border-rule px-6 py-14">
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
							<span className="text-xl font-bold tracking-[-0.03em] text-paper">
								Rogen
							</span>
						</div>
						<div className="mt-auto pt-6">
							<p className="text-stone-600 text-xs">
								{new Date().getFullYear()} L.D. Gerrits
							</p>
						</div>
					</div>

					<div>
						<h4 className="text-paper font-medium mb-4 text-sm">
							Resources
						</h4>
						<ul className="space-y-3 text-sm">
							<li>
								<Link
									href="/docs/v2"
									className="text-stone-500 hover:text-paper transition-colors duration-200"
								>
									Docs
								</Link>
							</li>
							<li>
								<Link
									href="/docs/v2/installation"
									className="text-stone-500 hover:text-paper transition-colors duration-200"
								>
									Quick Start
								</Link>
							</li>
							<li>
								<Link
									href="/docs/v2/architectures"
									className="text-stone-500 hover:text-paper transition-colors duration-200"
								>
									Architectures
								</Link>
							</li>
						</ul>
					</div>

					<div>
						<h4 className="text-paper font-medium mb-4 text-sm">
							Links
						</h4>
						<ul className="space-y-3 text-sm">
							<li>
								<a
									href="https://github.com/LDGerrits/rogen"
									target="_blank"
									rel="noopener noreferrer"
									className="text-stone-500 hover:text-paper transition-colors duration-200"
								>
									GitHub
								</a>
							</li>
							<li>
								<a
									href="https://discord.com/channels/385151591524597761/1503801029232295996"
									target="_blank"
									rel="noopener noreferrer"
									className="text-stone-500 hover:text-paper transition-colors duration-200"
								>
									Discord
								</a>
							</li>
							<li>
								<a
									href="https://devforum.roblox.com/t/rogen-feature-based-folder-structures-with-rojo-an-automatic-tool-for-luau-and-roblox-ts/4625829?u=clinkety"
									target="_blank"
									rel="noopener noreferrer"
									className="text-stone-500 hover:text-paper transition-colors duration-200"
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
