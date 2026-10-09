/** The applicant's year of birth from the submitted date of birth, or undefined when it is missing or unreadable. */
export function candidateBirthYearFromSubmission(details: Record<string, any>): number | undefined {
  const raw = details?.identity?.dateOfBirth;
  if (typeof raw !== 'string') return undefined;
  const year = Number(raw.trim().slice(0, 4));
  return Number.isInteger(year) && year >= 1900 && year <= new Date().getFullYear() ? year : undefined;
}

/** The names on a KYC submission that get screened against the sanctions list. */
export function candidateNamesFromSubmission(details: Record<string, any>): string[] {
  return [
    details?.identity?.fullName,
    details?.identity?.legalName,
    details?.bankAccount?.accountHolderName,
  ].filter((n): n is string => typeof n === 'string' && n.trim().length > 0);
}
