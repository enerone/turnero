import pino from 'pino'
import { env } from './env'

const esDev = env.NODE_ENV !== 'production'

export const logger = pino({
  level: esDev ? 'debug' : 'info',
  redact: {
    paths: [
      'password',
      'refreshToken',
      'refresh_token',
      '*.password',
      '*.refreshToken',
      '*.refresh_token',
      'authorization',
      'cookie',
    ],
    censor: '[REDACTED]',
  },
  transport: esDev
    ? {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss.l' },
      }
    : undefined,
})
