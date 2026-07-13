import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { resolve } from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import viteTsConfigPaths from 'vite-tsconfig-paths'

const workspaceDir = resolve(import.meta.dirname, '../..')
const fileEnv = loadEnv(process.env.NODE_ENV || 'development', workspaceDir, '')
const env = { ...fileEnv, ...process.env }
const isTunnelHmrEnabled = env.ENABLE_TUNNEL_HMR === 'true'
const tunnelFeHost = env.TUNNEL_FE_HOST || 'local-fe.crm.chat'
const rawApiUrl = env.VITE_API_URL || 'http://localhost:3010'
const forceOptimizeDeps = env.VITE_FORCE_OPTIMIZE_DEPS === 'true'

function resolveApiProxyTarget(input: string) {
	try {
		const url = new URL(input)
		const normalizedPath = url.pathname.replace(/\/+$/, '')
		const pathWithoutApi =
			normalizedPath === '/api'
				? ''
				: normalizedPath.endsWith('/api')
					? normalizedPath.slice(0, -4)
					: normalizedPath

		return `${url.origin}${pathWithoutApi}`
	} catch {
		return input.replace(/\/api\/?$/, '')
	}
}

const apiProxyTarget = resolveApiProxyTarget(rawApiUrl)

export default defineConfig({
	envDir: workspaceDir,
	optimizeDeps: {
		include: ['react', 'react-dom'],
		force: forceOptimizeDeps,
	},
	plugins: [
		tanstackStart(),
		nitro({
			preset: 'node',
			devServer: {
				port: 42070,
			},
			devProxy: {
				'/api/**': apiProxyTarget,
				'/auth/**': apiProxyTarget,
			},
			routeRules: {
				'/api/**': {
					proxy: `${apiProxyTarget}/api/**`,
				},
				'/auth/**': {
					proxy: `${apiProxyTarget}/auth/**`,
				},
			},
			prerender: {
				routes: [],
			},
		}),
		viteTsConfigPaths({
			projects: ['./tsconfig.json'],
		}),
		tailwindcss(),
		viteReact(),
	],
	ssr: {
		noExternal: ['@tanstack/react-router', '@tanstack/react-start'],
		external: ['react', 'react-dom'],
	},
	server: {
		host: true,
		allowedHosts: ['local-fe.crm.chat', 'localhost', '127.0.0.1'],
		proxy: {
			'/api': {
				target: apiProxyTarget,
				changeOrigin: true,
				secure: false,
			},
			'/auth': {
				target: apiProxyTarget,
				changeOrigin: true,
				secure: false,
			},
		},
		...(isTunnelHmrEnabled
			? {
					hmr: {
						protocol: 'wss',
						host: tunnelFeHost,
						clientPort: 443,
					},
				}
			: {}),
	},
	build: {
		chunkSizeWarningLimit: 1000,
	},
})
