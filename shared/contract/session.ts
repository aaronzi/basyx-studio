import { z } from 'zod'

export const deploymentModeSchema = z.enum(['hosted', 'desktop'])
export type DeploymentMode = z.infer<typeof deploymentModeSchema>

export const studioContextSchema = z.object({
  apiVersion: z.literal('1'),
  deploymentMode: deploymentModeSchema,
  /** Whether users must sign in to Studio (hosted) or are the local OS user (desktop). */
  loginRequired: z.boolean(),
})
export type StudioContext = z.infer<typeof studioContextSchema>

export const studioSessionSchema = z.object({
  user: z.object({
    subject: z.string(),
    name: z.string(),
    roles: z.array(z.string()),
  }),
  isAdmin: z.boolean(),
  csrfToken: z.string(),
  expiresAt: z.string().nullable(),
})
export type StudioSession = z.infer<typeof studioSessionSchema>

/** Relative in-app path only; prevents open redirects after login. */
export const returnToSchema = z
  .string()
  .max(2000)
  .regex(/^\/(?![/\\])/, 'must be an absolute path within Studio')

export const loginRequestSchema = z.object({
  returnTo: returnToSchema.optional(),
})

export const authorizationStartSchema = z.object({
  authorizationUrl: z.string(),
  /** `navigate`: redirect this window; `external`: open in the system browser and poll. */
  mode: z.enum(['navigate', 'external']),
})
export type AuthorizationStart = z.infer<typeof authorizationStartSchema>

export const logoutResultSchema = z.object({
  logoutUrl: z.string().nullable(),
})
export type LogoutResult = z.infer<typeof logoutResultSchema>
