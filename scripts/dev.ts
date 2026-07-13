const devPorts = [3005, 42069, 42070]

if (process.platform === 'win32') {
	const ports = devPorts.join(',')
	Bun.spawnSync([
		'powershell.exe',
		'-NoProfile',
		'-Command',
		`Get-NetTCPConnection -State Listen -LocalPort ${ports} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | Where-Object { $_ -ne $PID } | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }`,
	])
}

const projectRoot = `${import.meta.dir}/..`

const compose = Bun.spawn([
	'docker',
	'compose',
	'up',
	'-d',
	'--wait',
	'--remove-orphans',
	'postgres',
	'redis',
	'minio',
], {
	cwd: projectRoot,
	stdin: 'inherit',
	stdout: 'inherit',
	stderr: 'inherit',
})

const composeExitCode = await compose.exited
if (composeExitCode !== 0) {
	console.error('\nCould not start the persistent CRM development services. Check the Docker output above.')
	process.exit(composeExitCode)
}

const minioInit = Bun.spawn(['docker', 'compose', 'run', '--rm', '--no-deps', 'minio-init'], {
	cwd: projectRoot,
	stdin: 'inherit',
	stdout: 'inherit',
	stderr: 'inherit',
})

const minioInitExitCode = await minioInit.exited
if (minioInitExitCode !== 0) {
	console.error('\nMinIO is healthy, but the CRM media bucket could not be initialized.')
	process.exit(minioInitExitCode)
}

console.log('\nCRM development services are healthy. Starting the API, AI worker, frontend, and WhatsApp service...\n')

const apps = Bun.spawn(['bun', 'run', 'dev:apps'], {
	cwd: projectRoot,
	stdin: 'inherit',
	stdout: 'inherit',
	stderr: 'inherit',
})

const worker = Bun.spawn(['bun', 'run', '--filter', 'backend', 'dev:worker'], {
	cwd: projectRoot,
	stdin: 'inherit',
	stdout: 'inherit',
	stderr: 'inherit',
})

const stop = () => {
	apps.kill()
	worker.kill()
}

process.on('SIGINT', stop)
process.on('SIGTERM', stop)

const exitCode = await Promise.race([apps.exited, worker.exited])
stop()
process.exit(exitCode)
