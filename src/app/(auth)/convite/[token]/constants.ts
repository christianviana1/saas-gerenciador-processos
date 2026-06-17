/** The current version of Privacy Policy / Terms of Service displayed on the page. */
export const POLICY_VERSION = '1.0';

export interface ActivateFormState {
  error?: string;
  fieldErrors?: Record<string, string[]>;
}
