import { useState } from "react";
import { useData } from "../state.tsx";
import { useErp } from "../erp.tsx";
import { PageHead, Section } from "../ui.tsx";
import { ApproverJump, BpStatus, CanInitiate, Field, FormGrid, Toast, today } from "../erpui.tsx";
import type { BPType, BusinessProcess } from "../../lib/erp/types.ts";

export interface PersonalRecord {
  contact: Record<string, string>;
  emergency: Record<string, string>;
  payment: Record<string, string>;
}

/** A worker's personal data: the latest approved change of each kind (none until they enter it). */
export function personalRecord(bps: BusinessProcess[], workerId: string): PersonalRecord {
  const latest = (type: BPType, part?: string) => {
    const b = bps.filter((x) => x.type === type && x.subjectId === workerId && x.status === "Approved" && (!part || x.payload.part === part)).at(-1);
    return (b?.payload.values ?? {}) as Record<string, string>;
  };
  return { contact: latest("Change Personal Information", "contact"), emergency: latest("Change Personal Information", "emergency"), payment: latest("Change Payment Election") };
}

const CONTACT: [string, string][] = [["street", "Street address"], ["city", "City"], ["region", "State or province"], ["postalCode", "Postal code"], ["phone", "Phone"], ["email", "Personal email"]];
const EMERGENCY: [string, string][] = [["name", "Name"], ["relationship", "Relationship"], ["phone", "Phone"]];

function Shown({ fields, values }: { fields: [string, string][]; values: Record<string, string> }) {
  if (!Object.values(values).some(Boolean)) return <p className="muted small">Nothing on file.</p>;
  return <dl className="kv">{fields.filter(([k]) => values[k]).map(([k, l]) => <span key={k} style={{ display: "contents" }}><dt>{l}</dt><dd>{values[k]}</dd></span>)}</dl>;
}

