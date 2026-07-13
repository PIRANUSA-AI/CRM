import { hashPassword } from 'better-auth/crypto'
import type { Prisma } from '../generated/prisma'

type TxClient = Prisma.TransactionClient

type SyncCredentialParams = {
	userId: string
	password: string
}

/**
 * Keep Better Auth credential account in sync for users created/updated
 * outside Better Auth endpoints.
 */
export async function syncBetterAuthCredentialAccount(
	tx: TxClient,
	params: SyncCredentialParams,
) {
	const { userId, password } = params
	if (!password) return

	const hashedPassword = await hashPassword(password)
	const existingCredentialAccount = await tx.account.findFirst({
		where: {
			userId,
			providerId: 'credential',
		},
		select: {
			id: true,
			accountId: true,
		},
	})

	if (existingCredentialAccount) {
		await tx.account.update({
			where: { id: existingCredentialAccount.id },
			data: {
				password: hashedPassword,
				accountId: existingCredentialAccount.accountId || userId,
				updatedAt: new Date(),
			},
		})
		return
	}

	await tx.account.create({
		data: {
			id: crypto.randomUUID(),
			userId,
			providerId: 'credential',
			accountId: userId,
			password: hashedPassword,
		},
	})
}
