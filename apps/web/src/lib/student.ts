import { z } from 'zod';
import type { AgentRow, User } from '@/db/schema';
import { maritimeFromEnv, type MaritimeClient } from './maritime';

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const ProfileUpdate = z
  .object({
    name: z.string().trim().max(80),
    timezone: z.string().refine(isValidTimeZone, 'Unknown timezone'),
    briefTimeLocal: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM'),
    channel: z.enum(['in_app', 'telegram']),
  })
  .partial();

/** What the app shows about a student. Never includes token hashes. */
export function publicProfile(user: User, agent: AgentRow | null) {
  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      timezone: user.timezone,
      briefTimeLocal: user.briefTimeLocal,
      channel: user.channel,
      telegramLinked: Boolean(user.telegramChatId),
      onboarded: Boolean(user.onboardedAt),
    },
    agent: agent
      ? {
          status: agent.status,
          maritimeAgentId: agent.maritimeAgentId,
          lastError: agent.lastError,
          lastSeenAt: agent.lastSeenAt?.toISOString() ?? null,
          settingsSynced: Boolean(agent.configWrittenAt),
        }
      : null,
  };
}

/** Maritime client, or null when MARITIME_API_KEY is unset (local UI work). */
export function maritimeOrNull(): MaritimeClient | null {
  try {
    return maritimeFromEnv();
  } catch {
    return null;
  }
}
