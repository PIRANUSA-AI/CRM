import { createFileRoute } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'

export const Route = createFileRoute('/terms')({
	component: TermsPage,
})

function TermsPage() {
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
					<h1 className="text-3xl font-bold mb-4">Ketentuan Layanan</h1>
					<p className="text-muted-foreground mb-8">Terakhir diperbarui: 18 Desember 2025</p>
					<section className="mb-8">
						<h2 className="text-xl font-bold mb-3">Penerimaan ketentuan</h2>
						<p>Dengan mengakses atau menggunakan CRM, Anda setuju untuk terikat oleh Ketentuan Layanan ini. Jika tidak menyetujuinya, mohon untuk tidak menggunakan layanan kami.</p>
					</section>
					<section className="mb-8">
						<h2 className="text-xl font-bold mb-3">Hubungi kami</h2>
						<p>Jika memiliki pertanyaan mengenai Ketentuan Layanan ini, silakan hubungi kami:</p>
						<p className="mt-2">Email: <a href="mailto:legal@crm.chat" className="text-primary hover:underline">legal@crm.chat</a></p>
					</section>
				</article>
			</main>
			<footer className="border-t mt-16">
				<div className="container mx-auto px-4 py-6 text-center text-sm text-muted-foreground">© 2025 CRM. All rights reserved.</div>
			</footer>
		</div>
	)
}
