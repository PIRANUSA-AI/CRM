import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_app/channels/telegram')({
	component: RouteComponent,
})

function RouteComponent() {
	return <div>Hello "/channels/telegram"!</div>
}
