declare module 'qrcode' {
	type QRCodeOptions = {
		width?: number
		margin?: number
		color?: { dark?: string; light?: string }
	}
	const QRCode: {
		toDataURL(value: string, options?: QRCodeOptions): Promise<string>
	}
	export default QRCode
}
