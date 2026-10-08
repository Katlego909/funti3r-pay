/** The names on a KYC submission that get screened against the sanctions list. */
export function candidateNamesFromSubmission(details: Record<string, any>): string[] {
  return [
    details?.identity?.fullName,
    details?.identity?.legalName,
    details?.bankAccount?.accountHolderName,
  ].filter((n): n is string => typeof n === 'string' && n.trim().length > 0);
}
