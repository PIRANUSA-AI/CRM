/**
 * Ownership of a contact — who works it, and which team it belongs to.
 *
 * This used to be derived on every read by OR-ing an assigned conversation, an
 * assigned task and a `custom_attributes.assigned_user_id` JSON key. That made
 * ownership a guess rather than a fact: reassigning an unrelated task moved a
 * contact between people, and the JSON key was a second source of truth that
 * could disagree with the other two. `contacts.owner_id` / `contacts.team_id`
 * replace it, and this module is the only place that writes them.
 *
 * Call it wherever ownership genuinely changes hands — lead routing, handing a
 * conversation over, importing a lead against a named sales. Do NOT call it on
 * every inbound message: a contact writing in does not change who owns them.
 */
import type { Prisma } from '../generated/prisma/client'
import prisma from './prisma'

type Client = Prisma.TransactionClient | typeof prisma

export type ContactOwnershipTarget = {
	/** The contact to update. Supply this or `conversationId`. */
	contactId?: string | null
	/** Resolves to the contact behind the conversation. */
	conversationId?: string | null
	/** The new owner. `null` releases the contact back to the intake pool. */
	ownerId: string | null
	/**
	 * The team the contact now belongs to. Omit to infer it from the owner's
	 * membership, which only works when they belong to exactly one team — an
	 * administrator sits in every team, so for them the caller must say which.
	 */
	teamId?: string | null
}

/**
 * Infer the team from membership, but only when the answer is unambiguous.
 * Returns null for a user in no team or in several.
 */
async function soleTeamOf(client: Client, userId: string): Promise<string | null> {
	const memberships = await client.team_members.findMany({
		where: { user_id: userId },
		select: { team_id: true },
		take: 2,
	})
	return memberships.length === 1 ? memberships[0].team_id : null
}

/**
 * Point a contact at its owner. Safe to call when nothing changed, and safe to
 * call with a conversation that has no contact yet — it resolves to a no-op
 * rather than throwing, because ownership is never the reason a caller's main
 * job (routing a lead, saving an import) should fail.
 *
 * Returns the contact id it touched, or null when there was nothing to update.
 */
export async function setContactOwner(
	client: Client,
	target: ContactOwnershipTarget,
): Promise<string | null> {
	let contactId = target.contactId ?? null

	if (!contactId && target.conversationId) {
		const conversation = await client.conversations.findUnique({
			where: { id: target.conversationId },
			select: { contact_id: true },
		})
		contactId = conversation?.contact_id ?? null
	}
	if (!contactId) return null

	const teamId =
		target.teamId !== undefined
			? target.teamId
			: target.ownerId
				? await soleTeamOf(client, target.ownerId)
				: null

	await client.contacts.update({
		where: { id: contactId },
		data: {
			owner_id: target.ownerId,
			// Releasing a contact clears its team too, otherwise it would sit in
			// the intake pool while still counting towards a team's numbers.
			team_id: target.ownerId ? teamId : null,
			updated_at: new Date(),
		},
	})

	return contactId
}
