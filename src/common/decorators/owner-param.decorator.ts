import { SetMetadata } from '@nestjs/common';

export const OWNER_PARAM_KEY = 'owner-param';

export const OwnerParam = (param: string) =>
  SetMetadata(OWNER_PARAM_KEY, param);
