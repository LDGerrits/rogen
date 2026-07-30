"use client";

import type { ReactNode } from "react";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import { baseOptions } from "@/lib/layout.shared";
import { BookText, Telescope, ChevronDown } from "lucide-react";
import { motion } from "framer-motion";
import {
	NavbarMenu,
	NavbarMenuContent,
	NavbarMenuLink,
	NavbarMenuTrigger,
} from "fumadocs-ui/layouts/home/navbar";
import { RiTwitterXLine } from "react-icons/ri";
import { FaDiscord, FaGithub } from "react-icons/fa";

const SOCIALS = {
	Github: "https://github.com/LDGerrits/rogen",
	Discord:
		"https://discord.com/channels/385151591524597761/1503801029232295996",
	X: "https://x.com/playfullygames",
};

export default function Layout({ children }: { children: ReactNode }) {
	const base = baseOptions();

	return (
		<HomeLayout
			{...base}
			themeSwitch={{ enabled: false }}
			links={[
				{
					text: "Docs",
					url: "/docs/v1",
					active: "nested-url",
				},
				{
					type: "custom",
					on: "nav",
					children: (
						<NavbarMenu>
							<NavbarMenuTrigger className="flex items-center gap-1">
								Versions
								<ChevronDown className="w-4 h-4 opacity-50" />
							</NavbarMenuTrigger>
							<NavbarMenuContent>
								<NavbarMenuLink href="/docs/v1">
									<BookText className="mr-3 h-5 w-5 text-white" />
									<div className="flex flex-col">
										<span className="font-medium text-white">
											Rogen v1 (latest)
										</span>
										<span className="text-sm text-muted-foreground">
											Documentation for the latest version
											of Rogen
										</span>
									</div>
								</NavbarMenuLink>

								<NavbarMenuLink href="/docs/v2">
									<Telescope className="mr-3 h-5 w-5 opacity-50" />
									<div className="flex flex-col">
										<span className="font-medium opacity-50">
											Rogen v2 (coming soon)
										</span>
										<span className="text-sm opacity-50">
											Upcoming documentation
										</span>
									</div>
								</NavbarMenuLink>
							</NavbarMenuContent>
						</NavbarMenu>
					),
				},
				{
					type: "custom",
					children: (
						<div className="flex items-center gap-3 ml-4">
							<motion.a
								href={SOCIALS.Github}
								target="_blank"
								rel="noopener noreferrer"
								whileHover={{ scale: 1.15 }}
								whileTap={{ scale: 0.95 }}
								initial={{ opacity: 0, y: -4 }}
								animate={{ opacity: 1, y: 0 }}
								transition={{
									type: "spring",
									stiffness: 300,
									damping: 20,
								}}
								className="group relative flex items-center justify-center p-2 rounded-md hover:bg-muted/30 transition-colors"
								aria-label="GitHub"
							>
								<FaGithub className="h-4 w-4 text-white group-hover:text-gray-300" />
								<span className="pointer-events-none absolute -bottom-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-black px-2 py-1 text-xs text-white opacity-0 group-hover:opacity-100 transition-all">
									GitHub
								</span>
							</motion.a>

							<motion.a
								href={SOCIALS.Discord}
								target="_blank"
								rel="noopener noreferrer"
								whileHover={{ scale: 1.15 }}
								whileTap={{ scale: 0.95 }}
								initial={{ opacity: 0, y: -4 }}
								animate={{ opacity: 1, y: 0 }}
								transition={{
									type: "spring",
									stiffness: 300,
									damping: 20,
									delay: 0.05,
								}}
								className="group relative flex items-center justify-center p-2 rounded-md hover:bg-muted/30 transition-colors"
								aria-label="Discord"
							>
								<FaDiscord className="h-4 w-4 text-white group-hover:text-indigo-300" />
								<span className="pointer-events-none absolute -bottom-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-black px-2 py-1 text-xs text-white opacity-0 group-hover:opacity-100 transition-all">
									Discord
								</span>
							</motion.a>

							<motion.a
								href={SOCIALS.X}
								target="_blank"
								rel="noopener noreferrer"
								whileHover={{ scale: 1.15 }}
								whileTap={{ scale: 0.95 }}
								initial={{ opacity: 0, y: -4 }}
								animate={{ opacity: 1, y: 0 }}
								transition={{
									type: "spring",
									stiffness: 300,
									damping: 20,
									delay: 0.1,
								}}
								className="group relative flex items-center justify-center p-2 rounded-md hover:bg-muted/30 transition-colors"
								aria-label="Twitter"
							>
								<RiTwitterXLine className="h-4 w-4 text-white group-hover:text-sky-300" />
								<span className="pointer-events-none absolute -bottom-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-black px-2 py-1 text-xs text-white opacity-0 group-hover:opacity-100 transition-all">
									Twitter
								</span>
							</motion.a>
						</div>
					),
				},
			]}
		>
			{children}
		</HomeLayout>
	);
}
