import { appSettingLimits, appSettingTypes } from '@basyx/studio-sdk/protocol'
import { z } from 'zod'
import { connectionBindingSchema } from './connections'

// Settings that apps declare and administrators set per installation and per
// infrastructure (ADR 0048). These schemas check the shape of values; whether
// a setting accepts a value, Studio checks against the installed manifest
// with `checkSettingValue` of @basyx/studio-app-kit/manifest.

export const appSettingKeySchema = z.string().regex(/^[a-z][A-Za-z0-9]{0,63}$/, 'must be a setting key such as assetTypes')

const settingString = z.string().max(appSettingLimits.stringLength)

/** A setting's value: a string, a finite number, a boolean, or a list of strings. */
export const appSettingValueSchema = z.union([
  settingString,
  z.number(),
  z.boolean(),
  z.array(settingString).max(appSettingLimits.listItems),
])
export type AppSettingValue = z.infer<typeof appSettingValueSchema>

/** Values by setting key; a key without a value is left out. */
export const appSettingValuesSchema = z.record(appSettingKeySchema, appSettingValueSchema)
  .refine(values => Object.keys(values).length <= appSettingLimits.settings, `at most ${appSettingLimits.settings} settings`)
export type AppSettingValues = z.infer<typeof appSettingValuesSchema>

/** A setting of an app's manifest, as the forms show it. */
export const appSettingSummarySchema = z.object({
  key: z.string(),
  type: z.enum(appSettingTypes),
  title: z.record(z.string(), z.string()),
  description: z.record(z.string(), z.string()).nullable(),
  enum: z.array(z.string()).nullable(),
  default: appSettingValueSchema.nullable(),
  required: z.boolean(),
  scope: z.enum(['installation', 'infrastructure']),
})
export type AppSettingSummary = z.infer<typeof appSettingSummarySchema>

/** `PUT /app-installations/{id}/settings`: the installation's values; `null` or a missing key leaves a setting without one. */
export const appSettingsUpdateSchema = z.object({
  values: z.record(appSettingKeySchema, appSettingValueSchema.nullable())
    .refine(values => Object.keys(values).length <= appSettingLimits.settings, `at most ${appSettingLimits.settings} settings`),
}).strict()
export type AppSettingsUpdate = z.infer<typeof appSettingsUpdateSchema>

/** The values of an app's `infrastructure` settings on one infrastructure, by app ID (ADR 0048). */
export const infrastructureAppSettingsSchema = z.object({
  app: connectionBindingSchema.shape.app,
  settings: appSettingValuesSchema.default({}),
}).strict()
export type InfrastructureAppSettings = z.infer<typeof infrastructureAppSettingsSchema>

/** The largest number of apps an infrastructure holds settings for. */
export const maxInfrastructureApps = 50

export const appContextQuerySchema = z.object({
  /** The target the frame is bound to; without it, only installation values and defaults apply. */
  targetId: z.string().min(1).max(200).optional(),
})

/**
 * `GET /app-installations/{id}/context`: what Studio's page adds to a frame's
 * context for a target: the resolved settings and whether each declared
 * connection is bound.
 */
export const appTargetContextSchema = z.object({
  settings: z.record(z.string(), appSettingValueSchema.nullable()),
  connections: z.record(z.string(), z.object({ bound: z.boolean() })),
})
export type AppTargetContext = z.infer<typeof appTargetContextSchema>
