// packages/shared/src/auth.ts

/** 调用方角色：admin = 全权限（AUTH_TOKEN），demo = 演示白名单（DEMO_TOKEN）。 */
export type AuthRole = 'admin' | 'demo';

/** GET /api/auth/me 响应体（data 字段）。 */
export interface AuthInfo {
  role: AuthRole;
  demoMode: boolean;
}