export default function MyInformation() {
  const { data } = useData();
  const { erp, me, submit } = useErp();
  const ds = data!.dsNow;
  const w = ds.workers.find((x) => x.id === me.workerId);
  const [editing, setEditing] = useState("");
  const [form, setForm] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  const [lastBp, setLastBp] = useState("");
  if (!w) return <div className="callout info">{me.name} has no worker record.</div>;

  const rec = personalRecord(erp.bps, w.id);
  const pending = (type: BPType, part?: string) => erp.bps.filter((b) => b.type === type && b.subjectId === w.id && b.status === "Awaiting Approval" && (!part || b.payload.part === part)).at(-1);
  const open = (key: string, values: Record<string, string>) => { setEditing(key); setForm({ ...values }); setErrors([]); setMsg(""); };
  const send = (type: BPType, payload: Record<string, unknown>, summary: string, errs: string[]) => {
    setErrors(errs);
    if (errs.length) return;
    const bp = submit({ type, subjectId: w.id, subjectName: w.name, effectiveDate: today(), summary, payload });
    setLastBp(bp.id);
    setMsg(`${bp.id} submitted for approval. Your details change once it is approved.`);
    setEditing("");
  };
  const input = (k: string, l: string, extra: Record<string, string> = {}) => (
    <Field key={k} label={l}><input type="text" value={form[k] ?? ""} onChange={(e) => setForm({ ...form, [k]: e.target.value })} {...extra} /></Field>
  );
  const status = (b?: BusinessProcess) => (b ? <div className="small" style={{ marginBottom: 8 }}>Change waiting: <BpStatus bp={b} /></div> : null);
  const actions = (onSubmit: () => void) => (
    <div className="row" style={{ marginTop: 12 }}><button className="btn" onClick={onSubmit}>Submit for approval</button><button className="btn ghost" onClick={() => setEditing("")}>Cancel</button></div>
  );

  return (
    <>
      <PageHead title="My Information">Your contact details, emergency contact, bank account for pay and federal tax withholding. Changes go for approval: personal details to HR, bank and tax details to payroll. Only you, HR and payroll can see them.</PageHead>
      <Toast text={msg} tone="info" />
      {msg && <ApproverJump bp={erp.bps.find((b) => b.id === lastBp)} />}
      {errors.map((e) => <div key={e} className="callout bad">{e}</div>)}
      <CanInitiate type="Change Personal Information">
        <div className="grid2">
          <Section title="Contact details" right={editing !== "contact" && <button className="btn ghost" onClick={() => open("contact", rec.contact)}>Edit</button>}>
            {status(pending("Change Personal Information", "contact"))}
            {editing === "contact" ? (
              <div className="sheet">
                <FormGrid>{CONTACT.map(([k, l]) => input(k, l))}</FormGrid>
                {actions(() => send("Change Personal Information", { part: "contact", values: form }, "Update contact details", [
                  ...(!form.street?.trim() || !form.city?.trim() ? ["Enter a street address and city."] : []),
                  ...(form.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email) ? ["Enter a valid email address."] : []),
                ]))}
              </div>
            ) : <Shown fields={CONTACT} values={rec.contact} />}
          </Section>
          <Section title="Emergency contact" right={editing !== "emergency" && <button className="btn ghost" onClick={() => open("emergency", rec.emergency)}>Edit</button>}>
            {status(pending("Change Personal Information", "emergency"))}
            {editing === "emergency" ? (
              <div className="sheet">
                <FormGrid>{EMERGENCY.map(([k, l]) => input(k, l))}</FormGrid>
                {actions(() => send("Change Personal Information", { part: "emergency", values: form }, "Update emergency contact", !form.name?.trim() || !form.phone?.trim() ? ["Enter the contact's name and phone."] : []))}
              </div>
            ) : <Shown fields={EMERGENCY} values={rec.emergency} />}
          </Section>
          <Section title="Bank account for pay" right={editing !== "payment" && <button className="btn ghost" onClick={() => open("payment", { bank: rec.payment.bank ?? "", type: rec.payment.type ?? "Checking" })}>Edit</button>}>
            {status(pending("Change Payment Election"))}
            {editing === "payment" ? (
              <div className="sheet">
                <FormGrid>
                  {input("bank", "Bank name")}
                  <Field label="Account type"><select value={form.type ?? "Checking"} onChange={(e) => setForm({ ...form, type: e.target.value })}><option>Checking</option><option>Savings</option></select></Field>
                  {input("routing", "Routing number", { inputMode: "numeric", autoComplete: "off" })}
                  {input("account", "Account number", { inputMode: "numeric", autoComplete: "off" })}
                </FormGrid>
                <p className="small muted">Only the last four digits of the account number are kept and shown.</p>
                {actions(() => {
                  const acct = (form.account ?? "").replace(/\D/g, "");
                  const routing = (form.routing ?? "").replace(/\D/g, "");
                  send("Change Payment Election", { values: { bank: form.bank?.trim() ?? "", type: form.type ?? "Checking", routingLast4: routing.slice(-4), accountLast4: acct.slice(-4) } }, `Pay to ${form.bank?.trim()} ${form.type ?? "Checking"} ••••${acct.slice(-4)}`, [
                    ...(!form.bank?.trim() ? ["Enter the bank name."] : []),
                    ...(routing.length !== 9 ? ["A routing number has 9 digits."] : []),
                    ...(acct.length < 4 || acct.length > 17 ? ["An account number has 4 to 17 digits."] : []),
                  ]);
                })}
              </div>
            ) : rec.payment.accountLast4 ? (
              <dl className="kv"><dt>Bank</dt><dd>{rec.payment.bank}</dd><dt>Account</dt><dd>{rec.payment.type} ••••{rec.payment.accountLast4}</dd><dt>Routing</dt><dd>•••••{rec.payment.routingLast4}</dd></dl>
            ) : <p className="muted small">Nothing on file.</p>}
          </Section>
          {w.country === "USA" && (
            <Section title="Federal tax withholding (W-4)" right={editing !== "tax" && <button className="btn ghost" onClick={() => open("tax", { filingStatus: w.filingStatus })}>Edit</button>}>
              {status(pending("Change Tax Withholding"))}
              {editing === "tax" ? (
                <div className="sheet">
                  <FormGrid>
                    <Field label="Filing status"><select value={form.filingStatus} onChange={(e) => setForm({ ...form, filingStatus: e.target.value })}><option value="Single">Single or married filing separately</option><option value="MFJ">Married filing jointly</option></select></Field>
                  </FormGrid>
                  <p className="small muted">Used for federal income tax from the next pay run calculated after approval.</p>
                  {actions(() => send("Change Tax Withholding", { filingStatus: form.filingStatus }, `W-4 filing status: ${form.filingStatus === "MFJ" ? "Married filing jointly" : "Single"}`, form.filingStatus === w.filingStatus ? ["That is already your filing status."] : []))}
                </div>
              ) : (
                <dl className="kv"><dt>Filing status</dt><dd>{w.filingStatus === "MFJ" ? "Married filing jointly" : "Single or married filing separately"}</dd></dl>
              )}
            </Section>
          )}
        </div>
      </CanInitiate>
    </>
  );
}
