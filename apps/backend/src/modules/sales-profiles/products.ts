/**
 * The products a sales can be skilled in.
 *
 * A list rather than free text because lead routing matches a sales' skills
 * against the lead's product interest by token overlap: "ZWCAD" and
 * "zwcad 2026 pro" tokenize differently, so one person typing the version
 * number quietly stops matching leads the other person receives.
 *
 * Names follow knowledge/product-catalog.md, which is what the AI reads when
 * it decides a message is about a product. The two lists disagreeing would
 * mean the AI recognises a lead the router cannot then place.
 *
 * Anything already stored that is not on this list keeps working: the picker
 * shows it as a chip and the router still matches it. The list guides new
 * entries rather than forbidding old ones.
 */
export const SALES_PRODUCTS: string[] = [
	'ZWCAD',
	'ZWCAD Mechanical',
	'ZW3D',
	'Archicad',
	'BIMcloud',
	'Twinmotion',
	'SketchUp',
	'CADbro',
	'Ansys',
	'3D Scanner',
]
