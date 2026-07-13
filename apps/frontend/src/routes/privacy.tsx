import { createFileRoute } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'

export const Route = createFileRoute('/privacy')({
	component: PrivacyPage,
})

function PrivacyPage() {
	return (
		<div className="min-h-screen bg-background">
			<header className="border-b">
				<div className="container mx-auto px-4 py-4 flex items-center justify-between">
					<a className="text-xl font-bold" href="/">CRM</a>
					<a className="inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground h-8 rounded-md px-3 text-xs" href="/">
						<ArrowLeft className="mr-2 h-4 w-4" />Kembali
					</a>
				</div>
			</header>
			<main className="container mx-auto px-4 py-8 max-w-4xl">
				<article className="prose prose-slate dark:prose-invert max-w-none">
					<h1 className="text-3xl font-bold mb-4">Kebijakan Privasi</h1>
					<p className="text-muted-foreground mb-8">Terakhir diperbarui: 18 Desember 2025</p>
					<section className="mb-8">
						<h2 className="text-xl font-bold mb-3">Pendahuluan</h2>
						<p>Selamat datang di CRM. Kami berkomitmen melindungi privasi dan keamanan informasi pribadi Anda. Kebijakan ini menjelaskan cara kami mengumpulkan, menggunakan, mengungkapkan, dan melindungi informasi saat Anda menggunakan platform kami.</p>
					</section>
					<section className="mb-8">
						<h2 className="text-xl font-bold mb-3">Hubungi kami</h2>
						<p>Jika memiliki pertanyaan mengenai Kebijakan Privasi atau praktik data kami, silakan hubungi kami:</p>
						<p className="mt-2">Email: <a href="mailto:privacy@crm.chat" className="text-primary hover:underline">privacy@crm.chat</a></p>
					</section>
				</article>
			</main>
			<footer className="border-t mt-16">
				<div className="container mx-auto px-4 py-6 text-center text-sm text-muted-foreground">© 2025 CRM. All rights reserved.</div>
			</footer>
		</div>
	)
}
