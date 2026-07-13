import prisma from '../../lib/prisma'

export abstract class CannedResponseService {
	static async getCannedResponses(accountId: string) {
		return prisma.canned_responses.findMany({
			where: { account_id: accountId },
			orderBy: { short_code: 'asc' },
		})
	}

	static async createCannedResponse(accountId: string, data: any) {
		return prisma.canned_responses.create({
			data: {
				...data,
				account_id: accountId,
			},
		})
	}

	static async deleteCannedResponse(id: string, accountId: string) {
		return prisma.canned_responses.delete({
			where: { id, account_id: accountId },
		})
	}
}
