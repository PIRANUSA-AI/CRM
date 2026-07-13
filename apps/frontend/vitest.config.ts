import viteTsConfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

// ponytail: separate from vite.config.ts because that one loads the
// TanStack Start / Nitro plugins, which aren't compatible with vitest's
// module runner. This config is deliberately minimal.
export default defineConfig({
	plugins: [viteTsConfigPaths({ projects: ['./tsconfig.json'] })],
	test: {
		environment: 'node',
	},
})
