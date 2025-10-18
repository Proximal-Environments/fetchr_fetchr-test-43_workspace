export const APP_STORE_REVIEWER_EMAILS = [
  'reviewer@fetchr.so',
  'reviewer1@fetchr.so',
  'reviewer2@fetchr.so',
  'navidkpour@gmail.com',
  'navid.pour@outlook.com',
];

export function isAppStoreReviewerEmail(email: string): boolean {
  if (APP_STORE_REVIEWER_EMAILS.includes(email)) return true;
  else if (/^reviewer.*@fetchr\.so$/.test(email)) return true;
  return false;
}
