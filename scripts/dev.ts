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

const compose = Bun.spawn(['docker', 'compose', 'up', '-d', '--wait'], {
	cwd: import.meta.dir + '/..',
	stdin: 'inherit',
	stdout: 'inherit',
	stderr: 'inherit',
})

const composeExitCode = await compose.exited
if (composeExitCode !== 0) {
	console.error('\nCould not start the CRM development services. Is Docker Desktop running?')
	process.exit(composeExitCode)
}

console.log('\nCRM development services are healthy. Starting the API and frontend...\n')

const apps = Bun.spawn(['bun', 'run', 'dev:apps'], {
	cwd: import.meta.dir + '/..',
	stdin: 'inherit',
	stdout: 'inherit',
	stderr: 'inherit',
})

const stop = () => {
	apps.kill()
}

process.on('SIGINT', stop)
process.on('SIGTERM', stop)

process.exit(await apps.exited)
