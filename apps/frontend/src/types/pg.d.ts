declare module 'pg' {
	export type PoolConfig = {
		connectionString?: string
	}

	export class Pool {
		constructor(config?: PoolConfig)
		end(): Promise<void>
	}
}
