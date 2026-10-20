import { useData } from "../state.tsx";
import { useErp } from "../erp.tsx";
import { PageHead } from "../ui.tsx";
import { PERIOD_LABEL } from "../../lib/config/period.ts";
import { Payslip } from "./Register.tsx";
import { personalRecord } from "./MyInformation.tsx";

/** A worker's own payslip for the selected pay period. */
export default function MyPayslip() {
  const { data } = useData();
  const { erp, me, periodId } = useErp();
  const c = data!.result.us.find((x) => x.worker.id === me.workerId);
  const status = erp.payRuns[periodId]?.status ?? "Not started";
  return (
    <>
      <PageHead title="Pay Slip">
        {PERIOD_LABEL[periodId]}. Choose another pay period at the top right.
      </PageHead>
      {!c ? (
        <div className="callout info">You are not paid in this period. Choose another pay period at the top right.</div>
      ) : (
        <>
          {status !== "Completed" && <div className="callout info">Preview: payroll has not completed this period yet (pay run: {status.toLowerCase()}), so amounts can still change.</div>}
          {personalRecord(erp.bps, c.worker.id).payment.accountLast4 && <p className="small">Net pay is deposited to {personalRecord(erp.bps, c.worker.id).payment.bank} {personalRecord(erp.bps, c.worker.id).payment.type} ••••{personalRecord(erp.bps, c.worker.id).payment.accountLast4}.</p>}
          <Payslip c={c} mine />
          <div className="row" style={{ marginTop: 12 }}><button className="btn no-print" onClick={() => window.print()}>Download PDF</button><a className="no-print" href="#/documents">All documents</a></div>
        </>
      )}
    </>
  );
}
