import { randomInt } from 'node:crypto'

const LOWER = 'abcdefghijkmnpqrstuvwxyz'
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const DIGITS = '23456789'
const SYMBOLS = '!@#$%^&*'
const ALL = LOWER + UPPER + DIGITS + SYMBOLS

function pick(chars: string): string {
	return chars[randomInt(chars.length)]
}

function shuffle<T>(items: T[]): T[] {
	for (let i = items.length - 1; i > 0; i--) {
		const j = randomInt(i + 1)
		;[items[i], items[j]] = [items[j], items[i]]
	}
	return items
}

export function generateStrongPassword(): string {
	const required = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)]
	const rest = Array.from({ length: 12 }, () => pick(ALL))

	return shuffle([...required, ...rest]).join('')
}
