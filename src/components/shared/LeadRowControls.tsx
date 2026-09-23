import { useEffect, useState } from 'react';

export type WebsiteStatus = 'working' | 'not_working' | undefined;

interface EditablePhoneCellProps {
  phone?: string;
  onSave: (phone: string) => Promise<void>;
}

export function EditablePhoneCell({ phone = '', onSave }: EditablePhoneCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(phone);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(phone);
  }, [phone, editing]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onSave(draft);
      setEditing(false);
    } catch {
      // The parent reports the save error; keep the previous value visible.
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-6" onClick={event => event.stopPropagation()}>
      {editing ? (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={draft}
            onChange={event => setDraft(event.target.value)}
            onBlur={save}
            onKeyDown={event => {
              if (event.key === 'Enter') save();
              if (event.key === 'Escape') {
                setDraft(phone);
                setEditing(false);
              }
            }}
            className="w-32 bg-[#1a1a1a] border border-[#dfff03] rounded px-2 py-1 text-xs text-white focus:outline-none"
          />
          {saving && <span className="text-[#6b6b6b] text-xs">Saving...</span>}
        </div>
      ) : (
        <span
          className={`font-mono text-xs cursor-text ${phone ? 'text-white' : 'text-[#4a4a4a]'}`}
          onDoubleClick={event => {
            event.stopPropagation();
            setDraft(phone);
            setEditing(true);
          }}
        >
          {phone || '—'}
        </span>
      )}
    </div>
  );
}

interface WebsiteStatusToggleProps {
  status?: WebsiteStatus;
  onToggle: (nextStatus: Exclude<WebsiteStatus, undefined>) => Promise<void>;
}

export function WebsiteStatusToggle({ status, onToggle }: WebsiteStatusToggleProps) {
  const [saving, setSaving] = useState(false);
  const label = status === 'working' ? 'Working' : status === 'not_working' ? 'Not Working' : 'Not Checked';

  const toggle = async () => {
    if (saving) return;
    const nextStatus = status === 'working' ? 'not_working' : 'working';
    setSaving(true);
    try {
      await onToggle(nextStatus);
    } finally {
      setSaving(false);
    }
  };

  return (
    <button
      type="button"
      disabled={saving}
      onClick={event => {
        event.stopPropagation();
        toggle();
      }}
      className={`px-2 py-1 rounded text-xs font-medium transition-colors disabled:opacity-60 ${status === 'working' ? 'bg-[#64dc78]/15 text-[#64dc78]' : status === 'not_working' ? 'bg-[#ff6464]/15 text-[#ff6464]' : 'bg-[#2a2a2a] text-[#6b6b6b]'}`}
    >
      {saving ? 'Saving...' : label}
    </button>
  );
}
