export const PASSWORD_MIN_LENGTH = 6;
export const PASSWORD_MAX_LENGTH = 20;
export const PASSWORD_PATTERN =
  /^(?:(?=.*\d)(?=.*[A-Za-z])|(?=.*\d)(?=.*[^A-Za-z0-9\s])|(?=.*[A-Za-z])(?=.*[^A-Za-z0-9\s]))\S*$/;
export const PASSWORD_MESSAGE = '密码需包含数字、字母、特殊字符中的至少两类';
