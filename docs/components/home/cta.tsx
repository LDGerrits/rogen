"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { FaCopy } from "react-icons/fa";

export function CtaSection() {
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
		<section className="py-32 px-6">
			<div className="max-w-2xl mx-auto text-center relative flex flex-col items-center">
				<h2 className="text-3xl md:text-5xl font-bold text-white mb-4 tracking-tight">
					Upgrade your codebase
				</h2>
				<p className="text-gray-400 mb-10 tracking-tight text-lg">
					Install Rogen with Rokit and build faster
				</p>

				<div className="w-full max-w-md text-left bg-[#0a0a0a] border border-white/10 rounded-lg p-4 mb-6 shadow-2xl relative group">
					<div className="text-xs text-gray-500 mb-2 font-mono uppercase tracking-wider">
						rokit.toml
					</div>
					<div className="font-mono text-sm text-white flex justify-between items-center">
						<span>
							rogen = &quot;ldgerrits/rogen@{version}&quot;
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
					Read the setup guide <span className="font-serif">→</span>
				</Link>
			</div>
		</section>
	);
}
