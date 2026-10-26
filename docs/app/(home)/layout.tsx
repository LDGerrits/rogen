import type { ReactNode } from "react";
import localFont from "next/font/local";
import { LANG_SCRIPT } from "@/components/home/lang-script";
import { Nav } from "@/components/home/nav";
import "./home.css";

const sora = localFont({
	src: "../fonts/sora.woff2",
	weight: "100 800",
	variable: "--font-sora",
});

const jetbrainsMono = localFont({
	src: "../fonts/jetbrains-mono.woff2",
	weight: "100 800",
	variable: "--font-jetbrains-mono",
});

export default function Layout({ children }: { children: ReactNode }) {
	return (
		<div className={`home ${sora.variable} ${jetbrainsMono.variable}`}>
			<script dangerouslySetInnerHTML={{ __html: LANG_SCRIPT }} />
			<Nav />
			{children}
		</div>
	);
}
