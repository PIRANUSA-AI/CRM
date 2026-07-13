/**
 * Common timezone list for user selection
 */

export interface TimezoneOption {
	value: string
	label: string
	offset: string
	region: string
}

export const TIMEZONES: TimezoneOption[] = [
	// Americas
	{
		value: 'Pacific/Midway',
		label: 'Midway Island',
		offset: 'UTC-11:00',
		region: 'Pacific',
	},
	{
		value: 'Pacific/Honolulu',
		label: 'Hawaii',
		offset: 'UTC-10:00',
		region: 'Pacific',
	},
	{
		value: 'America/Anchorage',
		label: 'Alaska',
		offset: 'UTC-09:00',
		region: 'Americas',
	},
	{
		value: 'America/Los_Angeles',
		label: 'Pacific Time (US)',
		offset: 'UTC-08:00',
		region: 'Americas',
	},
	{
		value: 'America/Denver',
		label: 'Mountain Time (US)',
		offset: 'UTC-07:00',
		region: 'Americas',
	},
	{
		value: 'America/Chicago',
		label: 'Central Time (US)',
		offset: 'UTC-06:00',
		region: 'Americas',
	},
	{
		value: 'America/New_York',
		label: 'Eastern Time (US)',
		offset: 'UTC-05:00',
		region: 'Americas',
	},
	{
		value: 'America/Sao_Paulo',
		label: 'Brasilia',
		offset: 'UTC-03:00',
		region: 'Americas',
	},

	// Atlantic/Europe
	{
		value: 'Atlantic/Azores',
		label: 'Azores',
		offset: 'UTC-01:00',
		region: 'Atlantic',
	},
	{ value: 'UTC', label: 'UTC / GMT', offset: 'UTC+00:00', region: 'UTC' },
	{
		value: 'Europe/London',
		label: 'London',
		offset: 'UTC+00:00',
		region: 'Europe',
	},
	{
		value: 'Europe/Paris',
		label: 'Paris, Berlin',
		offset: 'UTC+01:00',
		region: 'Europe',
	},
	{
		value: 'Europe/Helsinki',
		label: 'Helsinki',
		offset: 'UTC+02:00',
		region: 'Europe',
	},
	{
		value: 'Europe/Istanbul',
		label: 'Istanbul',
		offset: 'UTC+03:00',
		region: 'Europe',
	},
	{
		value: 'Europe/Moscow',
		label: 'Moscow',
		offset: 'UTC+03:00',
		region: 'Europe',
	},

	// Middle East / Africa
	{
		value: 'Asia/Dubai',
		label: 'Dubai',
		offset: 'UTC+04:00',
		region: 'Middle East',
	},
	{
		value: 'Asia/Karachi',
		label: 'Karachi',
		offset: 'UTC+05:00',
		region: 'Asia',
	},
	{
		value: 'Asia/Kolkata',
		label: 'Mumbai, Delhi',
		offset: 'UTC+05:30',
		region: 'Asia',
	},
	{ value: 'Asia/Dhaka', label: 'Dhaka', offset: 'UTC+06:00', region: 'Asia' },

	// Southeast Asia
	{
		value: 'Asia/Bangkok',
		label: 'Bangkok',
		offset: 'UTC+07:00',
		region: 'Asia',
	},
	{
		value: 'Asia/Jakarta',
		label: 'Jakarta (WIB)',
		offset: 'UTC+07:00',
		region: 'Asia',
	},
	{
		value: 'Asia/Makassar',
		label: 'Makassar (WITA)',
		offset: 'UTC+08:00',
		region: 'Asia',
	},
	{
		value: 'Asia/Singapore',
		label: 'Singapore',
		offset: 'UTC+08:00',
		region: 'Asia',
	},
	{
		value: 'Asia/Hong_Kong',
		label: 'Hong Kong',
		offset: 'UTC+08:00',
		region: 'Asia',
	},
	{
		value: 'Asia/Manila',
		label: 'Manila',
		offset: 'UTC+08:00',
		region: 'Asia',
	},
	{
		value: 'Asia/Jayapura',
		label: 'Jayapura (WIT)',
		offset: 'UTC+09:00',
		region: 'Asia',
	},
	{ value: 'Asia/Tokyo', label: 'Tokyo', offset: 'UTC+09:00', region: 'Asia' },
	{ value: 'Asia/Seoul', label: 'Seoul', offset: 'UTC+09:00', region: 'Asia' },

	// Oceania
	{
		value: 'Australia/Sydney',
		label: 'Sydney',
		offset: 'UTC+10:00',
		region: 'Oceania',
	},
	{
		value: 'Australia/Melbourne',
		label: 'Melbourne',
		offset: 'UTC+10:00',
		region: 'Oceania',
	},
	{
		value: 'Pacific/Auckland',
		label: 'Auckland',
		offset: 'UTC+12:00',
		region: 'Oceania',
	},
]

// Indonesian timezones for quick access
export const INDONESIA_TIMEZONES = TIMEZONES.filter((tz) =>
	['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura'].includes(tz.value),
)

// Get timezone by value
export function getTimezoneByValue(value: string): TimezoneOption | undefined {
	return TIMEZONES.find((tz) => tz.value === value)
}

// Format timezone for display
export function formatTimezoneLabel(value: string): string {
	const tz = getTimezoneByValue(value)
	return tz ? `${tz.label} (${tz.offset})` : value
}
