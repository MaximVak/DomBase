import { useRef, useState } from "react";
import type { FormEvent, RefObject } from "react";
import { maskProfileSsn } from "./account-profile";
import type { ProfileValues } from "./account-profile";

type Certificate = { id: number; name: string; fileName: string; expirationDate?: string; fileId?: string };
const profileFields: { key: keyof ProfileValues; label: string; type?: string; autoComplete?: string }[] = [
  { key: "firstName", label: "Preferred first name", autoComplete: "given-name" },
  { key: "lastName", label: "Preferred last name", autoComplete: "family-name" },
  { key: "legalFirstName", label: "Legal first name" },
  { key: "legalLastName", label: "Legal last name" },
  { key: "socialSecurityNumber", label: "Social security number", type: "password", autoComplete: "off" },
  { key: "email", label: "Personal email address", type: "email", autoComplete: "email" },
  { key: "phone", label: "Mobile phone", type: "tel", autoComplete: "tel" },
  { key: "dateOfBirth", label: "Date of birth", type: "date", autoComplete: "bday" },
  { key: "homeAddress", label: "Home address line 1", autoComplete: "address-line1" },
  { key: "homeAddressLine2", label: "Home address line 2", autoComplete: "address-line2" },
  { key: "homeCity", label: "City", autoComplete: "address-level2" },
  { key: "homeStateProvince", label: "State/Province", autoComplete: "address-level1" },
  { key: "homePostalCode", label: "Zip/Postal code", autoComplete: "postal-code" },
];
const emergencyFields = [
  { key: "emergencyContact", label: "Full name" },
  { key: "emergencyContactPhone", label: "Mobile phone", type: "tel" },
] as const;

