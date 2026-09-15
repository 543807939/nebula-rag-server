export const ROLE_TYPE = {
  USER: 'user',
  ADMIN: 'admin',
} as const;

export type RoleType = (typeof ROLE_TYPE)[keyof typeof ROLE_TYPE];
