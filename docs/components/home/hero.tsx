import Link from "next/link";
import { FaGithub, FaFileCode } from "react-icons/fa";
import { SiTypescript } from "react-icons/si";

export function Hero() {
	return (
		<section className="flex flex-col items-center justify-center pt-48 pb-24 px-6 relative">
			<div className="relative z-10 w-full max-w-5xl mx-auto flex flex-col items-center text-center">
				<div className="absolute top-1/2 left-1/2 w-125 h-125 bg-white opacity-[0.15] blur-[100px] rounded-full pointer-events-none -z-10 -translate-x-1/2 -translate-y-1/2" />

				<div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/3 border border-white/10 text-xs md:text-sm font-medium text-gray-300 shadow-lg backdrop-blur-md mb-8 transition-all duration-200">
					<span className="flex h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
					<span className="text-white font-semibold">Notice:</span>
					<span className="text-gray-400">
						Rojo 7.7.0 introduced a bug. Downgrade to 7.6.1 until
						patch
					</span>
				</div>

				<h1 className="text-5xl md:text-7xl lg:text-[96px] font-bold tracking-tighter text-white leading-[1.02] mb-8">
					Bring feature-first
					<br />
					architecture to Roblox
				</h1>

				<p className="text-lg md:text-xl text-gray-400 max-w-2xl mx-auto leading-relaxed tracking-tight mb-10">
					Build self-contained systems with client, server, and shared
					code in one place
					<br />
					Rogen routes every file to the correct Roblox service
					automatically
				</p>

				<div className="flex flex-col sm:flex-row gap-4 mb-6 w-full sm:w-auto">
					<Link href="/docs/v1">
						<button className="w-full sm:w-auto px-8 py-3.5 bg-white text-black rounded-lg font-bold transition-all duration-200 hover:shadow-[0_0_30px_rgba(255,255,255,0.25)] hover:-translate-y-0.5 active:scale-95 active:translate-y-0 shadow-[0_0_20px_rgba(255,255,255,0.15)]">
							Quick Start
						</button>
					</Link>
					<a
						href="https://github.com/LDGerrits/rogen"
						target="_blank"
						rel="noopener noreferrer"
					>
						<button className="w-full sm:w-auto px-8 py-3.5 flex items-center justify-center gap-2 border border-white/20 bg-transparent rounded-lg font-medium text-white transition-all duration-200 hover:bg-white/10 hover:border-white/40 hover:-translate-y-0.5 active:scale-95 active:translate-y-0">
							<FaGithub className="text-lg" />
							GitHub
						</button>
					</a>
				</div>

				<div className="flex items-center gap-3 px-4 py-1.5 rounded-full bg-white/5 border border-white/10 text-sm font-medium text-gray-400 shadow-sm backdrop-blur-md w-max">
					<div className="flex items-center gap-2">
						<FaFileCode className="text-white" />
						<span>Luau</span>
					</div>
					<span className="text-white/20">|</span>
					<div className="flex items-center gap-2">
						<SiTypescript className="text-white" />
						<span>TypeScript</span>
					</div>
				</div>
			</div>
		</section>
	);
}
