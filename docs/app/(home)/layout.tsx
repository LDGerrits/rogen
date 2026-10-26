import type { ReactNode } from "react";
import { JetBrains_Mono, Sora } from "next/font/google";
import { Nav } from "@/components/home/nav";
import "./home.css";

const sora = Sora({
	subsets: ["latin"],
	weight: ["400", "600"],
	variable: "--font-sora",
});

const jetbrainsMono = JetBrains_Mono({
	subsets: ["latin"],
	weight: ["400", "500"],
	variable: "--font-jetbrains-mono",
});

export default function Layout({ children }: { children: ReactNode }) {
	return (
		<div className={`home ${sora.variable} ${jetbrainsMono.variable}`}>
			<Nav />
			{children}
		</div>
	);
}
