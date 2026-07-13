import { config as loadDotEnv } from 'dotenv'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDir = dirname(fileURLToPath(import.meta.url))
const serviceDir = resolve(currentDir, '..')
const workspaceDir = resolve(serviceDir, '..')
const workspaceEnvPath = resolve(workspaceDir, '.env')

if (existsSync(workspaceEnvPath)) {
	loadDotEnv({ path: workspaceEnvPath, override: false })
}
