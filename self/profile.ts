export const profileFields = [
  { key: "name", label: "Preferred name", group: "Contact", max: 100, autoComplete: "name" },
  { key: "email", label: "Personal email", group: "Contact", max: 254, type: "email", autoComplete: "email" },
  { key: "phone", label: "Mobile phone", group: "Contact", max: 50, type: "tel", autoComplete: "tel" },
  { key: "legalFirstName", label: "Legal first name", group: "Personal", max: 100 },
  { key: "legalMiddleName", label: "Legal middle name", group: "Personal", max: 100 },
  { key: "legalLastName", label: "Legal last name", group: "Personal", max: 100 },
  { key: "dateOfBirth", label: "Date of birth", group: "Personal", max: 10, type: "date", autoComplete: "bday" },
  { key: "homeAddress", label: "Home address line 1", group: "Address", max: 300, autoComplete: "address-line1" },
  { key: "homeAddressLine2", label: "Home address line 2", group: "Address", max: 300, autoComplete: "address-line2" },
  { key: "homeCity", label: "City", group: "Address", max: 100, autoComplete: "address-level2" },
  { key: "homeStateProvince", label: "State / province", group: "Address", max: 100, autoComplete: "address-level1" },
  { key: "homePostalCode", label: "ZIP / postal code", group: "Address", max: 20, autoComplete: "postal-code" },
  { key: "emergencyContact", label: "Emergency contact name", group: "Emergency contact", max: 100 },
  { key: "emergencyContactRelationship", label: "Relationship", group: "Emergency contact", max: 100 },
  { key: "emergencyContactPhone", label: "Emergency contact phone", group: "Emergency contact", max: 50, type: "tel" },
  { key: "emergencyContactPreference", label: "Contact preference", group: "Emergency contact", max: 100 },
] as const;
export type ProfileKey = typeof profileFields[number]["key"];
export type PersonalProfile = Record<ProfileKey, string>;
export type MyProfile = { accountEmail: string; employeeId: number; photoFileId?: string; contextToken: string; employeeVersion: number; profileVersion: number; values: PersonalProfile };
export function profileError(values: PersonalProfile, today: string): string | null {
  for (const field of profileFields) {
    if (typeof values[field.key] !== "string" || values[field.key].length > field.max) return `${field.label} must be at most ${field.max} characters.`;
  }
  if (!values.name.trim()) return "Enter your preferred name.";
  if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) return "Enter a valid personal email.";
  const date = values.dateOfBirth;
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T12:00:00Z`))
    || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date || date > today)) return "Enter a valid date of birth that is not in the future.";
  if (values.homePostalCode && !/^\d{5}(-\d{4})?$/.test(values.homePostalCode.trim())) return "Enter a five-digit ZIP code or ZIP+4.";
  return null;
}
