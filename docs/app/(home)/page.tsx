"use client";

import Link from "next/link";
import Image from "next/image";
import { useState, useEffect } from "react";
import {
	FaFolderOpen,
	FaFileCode,
	FaLayerGroup,
	FaPuzzlePiece,
	FaFolder,
	FaBox,
	FaServer,
	FaFileAlt,
	FaCopy,
	FaQuoteLeft,
	FaTerminal,
	FaUser,
} from "react-icons/fa";
import { SiRoblox, SiTypescript } from "react-icons/si";

export default function HomePage() {
	const [copied, setCopied] = useState(false);
	const [version, setVersion] = useState<string>("1.3.1");

	useEffect(() => {
		let isMounted = true;

		fetch("https://api.github.com/repos/LDGerrits/rogen/releases/latest")
			.then((res) => res.json())
			.then((data) => {
				if (isMounted && data.tag_name) {
					setVersion(data.tag_name.replace(/^v/, ""));
				}
			})
			.catch((err) =>
				console.error("Failed to fetch latest Rogen version", err)
			);

		return () => {
			isMounted = false;
		};
	}, []);

	const handleCopy = () => {
		navigator.clipboard.writeText(`rogen = "ldgerrits/rogen@${version}"`);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<div className="min-h-screen w-full relative bg-[#030303] overflow-hidden font-sans text-gray-300 selection:bg-white/30 selection:text-white">
			<style>{`
        .glass-card {
          background: rgba(10, 10, 10, 0.6);
          backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          transition: border-color 0.2s ease, transform 0.2s ease;
        }
        .glass-card:hover {
          border-color: rgba(255, 255, 255, 0.2);
          transform: translateY(-2px);
        }
        .code-snippet {
          background: linear-gradient(180deg, #111, #050505);
          border: 1px solid rgba(255, 255, 255, 0.1);
        }
      `}</style>

			<div className="relative z-20">
				<section className="flex flex-col items-center justify-center pt-32 pb-24 px-6 relative">
					<div className="relative z-10 w-full max-w-5xl mx-auto flex flex-col items-center text-center">
						<h1 className="text-5xl md:text-7xl lg:text-[96px] font-bold tracking-tighter text-white leading-[1.02] mb-8">
							Group your code
							<br />
							by feature
						</h1>

						<p className="text-lg md:text-xl text-gray-400 max-w-2xl mx-auto leading-relaxed tracking-tight mb-10">
							Put client, server and shared code side by side
							<br />
							Rogen sends every file to the right place
							automatically
						</p>

						<div className="flex flex-col sm:flex-row gap-4 mb-6 w-full sm:w-auto">
							<Link href={"/docs/v1/introduction"}>
								<button className="w-full sm:w-auto px-8 py-3.5 bg-white text-black rounded-lg font-bold transition-all hover:bg-gray-200 active:scale-95 shadow-[0_0_20px_rgba(255,255,255,0.15)]">
									Quick Start
								</button>
							</Link>
							<Link href="#features">
								<button className="w-full sm:w-auto px-8 py-3.5 border border-white/20 bg-transparent rounded-lg font-medium text-white hover:bg-white/5 transition-all active:scale-95">
									Read Features
								</button>
							</Link>
						</div>

						<div className="flex items-center gap-3 px-4 py-1.5 rounded-full bg-white/5 border border-white/10 text-sm font-medium text-gray-400 shadow-sm backdrop-blur-md mb-24 w-max">
							<div className="flex items-center gap-2">
								<FaFileCode className="text-blue-300" />
								<span>Luau</span>
							</div>
							<span className="text-white/20">|</span>
							<div className="flex items-center gap-2">
								<SiTypescript className="text-blue-400" />
								<span>TypeScript</span>
							</div>
						</div>

						<div className="w-full max-w-5xl mx-auto flex flex-col md:flex-row items-stretch justify-center gap-4 relative text-left">
							<div className="flex-1 bg-[#050505] rounded-xl border border-white/10 overflow-hidden z-10 flex flex-col shadow-2xl">
								<div className="bg-[#0a0a0a] px-4 py-3 flex items-center gap-3 border-b border-white/10">
									<FaTerminal className="text-gray-500 text-sm" />
									<span className="text-xs font-mono text-gray-400 tracking-wide uppercase">
										File System
									</span>
								</div>
								<div className="p-6 font-mono text-sm leading-8 text-gray-400 whitespace-nowrap overflow-x-auto">
									<div className="flex items-center gap-2">
										<FaFolder className="text-gray-600" />{" "}
										src
									</div>
									<div className="flex items-center gap-2 ml-4">
										<FaFolderOpen className="text-white" />{" "}
										<span className="text-white font-medium">
											Inventory
										</span>
									</div>
									<div className="flex items-center gap-2 ml-8 opacity-50">
										<FaFolder className="text-gray-500" />{" "}
										client
									</div>
									<div className="flex items-center gap-2 ml-12">
										<FaFileCode className="text-white" />{" "}
										InventoryController.luau
									</div>
									<div className="flex items-center gap-2 ml-8 opacity-50">
										<FaFolder className="text-gray-500" />{" "}
										server
									</div>
									<div className="flex items-center gap-2 ml-12">
										<FaFileCode className="text-white" />{" "}
										InventoryService.luau
									</div>
									<div className="flex items-center gap-2 ml-8 opacity-50">
										<FaFolder className="text-gray-500" />{" "}
										shared
									</div>
									<div className="flex items-center gap-2 ml-12">
										<FaFileCode className="text-white" />{" "}
										InventoryTypes.luau
									</div>
								</div>
							</div>

							<div className="flex items-center justify-center z-20 py-8 md:py-0">
								<svg
									className="text-gray-500 md:rotate-0 rotate-90 transition-colors duration-300 hover:text-white"
									fill="none"
									height="32"
									shapeRendering="geometricPrecision"
									stroke="currentColor"
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth="1"
									viewBox="0 0 24 24"
									width="32"
								>
									<path d="M5 12h14"></path>
									<path d="M12 5l7 7-7 7"></path>
								</svg>
							</div>

							<div className="flex-1 bg-[#050505] rounded-xl border border-white/10 overflow-hidden z-10 flex flex-col shadow-2xl">
								<div className="bg-[#0a0a0a] px-4 py-3 flex items-center gap-3 border-b border-white/10">
									<SiRoblox className="text-gray-400 text-sm" />
									<span className="text-xs font-mono text-gray-400 tracking-wide uppercase">
										Roblox Studio
									</span>
								</div>
								<div className="p-6 font-mono text-sm leading-8 text-gray-400 whitespace-nowrap overflow-x-auto">
									<div className="flex items-center gap-2">
										<FaBox className="text-gray-600" />{" "}
										ReplicatedStorage
									</div>
									<div className="flex items-center gap-2 ml-4">
										<FaFolder className="text-white" />{" "}
										<span className="text-white font-medium">
											Inventory
										</span>
									</div>
									<div className="flex items-center gap-2 ml-8">
										<FaFileAlt className="text-gray-400" />{" "}
										InventoryTypes
									</div>

									<div className="flex items-center gap-2 mt-3">
										<FaServer className="text-gray-600" />{" "}
										ServerScriptService
									</div>
									<div className="flex items-center gap-2 ml-4">
										<FaFolder className="text-white" />{" "}
										<span className="text-white font-medium">
											Inventory
										</span>
									</div>
									<div className="flex items-center gap-2 ml-8">
										<FaFileAlt className="text-gray-400" />{" "}
										InventoryService
									</div>

									<div className="flex items-center gap-2 mt-3">
										<FaUser className="text-gray-600" />{" "}
										StarterPlayerScripts
									</div>
									<div className="flex items-center gap-2 ml-4">
										<FaFolder className="text-white" />{" "}
										<span className="text-white font-medium">
											Inventory
										</span>
									</div>
									<div className="flex items-center gap-2 ml-8">
										<FaFileAlt className="text-gray-400" />{" "}
										InventoryController
									</div>
								</div>
							</div>
						</div>
					</div>
				</section>

				<section className="py-24 px-6 border-t border-white/10 bg-[#000]">
					<div className="max-w-6xl mx-auto">
						<div className="text-left mb-16">
							<h2 className="text-3xl md:text-5xl font-bold text-white mb-4 tracking-tight">
								Top developers use Rogen
							</h2>
						</div>

						<div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
							{[
								{
									quote: "Very grateful for your work on this. It has been a game changer for my team and I.",
									author: "Acecateer",
									role: "Technical Director, Wonder Works Studio",
								},
								{
									quote: "Spent the last couple days refactoring Lua Learning to use Rogen. I love it.",
									author: "Zack (boatbomber) Williams",
									role: "CEO, Torpedo Software",
								},
							].map((testimonial, i) => (
								<div
									key={i}
									className="p-8 rounded-xl glass-card flex flex-col justify-between border-l-2 hover:border-l-white border-l-transparent"
								>
									<FaQuoteLeft className="text-white/10 text-xl mb-4" />
									<p className="text-gray-300 text-[15px] mb-8 leading-relaxed">
										&quot;{testimonial.quote}&quot;
									</p>
									<div>
										<div className="text-white font-medium text-sm">
											{testimonial.author}
										</div>
										<div className="text-gray-500 text-xs mt-1">
											{testimonial.role}
										</div>
									</div>
								</div>
							))}
						</div>
					</div>
				</section>

				<section className="py-24 px-6 border-t border-white/10 bg-[#000]">
					<div className="max-w-6xl mx-auto">
						<div className="flex flex-col items-end text-right mb-16">
							<h2 className="text-3xl md:text-5xl font-bold text-white mb-4 tracking-tight">
								Simple file rules
							</h2>
							<p className="text-gray-400 max-w-xl tracking-tight text-lg">
								Rogen reads your folders to place files in the
								right spot
							</p>
						</div>

						<div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-right">
							{[
								{
									title: "Folder Names",
									desc: "Name a folder &apos;client&apos; or &apos;StarterGui&apos; to send files to that exact service",
									example: "src/combat/client/...",
								},
								{
									title: "Marker Files",
									desc: "Place a blank &apos;.server&apos; file in a folder to set its target",
									example: "anti-cheat/.server",
								},
								{
									title: "Name Tags",
									desc: "Add target words to the start or end of a file name",
									example: "input-client.ts",
								},
							].map((rule, i) => (
								<div
									key={i}
									className="flex flex-col items-end h-full p-8 rounded-xl glass-card"
								>
									<h3 className="text-base font-semibold text-white mb-2">
										{rule.title}
									</h3>
									<p className="text-gray-400 text-sm mb-8 flex-grow leading-relaxed">
										{rule.desc}
									</p>
									<div className="mt-auto flex justify-end w-full">
										<code className="inline-block text-xs text-gray-400 bg-[#0a0a0a] border border-white/10 px-4 py-3 rounded-md font-mono">
											{rule.example}
										</code>
									</div>
								</div>
							))}
						</div>
					</div>
				</section>

				<section
					id="features"
					className="py-24 px-6 border-t border-white/10 bg-[#000]"
				>
					<div className="max-w-6xl mx-auto">
						<div className="text-left mb-16">
							<h2 className="text-3xl md:text-5xl font-bold text-white mb-4 tracking-tight">
								Group files by feature
							</h2>
							<p className="text-gray-400 max-w-xl tracking-tight text-lg">
								Stop jumping between folders
								<br />
								Keep all scripts for one feature in one place
							</p>
						</div>

						<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
							{[
								{
									title: "Build by feature",
									desc: "Keep UI and scripts for one tool in one folder",
									icon: (
										<FaLayerGroup className="text-white" />
									),
								},
								{
									title: "Smart sorting",
									desc: "Send files to any Roblox service like ReplicatedFirst using just their names",
									icon: (
										<FaPuzzlePiece className="text-white" />
									),
								},
								{
									title: "Merge folders",
									desc: "Combine many folders into one workspace to share core code",
									icon: (
										<FaFolderOpen className="text-white" />
									),
								},
								{
									title: "Live updates",
									desc: "Rogen updates Studio the moment you save a file",
									icon: (
										<Image
											src="/icon.png"
											alt="Rogen Icon"
											width={20}
											height={20}
											className="w-5 h-5 object-contain"
										/>
									),
								},
								{
									title: "TS and Darklua",
									desc: "Tell Rogen where compiled code goes before it syncs",
									icon: (
										<SiTypescript className="text-white" />
									),
								},
								{
									title: "Strict rules",
									desc: "File rules beat folder rules so you stay in charge",
									icon: <FaFileCode className="text-white" />,
								},
							].map((feature, i) => (
								<div
									key={i}
									className="glass-card p-8 rounded-xl"
								>
									<div className="mb-6 h-6 flex items-center text-xl">
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

				<section className="py-32 px-6 border-t border-white/10">
					<div className="max-w-2xl mx-auto text-center relative flex flex-col items-center">
						<h2 className="text-3xl md:text-5xl font-bold text-white mb-4 tracking-tight">
							Upgrade your codebase
						</h2>
						<p className="text-gray-400 mb-10 tracking-tight text-lg">
							Install Rogen with Rokit and build faster today
						</p>

						<div className="w-full max-w-md text-left code-snippet rounded-lg p-4 mb-6 shadow-xl relative group">
							<div className="text-xs text-gray-500 mb-2 font-mono uppercase tracking-wider">
								rokit.toml
							</div>
							<div className="font-mono text-sm text-white flex justify-between items-center">
								<span>
									rogen = &quot;ldgerrits/rogen@{version}
									&quot;
								</span>
								<button
									onClick={handleCopy}
									className="text-gray-500 hover:text-white transition-colors p-2 -mr-2 rounded-md hover:bg-white/10"
									title="Copy to clipboard"
								>
									{copied ? (
										<span className="text-xs font-sans text-white">
											Copied!
										</span>
									) : (
										<FaCopy size={14} />
									)}
								</button>
							</div>
						</div>

						<Link
							href="/docs/v1/installation"
							className="text-gray-400 hover:text-white transition-colors text-sm font-medium flex items-center gap-1"
						>
							Read the setup guide{" "}
							<span className="font-serif">→</span>
						</Link>
					</div>
				</section>

				<footer className="py-12 px-6 border-t border-white/10 bg-[#000]">
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
											href="/docs/v1/quick-start"
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
			</div>
		</div>
	);
}
