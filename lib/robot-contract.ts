import { z } from 'zod';
export const riskSchema = z.object({
  riskPercent: z.number().finite().positive().max(1),
  dailyLossPercent: z.number().finite().positive().max(5),
  maxOpenRiskPercent: z.number().finite().positive().max(3),
  maxPositions: z.number().int().min(1).max(10),
}).strict().refine(v => v.riskPercent <= v.maxOpenRiskPercent, 'Trade risk exceeds open risk.');
export const DEFAULT_RISK = { riskPercent: .25, dailyLossPercent: 2, maxOpenRiskPercent: 1, maxPositions: 3 };
export type Risk = z.infer<typeof riskSchema>;
export const heartbeatSchema = z.object({
  runnerId: z.string().uuid(), accountKey: z.string().min(1).max(150), demo: z.boolean(),
  accountMode: z.enum(['demo', 'real']).default('demo'),
  protocolVersion: z.number().int().min(1).max(2).default(1),
  login: z.string().max(30), server: z.string().max(100), currency: z.string().max(10),
  equity: z.number().finite().nonnegative(), balance: z.number().finite().nonnegative(),
  symbols: z.array(z.string().min(1).max(64)).min(1).max(20), timeframe: z.string().max(10),
  status: z.string().max(400), revision: z.number().int().nonnegative(),
  running: z.boolean(),
  positions: z.array(z.object({ ticket: z.string().max(30), symbol: z.string().max(64),
    side: z.enum(['BUY', 'SELL']), volume: z.number().finite().positive(),
    profit: z.number().finite(), stop: z.number().finite(), target: z.number().finite(),
  }).strict()).max(100),
  events: z.array(z.object({ id: z.string().max(160), status: z.string().max(20),
    detail: z.string().max(800), time: z.number().finite() }).strict()).max(20),
}).strict().superRefine((report, ctx) => {
  if (report.demo !== (report.accountMode === 'demo') || (report.accountMode === 'real' && report.protocolVersion < 2))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Account mode and runner capability must match.' });
});
export type Heartbeat = z.infer<typeof heartbeatSchema>;
export type RobotView = { revision: number; enabled: boolean; runnerId: string; accountKey: string;
  savedProfile: { risk: Risk; symbols: string[]; accountMode: 'demo' | 'real' } | null;
  accountMode: 'demo' | 'real'; risk: Risk; symbols: string[]; online: boolean; heartbeatAt: number; report: Heartbeat | null };
