import type { RoleType } from '../constant/role.constant.js';
import type { TokenType } from '../constant/token-type.constant.js';

export interface JwtPayload {
  sub: number; // userId
  role: RoleType;
  jti?: string; // refresh token的
  iat?: number; // 签发时间 代码库生成
  exp?: number; // 过期时间 代码库生成
  tokenType?: TokenType;
}
