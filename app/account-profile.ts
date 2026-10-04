import { validEventDate } from "./schedule-events";

export type ProfileValues = {
  firstName: string;
  lastName: string;
  legalFirstName: string;
  legalLastName: string;
  socialSecurityNumber: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  homeAddress: string;
  homeAddressLine2: string;
  homeCity: string;
  homeStateProvince: string;
  homePostalCode: string;
  emergencyContact: string;
  emergencyContactPhone: string;
};

export function profileValues(employee: { name: string; email: string; phone: string; dateOfBirth: string; socialSecurityNumber: string;
  legalFirstName?: string; legalLastName?: string; homeAddress: string; homeAddressLine2?: string; homeCity?: string;
  homeStateProvince?: string; homePostalCode?: string; homeCityStateZip: string; emergencyContact: string; emergencyContactPhone?: string;
}): ProfileValues {
  const [firstName = "", ...lastName] = employee.name.trim().split(/\s+/);
  const legacyAddress = employee.homeCityStateZip.match(/^(.+?),\s*(.+?),?\s+(\d{5}(?:-\d{4})?)$/);
  return {
    firstName, lastName: lastName.join(" "), legalFirstName: employee.legalFirstName ?? "", legalLastName: employee.legalLastName ?? "",
    socialSecurityNumber: employee.socialSecurityNumber, email: employee.email, phone: employee.phone, dateOfBirth: employee.dateOfBirth,
    homeAddress: employee.homeAddress, homeAddressLine2: employee.homeAddressLine2 ?? "",
    homeCity: employee.homeCity ?? legacyAddress?.[1] ?? employee.homeCityStateZip,
    homeStateProvince: employee.homeStateProvince ?? legacyAddress?.[2]?.replace(/,$/, "") ?? "",
    homePostalCode: employee.homePostalCode ?? legacyAddress?.[3] ?? "",
    emergencyContact: employee.emergencyContact, emergencyContactPhone: employee.emergencyContactPhone ?? "",
  };
}

export function maskProfileSsn(value: string) {
  return value ? `•••-••-${value.replace(/\D/g, "").slice(-4)}` : "";
}

export function profileUpdate(values: ProfileValues, today: string) {
  const keys: (keyof ProfileValues)[] = ["firstName", "lastName", "legalFirstName", "legalLastName", "socialSecurityNumber", "email", "phone", "dateOfBirth", "homeAddress", "homeAddressLine2", "homeCity", "homeStateProvince", "homePostalCode", "emergencyContact", "emergencyContactPhone"];
  const trimmed = Object.fromEntries(keys.map(key => [key, typeof values[key] === "string" ? values[key].trim() : ""])) as ProfileValues;
  if (!trimmed.firstName) return { error: "Enter your preferred first name." } as const;
  if (trimmed.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed.email)) return { error: "Enter a valid email address." } as const;
  if (trimmed.socialSecurityNumber && !/^\d{3}-\d{2}-\d{4}$/.test(trimmed.socialSecurityNumber)) return { error: "Enter a nine-digit Social Security number." } as const;
  if (trimmed.dateOfBirth && (!validEventDate(trimmed.dateOfBirth) || trimmed.dateOfBirth > today)) return { error: "Enter a valid date of birth that is not in the future." } as const;
  if (trimmed.homePostalCode && !/^\d{5}(-\d{4})?$/.test(trimmed.homePostalCode)) return { error: "Enter a five-digit ZIP code or ZIP+4." } as const;
  const { firstName, lastName, ...fields } = trimmed;
  const cityState = [fields.homeCity, fields.homeStateProvince].filter(Boolean).join(", ");
  return { update: { ...fields, name: [firstName, lastName].filter(Boolean).join(" "), homeCityStateZip: [cityState, fields.homePostalCode].filter(Boolean).join(" ") } } as const;
}
