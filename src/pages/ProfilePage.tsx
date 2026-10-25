import { useEffect, useState } from "react";
import {
  ApiError,
  createProfileField,
  deleteProfileField,
  getImportableFields,
  getProfile,
  importProfileField,
  isProfileConflict,
  resolveProfileConflict,
  updateProfileField,
} from "../api.ts";
import { Button } from "../components/ui.tsx";
import { useToast } from "../toast.ts";
import type { ImportableField, ProfileConflict, ProfileField } from "../types.ts";

const SECTIONS = [
  {
    title: "Personal information",
    fields: ["full_name", "date_of_birth"],
  },
  {
    title: "Contact information",
    fields: ["email", "phone", "address"],
  },
  {
    title: "Identification",
    fields: ["pan_number", "passport_number", "drivers_license_number"],
  },
  {
    title: "Education",
    fields: ["school", "board", "graduation_year"],
  },
] as const;

const FIELD_LABELS: Record<string, string> = {
  full_name: "Full name",
  date_of_birth: "Date of birth",
  email: "Email",
  phone: "Phone",
  address: "Address",
  pan_number: "PAN",
  passport_number: "Passport number",
  drivers_license_number: "Driver's license number",
  school: "School",
  board: "Board",
  graduation_year: "Graduation year",
};

const ALL_FIELDS = SECTIONS.flatMap((section) => [...section.fields]);

function fieldLabel(name: string) {
  return FIELD_LABELS[name] ?? name.replaceAll("_", " ");
}

