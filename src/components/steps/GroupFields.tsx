import { useEffect, useId, useMemo, useRef, useState } from "react";
import { type Group, isPerson, isValidRor } from "@/core";
import { MAX_AUTHOR_NAME_LENGTH, MAX_GROUP_MEMBERS } from "@/core/author";
import { useTranslations } from "@/lib/translations";
import { useContributionStore } from "@/store/contribution-store";

const FIELD =
  "w-full rounded border border-edge bg-surface-bright px-2 py-1 text-xs text-on-surface outline-none focus:ring-2 focus:ring-primary read-only:opacity-70 disabled:opacity-60";

/** One member per line, as the textarea shows them. */
const toText = (members: Group["members"]) => members.map((member) => member.name).join("\n");

/**
 * What a group holds beyond its name and roles: the short name for chips and the figure, a ROR id,
 * the members and who they are to the work, and the contact who answers review requests. Text is
 * kept locally and committed on blur, like the name field, so a keystroke does not rewrite the roster.
 */
export function GroupFields({ group, rowLocked }: { group: Group; rowLocked: boolean }) {
  const t = useTranslations();
  const updateGroup = useContributionStore((s) => s.updateGroup);
  const authors = useContributionStore((s) => s.authors);
  const people = useMemo(() => authors.filter(isPerson), [authors]);
  // A new group opens its details; a filled one stays folded, so a long list stays short.
  const [open, setOpen] = useState(group.members.length === 0 && !group.alias && !group.ror);
  const [alias, setAlias] = useState(group.alias ?? "");
  const [ror, setRor] = useState(group.ror ? `https://ror.org/${group.ror}` : "");
  const [rorInvalid, setRorInvalid] = useState(false);
  const [membersText, setMembersText] = useState(toText(group.members));
  const membersRef = useRef<HTMLTextAreaElement>(null);
  const ids = [useId(), useId(), useId(), useId(), useId()] as const;
  const [aliasId, rorId, membersId, areId, contactId] = ids;

  useEffect(() => setAlias(group.alias ?? ""), [group.alias]);
  useEffect(() => setRor(group.ror ? `https://ror.org/${group.ror}` : ""), [group.ror]);
  const storedMembers = toText(group.members);
  useEffect(() => {
    // Text typed but not yet committed wins over a change that lands meanwhile.
    if (document.activeElement !== membersRef.current) setMembersText(storedMembers);
  }, [storedMembers]);

  function commitAlias() {
    const value = alias.trim();
    if (value !== (group.alias ?? "")) updateGroup(group.id, { alias: value || null });
  }

  function commitRor() {
    const value = ror.trim();
    if (!value) {
      setRorInvalid(false);
      if (group.ror) updateGroup(group.id, { ror: null });
      return;
    }
    const valid = isValidRor(value);
    setRorInvalid(!valid);
    if (valid) updateGroup(group.id, { ror: value });
  }

  function commitMembers() {
    if (membersText === storedMembers) return;
    // A name that stays keeps its link to a person row, once.
    const links = new Map(group.members.flatMap((m) => (m.personId ? [[m.name, m.personId] as const] : [])));
    const members = membersText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, MAX_GROUP_MEMBERS)
      .map((name) => {
        const personId = links.get(name);
        links.delete(name);
        return personId ? { name, personId } : { name };
      });
    updateGroup(group.id, { members });
  }

  /** The contact is a person row, so choosing one links a member to it: a member with the name, else a new one. */
  function chooseContact(personId: string) {
    if (!personId) {
      updateGroup(group.id, { contactId: null });
      return;
    }
    const person = people.find((p) => p.id === personId);
    if (!person) return;
    const members = group.members.some((m) => m.personId === personId)
      ? group.members
      : group.members.some((m) => m.name === person.name && !m.personId)
        ? group.members.map((m) => (m.name === person.name && !m.personId ? { ...m, personId } : m))
        : [...group.members, { name: person.name, personId }];
    updateGroup(group.id, { members, contactId: personId });
  }

  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="mt-1 pl-8 text-xs text-on-surface-variant"
    >
      <summary className="min-h-6 cursor-pointer py-0.5 font-medium hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        {t("groupDetails")}
      </summary>
      <div className="flex flex-col gap-2 pt-1 pb-1.5">
        <label htmlFor={aliasId} className="flex flex-col gap-0.5">
          {t("groupAliasLabel")}
          <input
            id={aliasId}
            value={alias}
            maxLength={MAX_AUTHOR_NAME_LENGTH}
            readOnly={rowLocked}
            placeholder={group.initials}
            onChange={(event) => setAlias(event.target.value)}
            onBlur={commitAlias}
            onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
            className={FIELD}
          />
        </label>
        <label htmlFor={rorId} className="flex flex-col gap-0.5">
          {t("groupRorLabel")}
          <input
            id={rorId}
            value={ror}
            inputMode="url"
            readOnly={rowLocked}
            placeholder="https://ror.org/…"
            aria-invalid={rorInvalid}
            aria-describedby={rorInvalid ? `${rorId}-error` : undefined}
            onChange={(event) => setRor(event.target.value)}
            onBlur={commitRor}
            onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
            className={`${FIELD} font-mono`}
          />
        </label>
        {rorInvalid && (
          <p id={`${rorId}-error`} className="text-error">
            {t("errRorInvalid")}
          </p>
        )}
        <label htmlFor={membersId} className="flex flex-col gap-0.5">
          {t("groupMembersLabel")}
          <textarea
            id={membersId}
            ref={membersRef}
            value={membersText}
            rows={3}
            readOnly={rowLocked}
            onChange={(event) => setMembersText(event.target.value)}
            onBlur={commitMembers}
            className={FIELD}
          />
        </label>
        <label htmlFor={areId} className="flex flex-col gap-0.5">
          {t("groupMembersAre")}
          <select
            id={areId}
            value={group.membersAre}
            disabled={rowLocked}
            onChange={(event) => updateGroup(group.id, { membersAre: event.target.value as Group["membersAre"] })}
            className={FIELD}
          >
            <option value="authors">{t("groupMembersAuthors")}</option>
            <option value="collaborators">{t("groupMembersCollaborators")}</option>
          </select>
        </label>
        {people.length > 0 && (
          <label htmlFor={contactId} className="flex flex-col gap-0.5">
            {t("groupContactLabel")}
            <select
              id={contactId}
              value={group.contactId ?? ""}
              disabled={rowLocked}
              onChange={(event) => chooseContact(event.target.value)}
              className={FIELD}
            >
              <option value="">{t("groupContactNone")}</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </details>
  );
}