export function AccountProfilePanel({ values, name, companyName, position, startDate, endDate, certificates, certificateError, addCertificateRef, onAddCertificate, onDownloadCertificate, onSave, formatPhone }: {
  values: ProfileValues; name: string; companyName: string; position: string; startDate: string; endDate?: string;
  certificates: Certificate[]; certificateError: string; addCertificateRef: RefObject<HTMLButtonElement | null>;
  onAddCertificate: () => void; onDownloadCertificate: (certificate: Certificate) => void;
  onSave: (values: ProfileValues) => string | null; formatPhone: (value: string) => string;
}) {
  const [editedValues, setEditedValues] = useState<ProfileValues | null>(null);
  const [editing, setEditing] = useState<"profile" | "emergency" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const inputRefs = useRef<Partial<Record<keyof ProfileValues, HTMLInputElement | null>>>({});
  const draft = editedValues ?? values;
  const dirty = JSON.stringify(draft) !== JSON.stringify(values);
  const initials = name.trim().split(/\s+/).map(part => part.charAt(0)).slice(0, 2).join("").toUpperCase();
  function beginEditing(section: "profile" | "emergency", field: keyof ProfileValues) {
    setEditing(section);
    setMessage("");
    setError("");
    window.requestAnimationFrame(() => inputRefs.current[field]?.focus());
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dirty) return;
    const result = onSave(draft);
    if (result) { setError(result); return; }
    setEditedValues(null);
    setEditing(null);
    setError("");
    setMessage("Profile saved.");
  }
  function row(field: { key: keyof ProfileValues; label: string; type?: string; autoComplete?: string }, section: "profile" | "emergency") {
    const value = draft[field.key];
    const display = field.key === "socialSecurityNumber" ? maskProfileSsn(value)
      : field.key === "dateOfBirth" && value ? new Date(`${value}T12:00:00`).toLocaleDateString("en-US") : value;
    return <div className="account-profile-field-row" key={field.key}>
      <label htmlFor={editing === section ? `account-profile-${field.key}` : undefined}>{field.label}</label>
      {editing === section ? <input id={`account-profile-${field.key}`} ref={element => { inputRefs.current[field.key] = element; }}
        type={field.type ?? "text"} autoComplete={field.autoComplete} value={value}
        required={field.key === "firstName"} maxLength={field.key === "socialSecurityNumber" ? 11 : undefined}
        onClick={field.type === "date" ? event => { try { event.currentTarget.showPicker?.(); } catch {} } : undefined}
        onChange={event => {
          let next = event.target.value;
          if (field.key === "socialSecurityNumber") {
            const digits = next.replace(/\D/g, "").slice(0, 9);
            next = digits.length > 5 ? `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}` : digits.length > 3 ? `${digits.slice(0, 3)}-${digits.slice(3)}` : digits;
          }
          if (field.type === "tel") next = formatPhone(next);
          setEditedValues(current => ({ ...(current ?? values), [field.key]: next }));
          setError(""); setMessage("");
        }} />
        : <button type="button" className={!display ? "account-profile-add-field" : "account-profile-field-value"}
          aria-label={`${display ? "Edit" : "Add"} ${field.label}`} onClick={() => beginEditing(section, field.key)}>{display || "Add"}</button>}
    </div>;
  }
  function editButton(section: "profile" | "emergency", field: keyof ProfileValues) {
    return <button type="button" className="account-profile-edit" aria-label={`Edit ${section === "profile" ? "profile info" : "emergency contact info"}`} onClick={() => beginEditing(section, field)}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 4 5 5M4 20l4-1 12-12a2 2 0 0 0-5-5L3 14l-1 6z" /></svg>
    </button>;
  }
  return <form className="panel settings-enforcement-panel settings-account-profile-panel" onSubmit={submit}>
    <div className="settings-panel-heading"><h3>Profile</h3><button type="submit" disabled={!dirty}>Save</button></div>
    <div className="account-profile-photo"><span className="schedule-avatar" aria-hidden="true">{initials}</span><button type="button" disabled title="Not available yet">Change profile photo</button></div>
    <section className="account-profile-info">
      <div className="account-profile-section-heading"><h4>Profile info</h4>{editButton("profile", "firstName")}</div>
      <p>Keep your personal and contact information up to date.</p>
      <div className="account-profile-fields">
        {profileFields.map(field => row(field, "profile"))}
        {["Country", "Language preference"].map(label => <div className="account-profile-field-row" key={label}><span>{label}</span><button type="button" disabled title="Not available yet">Add</button></div>)}
      </div>
    </section>
    <section className="account-profile-emergency">
      <div className="account-profile-section-heading"><h4>Emergency contact info</h4>{editButton("emergency", "emergencyContact")}</div>
      <div className="account-profile-fields">{emergencyFields.map(field => row(field, "emergency"))}</div>
    </section>
    {editing ? <div className="account-profile-edit-actions"><button type="button" onClick={() => { setEditedValues(null); setEditing(null); setError(""); setMessage(""); }}>Cancel</button><button type="submit" disabled={!dirty}>Save changes</button></div> : null}
    {error ? <p className="form-message" role="alert">{error}</p> : null}
    {message ? <p className="enforcement-save-message" role="status">{message}</p> : null}
    <section className="account-profile-work-history">
      <h4>Your work history</h4>
      <div className="account-profile-position"><dl><div><dt>Company name</dt><dd>{companyName}</dd></div><div><dt>Position</dt><dd>{position || "Other"}</dd></div><div><dt>Duration</dt><dd>{startDate ? `${startDate.slice(5, 7)}/${startDate.slice(0, 4)}` : "Not set"} – {endDate ? `${endDate.slice(5, 7)}/${endDate.slice(0, 4)}` : "Present"}</dd></div></dl><button type="button" className="account-profile-edit" disabled title="Not available yet" aria-label="Edit work history"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 4 5 5M4 20l4-1 12-12a2 2 0 0 0-5-5L3 14l-1 6z" /></svg></button></div>
      <button type="button" className="account-profile-secondary" disabled title="Not available yet">Add new position</button>
    </section>
    <section className="account-profile-certificates">
      <h4>Your certificates</h4>
      {certificates.length > 0 ? <div className="certificate-list">{certificates.map(certificate => <div key={certificate.id}>
        <div className="certificate-details"><strong>{certificate.name}</strong>{certificate.expirationDate ? <span>Expires {new Date(`${certificate.expirationDate}T12:00:00`).toLocaleDateString("en-US")}</span> : null}</div>
        {certificate.fileId ? <button type="button" className="certificate-download" onClick={() => onDownloadCertificate(certificate)} aria-label={`Download ${certificate.fileName}`}>{certificate.fileName}</button> : <span>{certificate.fileName || "No attachment"}</span>}
      </div>)}</div> : null}
      <button type="button" className="account-profile-secondary" ref={addCertificateRef} onClick={onAddCertificate}>Add new certificate</button>
      {certificateError ? <p className="form-message" role="alert">{certificateError}</p> : null}
    </section>
  </form>;
}