export function ProfilePage({ onOpenDocument }: { onOpenDocument: (id: string) => void }) {
  const [fields, setFields] = useState<ProfileField[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importable, setImportable] = useState<ImportableField[] | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ProfileConflict | null>(null);
  const [resolving, setResolving] = useState(false);
  const [addName, setAddName] = useState("full_name");
  const [addValue, setAddValue] = useState("");
  const [adding, setAdding] = useState(false);
  const toast = useToast();

  useEffect(() => {
    let active = true;
    getProfile()
      .then((response) => {
        if (active) {
          setFields(response.fields);
        }
      })
      .catch(() => {
        if (active) {
          setError("Could not load the profile.");
        }
      });
    return () => {
      active = false;
    };
  }, []);

  function replaceField(updated: ProfileField) {
    setFields((current) => {
      const next = (current ?? []).filter((field) => field.field_name !== updated.field_name);
      next.push(updated);
      return next.sort((left, right) => left.field_name.localeCompare(right.field_name));
    });
  }

  async function addField() {
    setAdding(true);
    setError(null);
    try {
      replaceField(await createProfileField(addName, addValue));
      setAddValue("");
      toast("Added to your profile");
      setConflict(null);
    } catch (failure) {
      if (isProfileConflict(failure)) {
        setConflict(failure.detail);
      } else {
        setError(failure instanceof Error ? failure.message : "Could not add this field.");
      }
    } finally {
      setAdding(false);
    }
  }

  async function loadImportable() {
    setImportError(null);
    try {
      const response = await getImportableFields();
      setImportable(response.fields);
    } catch {
      setImportError("Could not load verified document fields.");
    }
  }

  async function importField(item: ImportableField) {
    setImportError(null);
    try {
      replaceField(await importProfileField(item.document_id, item.document_field_id));
      setConflict(null);
      toast("Imported to your profile");
    } catch (failure) {
      if (isProfileConflict(failure)) {
        setConflict(failure.detail);
      } else {
        setImportError(failure instanceof Error ? failure.message : "Could not import this field.");
      }
    }
  }

  async function resolve(action: "keep" | "replace") {
    if (!conflict) {
      return;
    }
    setResolving(true);
    setError(null);
    try {
      const updated = await resolveProfileConflict(
        conflict.proposed_document_id && conflict.proposed_document_field_id
          ? {
              action,
              document_id: conflict.proposed_document_id,
              document_field_id: conflict.proposed_document_field_id,
            }
          : {
              action,
              field_name: conflict.field_name,
              field_value: conflict.proposed_value,
            },
      );
      replaceField(updated);
      setConflict(null);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : "Could not resolve the conflict.");
    } finally {
      setResolving(false);
    }
  }

  const stored = new Map((fields ?? []).map((field) => [field.field_name, field]));
  const missing = ALL_FIELDS.filter((name) => !stored.has(name));

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Profile</h1>
          <p className="mt-1 text-stone-600">
            Only values you verify are saved here.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            void loadImportable();
          }}
          className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-700 shadow-sm hover:bg-stone-50"
        >
          Import from documents
        </button>
      </div>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {fields === null && !error ? (
        <p className="text-sm text-stone-600">Loading profile…</p>
      ) : null}
      {fields?.length === 0 ? (
        <p className="text-sm text-stone-600">No profile fields yet.</p>
      ) : null}
      {conflict ? (
        <ConflictPanel
          conflict={conflict}
          resolving={resolving}
          onKeep={() => {
            void resolve("keep");
          }}
          onReplace={() => {
            void resolve("replace");
          }}
          onCancel={() => setConflict(null)}
        />
      ) : null}
      {importable ? (
        <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <h3 className="font-semibold text-stone-900">Verified document fields</h3>
          {importError ? <p className="mt-2 text-sm text-red-700">{importError}</p> : null}
          {importable.length === 0 ? (
            <p className="mt-3 text-sm text-stone-600">
              No verified fields are ready to import.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-stone-100">
              {importable.map((item) => (
                <li
                  key={`${item.document_id}-${item.document_field_id}`}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
                >
                  <div>
                    <p className="font-medium text-stone-900">
                      {fieldLabel(item.field_name)}: {item.proposed_value}
                    </p>
                    <p className="text-stone-600">{item.document_filename}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      void importField(item);
                    }}
                    className="rounded-lg bg-brand-600 px-3 py-1.5 font-medium text-white hover:bg-brand-700"
                  >
                    Import
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
      {fields
        ? SECTIONS.map((section) => (
            <section key={section.title} className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
              <h3 className="font-semibold text-stone-900">{section.title}</h3>
              {section.fields.every((name) => !stored.has(name)) ? (
                <p className="mt-3 text-sm text-stone-600">Nothing saved in this section.</p>
              ) : (
                <div className="mt-3 divide-y divide-stone-100">
                  {section.fields.map((name) => {
                    const field = stored.get(name);
                    return field ? (
                      <ProfileRow
                        key={field.id}
                        field={field}
                        onUpdated={replaceField}
                        onDeleted={(id) => {
                          setFields((current) => (current ?? []).filter((item) => item.id !== id));
                        }}
                        onOpenDocument={onOpenDocument}
                        onError={setError}
                      />
                    ) : null;
                  })}
                </div>
              )}
            </section>
          ))
        : null}
      {fields && missing.length > 0 ? (
        <form
          className="grid max-w-xl gap-3 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm"
          onSubmit={(event) => {
            event.preventDefault();
            void addField();
          }}
        >
          <h3 className="font-semibold text-stone-900">Add a field</h3>
          <label className="grid gap-1 text-sm">
            <span className="text-stone-600">Field</span>
            <select
              value={missing.includes(addName as (typeof ALL_FIELDS)[number]) ? addName : missing[0]}
              onChange={(event) => setAddName(event.target.value)}
              className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 shadow-sm placeholder:text-stone-500 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
            >
              {missing.map((name) => (
                <option key={name} value={name}>
                  {fieldLabel(name)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-stone-600">Value</span>
            <input
              value={addValue}
              onChange={(event) => setAddValue(event.target.value)}
              className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 shadow-sm placeholder:text-stone-500 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
            />
          </label>
          <button
            type="submit"
            disabled={adding || !addValue.trim()}
            className="w-fit rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700 disabled:opacity-60"
          >
            {adding ? "Saving…" : "Add field"}
          </button>
        </form>
      ) : null}
    </section>
  );
}

function ProfileRow({
  field,
  onUpdated,
  onDeleted,
  onOpenDocument,
  onError,
}: {
  field: ProfileField;
  onUpdated: (field: ProfileField) => void;
  onDeleted: (id: number) => void;
  onOpenDocument: (id: string) => void;
  onError: (message: string) => void;
}) {
  const [value, setValue] = useState(field.field_value);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  async function save() {
    setSaving(true);
    try {
      onUpdated(await updateProfileField(field.id, value));
      toast("Saved");
    } catch (failure) {
      onError(failure instanceof Error ? failure.message : "Could not update this field.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setSaving(true);
    try {
      await deleteProfileField(field.id);
      onDeleted(field.id);
      toast("Removed from your profile");
    } catch (failure) {
      onError(failure instanceof Error ? failure.message : "Could not delete this field.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-2 py-3 text-sm sm:grid-cols-[10rem_1fr]">
      <p className="font-medium text-stone-800">{fieldLabel(field.field_name)}</p>
      <div>
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 shadow-sm placeholder:text-stone-500 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
        />
        <p className="mt-1 text-stone-600">
          {field.verification_status === "imported"
            ? "Imported from a verified document"
            : "Entered manually"}
        </p>
        {field.source_available && field.source_document_id ? (
          <button
            type="button"
            onClick={() => onOpenDocument(field.source_document_id as string)}
            className="mt-1 text-stone-700 underline"
          >
            Open {field.source_filename}
          </button>
        ) : field.verification_status === "imported" ? (
          <p className="mt-1 text-stone-600">Source document unavailable</p>
        ) : null}
        <div className="mt-2 flex gap-2">
          <Button size="sm" variant="primary" disabled={saving} onClick={() => void save()}>
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button size="sm" variant="danger" disabled={saving} onClick={() => void remove()}>
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}

function ConflictPanel({
  conflict,
  resolving,
  onKeep,
  onReplace,
  onCancel,
}: {
  conflict: ProfileConflict;
  resolving: boolean;
  onKeep: () => void;
  onReplace: () => void;
  onCancel: () => void;
}) {
  return (
    <section className="rounded-xl border border-amber-300 bg-amber-50 p-4">
      <h3 className="font-semibold text-stone-900">
        {fieldLabel(conflict.field_name)} has two values
      </h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-stone-600">Current profile</p>
          <p className="mt-1 text-sm text-stone-900">{conflict.existing_value}</p>
          <p className="text-sm text-stone-600">
            {conflict.existing_source_available
              ? conflict.existing_source_filename
              : "No source document"}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-stone-600">Proposed value</p>
          <p className="mt-1 text-sm text-stone-900">{conflict.proposed_value}</p>
          <p className="text-sm text-stone-600">
            {conflict.proposed_source_filename ?? "Entered manually"}
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" disabled={resolving} onClick={onKeep} className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm">
          Keep existing value
        </button>
        <button type="button" disabled={resolving} onClick={onReplace} className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">
          Replace with proposed value
        </button>
        <button type="button" disabled={resolving} onClick={onCancel} className="px-3 py-1.5 text-sm underline">
          Cancel import
        </button>
      </div>
    </section>
  );
}
